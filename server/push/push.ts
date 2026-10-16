// Web push (docs/push.md): match reminders, upsets and event starts for signed-in devices that turned
// notifications on in Settings › Notifications.
//
// Who: a subscription belongs to a signed-in account, and everything it follows is read from that account's
// synced personal data (user_state: myTeam, tracked, settings.notify) at send time. Signed-out devices can't
// subscribe: the server would otherwise have to keep a second, unaccounted copy of what a device follows.
//
// What (each switch in settings.notify; a switch that's off sends nothing of its kind):
//   match  myTeamMatches (my team) / trackedTeams (tracked teams): once a match's scheduled start (event-local
//          time read in the event's time zone) is PUSH_LEAD_MS (15 min) away or less, and at least
//          PUSH_MIN_LEAD_MS (1 min). Unknown time or zone: skipped. One push per device per match, however the
//          schedule moves afterwards (the sent-log subject is the match, not its time).
//   upset  upsets: a match at a followed event whose logged pre-match call (predictions, kind 'live') gave the
//          losing side UPSET_THRESHOLD (65%) or more. Ties are never upsets. Only upsets scored in the last
//          UPSET_FRESH_MS and after the device subscribed.
//   start  eventStart: a followed event's first match result is in, or its first scheduled match's start has
//          passed, whichever comes first, on the event's first day in its own time zone. Once per event.
// A followed event: one in tracked.events, or one whose roster (event_teams, else its match lineups)
// includes my team or a tracked team.
//
// How: pushTick (the scheduler, every minute; off with CS_NO_SCHEDULER) plans the pushes, then claims each in
// push_sent (subscription, kind, subject) before sending, so a push goes out once however many ticks or
// servers see it. At most PUSH_DAILY_LIMIT per device in 24 hours (the rest are logged 'limited', never sent
// later). A push service answering 404/410 means the device unsubscribed: the subscription is deleted.
// A 429/5xx/network failure releases the claim (the next tick retries while it's still timely). A plan carries an
// expiry (a reminder: 1 min before its match), checked against the clock at the moment of sending.
//
// Sending uses the web-push package (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID): audited,
// widely used crypto rather than our own. Without VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT,
// or with the owner's "push" flag off, nothing here runs and the app says push is unavailable.
import webpush from "web-push";
import { all, get, run } from "../db.js";
import { env } from "../env.js";
import { isEnabled } from "../flags.js";
import { localToUtcMs } from "../data/time.js";
import { isEventDay, localDate } from "../data/live.js";
import { cleanValue, EMPTY_STATE, type Settings, type TrackedState } from "../../src/shared/personal.js";
import {
  PUSH_DAILY_LIMIT, PUSH_LEAD_MS, PUSH_MAX_PER_ACCOUNT, PUSH_MIN_LEAD_MS, UPSET_FRESH_MS, UPSET_THRESHOLD,
  eventUrl, matchUrl, uaFamily, type PushConfig, type PushKind, type PushPayload, type PushSubscriptionInput,
} from "../../src/shared/push.js";

type Log = (m: string) => void;

// --- Configuration -------------------------------------------------------------------------------

let checked: { key: string; ok: boolean } | null = null;

/** Are the VAPID settings present and usable? (Checked once per value; never logs the keys.) */
export function vapidReady(): boolean {
  const pub = env.vapidPublicKey, priv = env.vapidPrivateKey, subject = env.vapidSubject;
  if (!pub || !priv || !subject) return false;
  const key = `${pub}|${priv}|${subject}`;
  if (checked?.key !== key) {
    let ok = true;
    // setVapidDetails validates the subject (mailto:/https:) and both keys' lengths, and throws on bad ones.
    try { webpush.setVapidDetails(subject, pub, priv); } catch { ok = false; }
    if (!ok) console.warn("[push] the VAPID settings are invalid: push stays off (see docs/push.md)");
    checked = { key, ok };
  }
  return checked.ok;
}

/** Can this server send pushes right now (keys set and the owner's switch on)? */
export async function pushAvailable(): Promise<boolean> {
  return vapidReady() && (await isEnabled("push"));
}

export async function pushConfig(): Promise<PushConfig> {
  const available = await pushAvailable();
  return { available, publicKey: available ? env.vapidPublicKey : null };
}

// --- Sending (a seam: tests swap in a fake push service) --------------------------------------------

export type SendResult = { ok: true } | { ok: false; status: number | null; error: string };
export type PushSender = (sub: PushSubscriptionInput, payload: string, ttlSeconds: number) => Promise<SendResult>;

const webPushSender: PushSender = async (sub, payload, ttl) => {
  try {
    await webpush.sendNotification(sub, payload, {
      vapidDetails: { subject: env.vapidSubject!, publicKey: env.vapidPublicKey!, privateKey: env.vapidPrivateKey! },
      TTL: ttl, urgency: "high", contentEncoding: "aes128gcm", timeout: 10_000,
    });
    return { ok: true };
  } catch (e) {
    const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : null;
    // The message only: web-push errors can carry the request headers (the VAPID JWT).
    return { ok: false, status, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
};
let sender: PushSender = webPushSender;
/** Tests: a fake push service (null restores the real one). */
export function setPushSender(s: PushSender | null): void { sender = s ?? webPushSender; }

// --- Subscriptions --------------------------------------------------------------------------------

/** Store (or move to this account) a device's subscription, keeping the account's newest PUSH_MAX_PER_ACCOUNT. */
export async function saveSubscription(userId: number, s: PushSubscriptionInput, userAgent: string | null | undefined, now = Date.now()): Promise<void> {
  const prior = await get<{ id: number; user_id: number }>("SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?", [s.endpoint]);
  // A device that changes hands (another account signs in on it) starts a clean sent log.
  if (prior && Number(prior.user_id) !== userId) await run("DELETE FROM push_sent WHERE subscription_id = ?", [prior.id]);
  await run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua_family, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ua_family = excluded.ua_family,
       created_at = CASE WHEN push_subscriptions.user_id = excluded.user_id THEN push_subscriptions.created_at ELSE excluded.created_at END,
       user_id = excluded.user_id`,
    [userId, s.endpoint, s.keys.p256dh, s.keys.auth, uaFamily(userAgent), now],
  );
  const extra = await all<{ id: number }>(
    "SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY COALESCE(last_success_at, created_at) DESC, id DESC LIMIT -1 OFFSET ?",
    [userId, PUSH_MAX_PER_ACCOUNT]);
  for (const r of extra) await dropSubscription(Number(r.id));
}

/** Remove this account's subscription for an endpoint (toggle off). False when it had none. */
export async function removeSubscription(userId: number, endpoint: string): Promise<boolean> {
  const r = await get<{ id: number }>("SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [userId, endpoint]);
  if (!r) return false;
  await dropSubscription(Number(r.id));
  return true;
}

/** Is this endpoint subscribed for this account? */
export async function hasSubscription(userId: number, endpoint: string): Promise<boolean> {
  return !!(await get("SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [userId, endpoint]));
}

/** Delete a subscription and its sent log; with `endpoint`, only if the row still has that endpoint. */
export async function dropSubscription(id: number, endpoint?: string): Promise<void> {
  if (endpoint !== undefined && !(await get("SELECT 1 FROM push_subscriptions WHERE id = ? AND endpoint = ?", [id, endpoint]))) return;
  await run("DELETE FROM push_sent WHERE subscription_id = ?", [id]);
  await run("DELETE FROM push_subscriptions WHERE id = ?", [id]);
}

// --- Who follows what ----------------------------------------------------------------------------

export interface Recipient {
  id: number; userId: number; endpoint: string; p256dh: string; auth: string; createdAt: number;
  myTeam: number | null; tracked: TrackedState; notify: Settings["notify"];
}

const parse = <K extends "myTeam" | "tracked" | "settings">(key: K, raw: unknown) => {
  if (typeof raw !== "string") return null;
  try { return cleanValue(key, JSON.parse(raw)); } catch { return null; }
};

/** Every subscription with its account's synced settings and follows. */
export async function loadRecipients(): Promise<Recipient[]> {
  const rows = await all<any>(
    `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, s.created_at,
       (SELECT value FROM user_state u WHERE u.user_id = s.user_id AND u.key = 'myTeam') my_team,
       (SELECT value FROM user_state u WHERE u.user_id = s.user_id AND u.key = 'tracked') tracked,
       (SELECT value FROM user_state u WHERE u.user_id = s.user_id AND u.key = 'settings') settings
     FROM push_subscriptions s`);
  return rows.map((r) => ({
    id: Number(r.id), userId: Number(r.user_id), endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, createdAt: Number(r.created_at),
    myTeam: parse("myTeam", r.my_team) ?? null,
    tracked: parse("tracked", r.tracked) ?? EMPTY_STATE.tracked,
    notify: (parse("settings", r.settings) ?? cleanValue("settings", {})!).notify,
  }));
}

/** My team plus tracked teams: whose events count as followed. */
const followedTeams = (r: Recipient) => new Set([...(r.myTeam ? [r.myTeam] : []), ...r.tracked.teams]);

/** Teams on each event's roster (event_teams, plus anyone in its match lineups), for "followed event". */
async function rosters(events: { season: number; code: string }[]): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  for (const e of events) {
    const k = `${e.season}:${e.code}`;
    if (out.has(k)) continue;
    const rows = await all<{ team: number }>(
      "SELECT team FROM event_teams WHERE season = ? AND code = ? UNION SELECT team FROM match_teams WHERE season = ? AND code = ?",
      [e.season, e.code, e.season, e.code]);
    out.set(k, new Set(rows.map((r) => Number(r.team))));
  }
  return out;
}

const follows = (r: Recipient, season: number, code: string, roster: Set<number> | undefined) => {
  if (r.tracked.events.includes(`${season}:${code}`)) return true;
  if (!roster) return false;
  for (const t of followedTeams(r)) if (roster.has(t)) return true;
  return false;
};

// --- Planning ------------------------------------------------------------------------------------

/** One push to send. `payload` is written at the moment of sending (a reminder's countdown is then exact), and a
 *  plan whose `expiresAt` (ms) has passed by then is dropped unsent: a reminder never arrives after its match starts. */
export interface Planned { sub: Recipient; kind: PushKind; subject: string; expiresAt: number; payload: (at: number) => PushPayload }

const pct = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
const day = (now: number, n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
const listTeams = (ts: number[]) => (ts.length <= 1 ? String(ts[0] ?? "") : `${ts.slice(0, -1).join(", ")} and ${ts[ts.length - 1]}`);

interface Lineup { red: number[]; blue: number[] }
async function lineups(season: number, code: string): Promise<Map<string, Lineup>> {
  const rows = await all<any>("SELECT level, series, number, team, alliance FROM match_teams WHERE season = ? AND code = ?", [season, code]);
  const out = new Map<string, Lineup>();
  for (const t of rows) {
    const k = `${t.level}:${t.series}:${t.number}`;
    let l = out.get(k); if (!l) { l = { red: [], blue: [] }; out.set(k, l); }
    (t.alliance === "red" ? l.red : l.blue).push(Number(t.team));
  }
  return out;
}

/** Reminders for matches starting PUSH_MIN_LEAD_MS … PUSH_LEAD_MS from now that involve a recipient's teams. */
export async function planMatchReminders(recipients: Recipient[], now = Date.now()): Promise<Planned[]> {
  const want = recipients.filter((r) => (r.notify.myTeamMatches && r.myTeam) || (r.notify.trackedTeams && r.tracked.teams.length));
  if (!want.length) return [];
  const rows = await all<any>(
    `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.timezone, e.name,
       p.p_red, p.tier
     FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     LEFT JOIN predictions p ON p.kind = 'live' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number
     WHERE m.played = 0 AND m.time IS NOT NULL AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`,
    [day(now, 1), day(now, -1)]);
  const due = rows.map((m) => ({ ...m, startMs: localToUtcMs(m.time, m.timezone) }))
    .filter((m) => m.startMs != null && m.startMs - now >= PUSH_MIN_LEAD_MS && m.startMs - now <= PUSH_LEAD_MS);
  const out: Planned[] = [];
  const lu = new Map<string, Map<string, Lineup>>();
  for (const m of due) {
    const ek = `${m.season}:${m.code}`;
    if (!lu.has(ek)) lu.set(ek, await lineups(Number(m.season), m.code));
    const key = `${m.level}:${m.series}:${m.number}`;
    const l = lu.get(ek)!.get(key);
    if (!l) continue;
    const inMatch = new Set([...l.red, ...l.blue]);
    for (const r of want) {
      const teams = [...new Set([...(r.notify.myTeamMatches && r.myTeam ? [r.myTeam] : []), ...(r.notify.trackedTeams ? r.tracked.teams : [])])].filter((t) => inMatch.has(t));
      if (!teams.length) continue;
      const first = teams[0], side = l.red.includes(first) ? "red" : "blue";
      const odds = m.p_red != null ? ` · ${first} ${pct(side === "red" ? Number(m.p_red) : 1 - Number(m.p_red))} to win (${m.tier} confidence)` : "";
      out.push({
        sub: r, kind: "match", subject: `${ek}:${key}`, expiresAt: m.startMs - PUSH_MIN_LEAD_MS,
        payload: (at) => ({
          title: `${listTeams(teams)} ${teams.length > 1 ? "play" : "plays"} ${m.label} in ${Math.max(1, Math.round((m.startMs - at) / 60_000))} min`,
          body: `${m.name}${odds}`, url: matchUrl(Number(m.season), m.code, key), tag: `match:${ek}:${key}`,
        }),
      });
    }
  }
  return out;
}

/** Did the side our pre-match call favoured by `threshold` or more lose? (outcome: 1 red won, 0 blue, 0.5 tie) */
export function isUpset(pRed: number, outcome: number, threshold = UPSET_THRESHOLD): boolean {
  if (outcome === 1) return 1 - pRed >= threshold;
  if (outcome === 0) return pRed >= threshold;
  return false;
}

/** Upsets scored in the live ledger in the last UPSET_FRESH_MS, at events each recipient follows. */
export async function planUpsets(recipients: Recipient[], now = Date.now()): Promise<Planned[]> {
  const want = recipients.filter((r) => r.notify.upsets);
  if (!want.length) return [];
  const rows = await all<any>(
    `SELECT p.season, p.code, p.level, p.series, p.number, p.red, p.blue, p.p_red, p.tier, p.red_score, p.blue_score, p.outcome, p.scored_at, m.label, e.name
     FROM predictions p
     JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
     JOIN events e ON e.season = p.season AND e.code = p.code
     WHERE p.kind = 'live' AND p.outcome IS NOT NULL AND p.scored_at >= ?`,
    [new Date(now - UPSET_FRESH_MS).toISOString()]);
  const upsets = rows.filter((p) => isUpset(Number(p.p_red), Number(p.outcome)));
  if (!upsets.length) return [];
  const roster = await rosters(upsets.map((p) => ({ season: Number(p.season), code: p.code })));
  const out: Planned[] = [];
  for (const p of upsets) {
    const season = Number(p.season), redWon = Number(p.outcome) === 1;
    const red: number[] = JSON.parse(p.red), blue: number[] = JSON.parse(p.blue);
    const [winners, losers] = redWon ? [red, blue] : [blue, red];
    const [ws, ls] = redWon ? [p.red_score, p.blue_score] : [p.blue_score, p.red_score];
    const underdog = redWon ? Number(p.p_red) : 1 - Number(p.p_red);
    const key = `${p.level}:${p.series}:${p.number}`;
    const scoredAt = Date.parse(p.scored_at);
    for (const r of want) {
      if (!(scoredAt >= r.createdAt) || !follows(r, season, p.code, roster.get(`${season}:${p.code}`))) continue;
      out.push({
        sub: r, kind: "upset", subject: `${season}:${p.code}:${key}`, expiresAt: now + 3600_000,
        payload: () => ({
          title: `Upset in ${p.label} at ${p.name}`,
          body: `${listTeams(winners)} beat ${listTeams(losers)} ${ws}–${ls}. Our call before the match gave them ${pct(underdog)} (${p.tier} confidence).`,
          url: matchUrl(season, p.code, key), tag: `upset:${season}:${p.code}:${key}`,
        }),
      });
    }
  }
  return out;
}

/** Followed events that started (first result in, or first scheduled start passed) on their first day. */
export async function planEventStarts(recipients: Recipient[], now = Date.now()): Promise<Planned[]> {
  const want = recipients.filter((r) => r.notify.eventStart);
  if (!want.length) return [];
  const rows = await all<any>(
    `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.timezone,
       (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played,
       (SELECT MIN(m.time) FROM matches m WHERE m.season = e.season AND m.code = e.code) first_time
     FROM events e WHERE e.start >= ? AND e.start <= ?`,
    [day(now, -1), day(now, 1)]);
  const started = rows.filter((e) => {
    if (!isEventDay(e, now)) return false;
    const firstDay = e.timezone ? localDate(now, e.timezone) === e.start : true;
    if (!firstDay) return false;
    const first = localToUtcMs(e.first_time, e.timezone);
    return Number(e.played) > 0 || (first != null && first <= now);
  });
  if (!started.length) return [];
  const roster = await rosters(started.map((e) => ({ season: Number(e.season), code: e.code })));
  const out: Planned[] = [];
  for (const e of started) {
    const season = Number(e.season);
    for (const r of want) {
      if (!follows(r, season, e.code, roster.get(`${season}:${e.code}`))) continue;
      out.push({
        sub: r, kind: "start", subject: `${season}:${e.code}`, expiresAt: now + 3 * 3600_000,
        payload: () => ({
          title: `${e.name} has started`,
          body: Number(e.played) > 0 ? "First results are in. Live odds and rankings on the event page." : "Matches are under way. Live odds and results on the event page.",
          url: eventUrl(season, e.code), tag: `start:${season}:${e.code}`,
        }),
      });
    }
  }
  return out;
}

// --- Delivering ----------------------------------------------------------------------------------

export interface PushReport { planned: number; sent: number; limited: number; failed: number; retry: number; pruned: number; expired: number }

/** Claim and send each planned push once (see the header). `now` is when the plans were made; sends take real
 *  time (a slow push service: up to 10 s each), so each one reads the clock again as it goes. */
export async function deliver(plans: Planned[], now = Date.now(), log: Log = () => {}): Promise<PushReport> {
  const report: PushReport = { planned: plans.length, sent: 0, limited: 0, failed: 0, retry: 0, pruned: 0, expired: 0 };
  const t0 = Date.now(), clock = () => now + (Date.now() - t0);
  const seen = new Set<string>(), gone = new Set<number>(), recent = new Map<number, number>();
  for (const p of plans) {
    const k = `${p.sub.id}|${p.kind}|${p.subject}`;
    if (seen.has(k) || gone.has(p.sub.id)) continue;
    seen.add(k);
    if (clock() >= p.expiresAt) { report.expired++; continue; } // too late to be useful: never sent
    if (!recent.has(p.sub.id)) {
      const c = await get<{ n: number }>("SELECT COUNT(*) n FROM push_sent WHERE subscription_id = ? AND outcome = 'sent' AND at > ?", [p.sub.id, now - 864e5]);
      recent.set(p.sub.id, Number(c?.n ?? 0));
    }
    const limited = recent.get(p.sub.id)! >= PUSH_DAILY_LIMIT;
    const claimed = await run("INSERT OR IGNORE INTO push_sent (subscription_id, kind, subject, at, outcome) VALUES (?, ?, ?, ?, ?)",
      [p.sub.id, p.kind, p.subject, now, limited ? "limited" : "sending"]);
    if (!claimed) continue; // already sent (or being sent) by an earlier tick or another server
    if (limited) { report.limited++; continue; }
    const at = clock();
    if (at >= p.expiresAt) {
      await run("DELETE FROM push_sent WHERE subscription_id = ? AND kind = ? AND subject = ?", [p.sub.id, p.kind, p.subject]);
      report.expired++;
      continue;
    }
    const r = await sender({ endpoint: p.sub.endpoint, keys: { p256dh: p.sub.p256dh, auth: p.sub.auth } }, JSON.stringify(p.payload(at)), Math.max(1, Math.floor((p.expiresAt - at) / 1000)));
    if (r.ok) {
      await run("UPDATE push_sent SET outcome = 'sent' WHERE subscription_id = ? AND kind = ? AND subject = ?", [p.sub.id, p.kind, p.subject]);
      await run("UPDATE push_subscriptions SET last_success_at = ? WHERE id = ? AND endpoint = ?", [now, p.sub.id, p.sub.endpoint]);
      recent.set(p.sub.id, recent.get(p.sub.id)! + 1);
      report.sent++;
    } else if (r.status === 404 || r.status === 410) {
      // The browser unsubscribed (or the site's permission was revoked): this endpoint is gone for good. Only that
      // endpoint's row goes (ids are never reused, and the endpoint is checked too), never a newer subscription.
      await dropSubscription(p.sub.id, p.sub.endpoint);
      gone.add(p.sub.id);
      report.pruned++;
    } else if (r.status == null || r.status === 429 || r.status >= 500) {
      // The push service is busy or unreachable: free the claim, the next tick tries again while it's timely.
      await run("DELETE FROM push_sent WHERE subscription_id = ? AND kind = ? AND subject = ?", [p.sub.id, p.kind, p.subject]);
      report.retry++;
    } else {
      await run("UPDATE push_sent SET outcome = 'failed' WHERE subscription_id = ? AND kind = ? AND subject = ?", [p.sub.id, p.kind, p.subject]);
      report.failed++;
      log(`push: a push service refused a ${p.kind} push (${r.status})`);
    }
  }
  return report;
}

let ticking: Promise<PushReport | null> | null = null;

/** One pass: plan every kind for every subscription and deliver. Null when push is unavailable or unused. */
export async function pushTick(now = Date.now(), log: Log = () => {}): Promise<PushReport | null> {
  if (ticking) return ticking;
  ticking = (async () => {
    if (!(await pushAvailable())) return null;
    const recipients = await loadRecipients();
    if (!recipients.length) return null;
    const plans = [
      ...await planMatchReminders(recipients, now),
      ...await planUpsets(recipients, now),
      ...await planEventStarts(recipients, now),
    ];
    if (!plans.length) return null;
    const r = await deliver(plans, now, log);
    if (r.sent || r.pruned || r.failed || r.limited) log(`push: ${r.sent} sent${r.limited ? `, ${r.limited} over the daily limit` : ""}${r.failed ? `, ${r.failed} refused` : ""}${r.pruned ? `, ${r.pruned} gone subscriptions removed` : ""}`);
    return r;
  })();
  try { return await ticking; } finally { ticking = null; }
}

/** The sent log only needs to outlive what it de-dupes (a match, an upset, an event's first day): 7 days. */
export async function pruneSentLog(now = Date.now()): Promise<number> {
  return run("DELETE FROM push_sent WHERE at < ?", [now - 7 * 864e5]);
}
