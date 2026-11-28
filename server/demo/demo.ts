// The demo account (docs/demo.md): one shared, read-only account anyone can open from /demo to see Control Scout
// used to its full potential — a My team, followed teams and events, a ranked shortlist with notes, saved
// predictions, personal scouting, a team workspace with several scouts' entries, comments, a shared pick list and
// assignments, a video library with notes, and an inbox.
//
// Everything about FTC in it is real (teams, events, matches, ratings, predictions, videos), picked fresh from the
// database whenever the demo is re-seeded (every DEMO_FRESH_MS), so it never goes stale. Only what a user would have
// typed themselves (scouting answers and notes, comments) is sample content, and every demo page says so (DemoBanner).
//
// Read-only: any change from a demo session is refused (demoReadOnly), so no visitor can edit what the next one sees.
// The demo workspace never reaches Control Point: its membership, members and account answer come from here
// (isDemoAccount / isDemoWorkspace short-circuits in server/auth/controlPoint.ts).
import type { InStatement } from "@libsql/client";
import type { NextFunction, Request, Response } from "express";
import { all, get, writeBatch } from "../db.js";
import { currentUser, getUser, hasSessionCookie, type User } from "../auth/session.js";
import { builtinTemplate } from "../../src/shared/scoutDefaults.js";
import { detailKey, type ScoutField } from "../../src/shared/scoutTemplate.js";
import { DEFAULT_SETTINGS, type PersonalState, type SavedPrediction } from "../../src/shared/personal.js";
import { inboxCategory, inboxLink, inboxText } from "../../src/shared/inbox.js";
import type { FeedItem } from "../../src/shared/videosFeed.js";

export const DEMO_PROVIDER = "demo";
const DEMO_SUBJECT = "demo-account";
/** The demo's shared-account ids: far above any Control Point account id, so never one of theirs. The demo user is the first. */
export const DEMO_ACCOUNT_ID = 2_100_000_000;
const DEMO_ACCOUNT_LAST = DEMO_ACCOUNT_ID + 9;
export { DEMO_WORKSPACE_ID };
export const DEMO_WORKSPACE_NAME = "Demo Robotics (sample workspace)";
export const DEMO_DISPLAY_NAME = "Demo Scout";
export const DEMO_USERNAME = "DemoScout";
/** How long a seed stays: after this, the next visitor entering the demo re-seeds it from the current data. */
export const DEMO_FRESH_MS = 6 * 3600_000;
/** What a demo session gets back for any change. */
import { DEMO_READ_ONLY, DEMO_READ_ONLY_CODE, DEMO_READ_ONLY_STATUS, demoRefuses, DEMO_WORKSPACE_ID, type DemoSummary } from "../../src/shared/demo.js";

export const isDemoAccount = (id: unknown): boolean => typeof id === "number" && id >= DEMO_ACCOUNT_ID && id <= DEMO_ACCOUNT_LAST;
export const isDemoWorkspace = (id: unknown): boolean => id === DEMO_WORKSPACE_ID;

/** The sample scouts in the demo workspace: the demo user first (an admin), then four teammates. */
export const DEMO_SCOUTS = [
  { accountId: DEMO_ACCOUNT_ID, name: DEMO_DISPLAY_NAME, role: "admin" as const },
  { accountId: DEMO_ACCOUNT_ID + 1, name: "Avery", role: "admin" as const },
  { accountId: DEMO_ACCOUNT_ID + 2, name: "Jordan", role: "member" as const },
  { accountId: DEMO_ACCOUNT_ID + 3, name: "Sam", role: "member" as const },
  { accountId: DEMO_ACCOUNT_ID + 4, name: "Riley", role: "member" as const },
];

let demoId: number | null | undefined;
/** The demo user's id, or null when the demo was never opened on this database. Cached once known. */
export async function demoUserId(): Promise<number | null> {
  if (demoId != null) return demoId;
  const r = await get<{ user_id: number }>("SELECT user_id FROM identities WHERE provider = ? AND subject = ?", [DEMO_PROVIDER, DEMO_SUBJECT]);
  if (r) demoId = Number(r.user_id);
  return demoId ?? null;
}
/** Tests: forget the cached id (a fresh database). */
export const resetDemoCache = () => { demoId = undefined; seeding = null; };
/** Tests: the seed in progress, if any. */
export const demoSeeding = () => seeding;

export async function isDemoUser(u: Pick<User, "id"> | null | undefined): Promise<boolean> {
  if (!u) return false;
  const id = await demoUserId();
  return id != null && u.id === id;
}

// --- What the demo workspace looks like to Scout, in place of Control Point's answers -------------------------------

export const demoWorkspaces = () => [{ id: DEMO_WORKSPACE_ID, name: DEMO_WORKSPACE_NAME, role: "admin" as const }];
/** The account answer /api/auth/me shows for the demo (Control Point's shape): its team is the seeded My team, read from
 *  the stored row every time (two small reads, demo only): nothing cached, so a re-seed is seen as soon as it commits. */
export async function demoControlPointInfo(url: string) {
  const id = await demoUserId();
  const row = id == null ? null : await get<{ value: string }>("SELECT value FROM user_state WHERE user_id = ? AND key = 'myTeam'", [id]);
  const n = row ? Number(JSON.parse(row.value)) : NaN;
  const team = Number.isInteger(n) && n > 0 ? { teamNumber: n, name: (await get<{ name: string }>("SELECT name FROM teams WHERE number = ?", [n]))?.name || `Team ${n}` } : null;
  return { accountId: DEMO_ACCOUNT_ID, member: true, teams: team ? [team] : [], shortlist: [] as number[], workspaces: demoWorkspaces(), url };
}
export const demoMembers = () => DEMO_SCOUTS.map((s) => ({ accountId: s.accountId, name: s.name, role: s.role }));

// --- Read-only ---------------------------------------------------------------------------------------------------------

/** Express guard on /api: a change (anything but GET/HEAD/OPTIONS) from the demo session is refused with 405, a
 *  status the app reacts to nowhere else (a 403 would read as "removed from the workspace", a 423 as "deleted"). */
export function demoReadOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!demoRefuses(req.method, req.path)) { next(); return; }
    // No session cookie, read exactly as currentUser reads one (names trimmed): no lookup needed.
    if (!hasSessionCookie(req)) { next(); return; }
    (async () => {
      const user = await currentUser(req).catch(() => null);
      if (user && (await isDemoUser(user))) { res.status(DEMO_READ_ONLY_STATUS).json({ error: DEMO_READ_ONLY, code: DEMO_READ_ONLY_CODE }); return; }
      next();
    })().catch(next);
  };
}

// --- Entering, and seeding -------------------------------------------------------------------------------------------

let seeding: Promise<void> | null = null;

/** One seed at a time; a failed one is logged and tried again by the next visitor. */
function reseed(id: number, now: number): Promise<void> {
  if (!seeding) seeding = seedDemo(id, now).catch((e) => { console.warn(`[demo] seed failed: ${(e as Error)?.message ?? e}`); throw e; }).finally(() => { seeding = null; });
  return seeding;
}

/**
 * The demo user, ready to open. The first visit ever waits for the first seed; after that the demo opens at once,
 * and a seed older than DEMO_FRESH_MS is redone in the background from the current data (one transaction, so a
 * visitor sees the old demo or the new one, never half of each).
 */
export async function demoAccount(now = Date.now()): Promise<User> {
  const id = await ensureDemoUser();
  const seededAt = Number((await get<{ value: string }>("SELECT value FROM kv WHERE key = 'demo:seededAt'"))?.value ?? 0);
  if (!seededAt) await reseed(id, now);
  else if (now - seededAt > DEMO_FRESH_MS) void reseed(id, now).catch(() => undefined);
  const u = await getUser(id);
  if (!u) throw new Error("The demo account is missing.");
  return u;
}

let creating: Promise<number> | null = null;
/** The demo user's id, made on the first visit: one creation at a time, so two first visits share one user. */
function ensureDemoUser(): Promise<number> {
  if (!creating) creating = createDemoUser().finally(() => { creating = null; });
  return creating;
}

async function createDemoUser(): Promise<number> {
  const known = await demoUserId();
  if (known != null) return known;
  // No email: the demo can never be signed into by a code, Google or Control Point, nor merged with a real account.
  const username = (await get("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", [DEMO_USERNAME])) ? null : DEMO_USERNAME;
  const u = await get<{ id: number }>("INSERT INTO users (email, display_name, created_at, username, username_changed_at) VALUES (NULL, ?, ?, ?, ?) RETURNING id",
    [DEMO_DISPLAY_NAME, new Date().toISOString(), username, new Date().toISOString()]);
  const id = Number(u!.id);
  await writeBatch([
    { sql: "INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)", args: [DEMO_PROVIDER, DEMO_SUBJECT, id] },
    { sql: "INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES ('control-point', ?, ?)", args: [String(DEMO_ACCOUNT_ID), id] },
  ]);
  demoId = Number((await get<{ user_id: number }>("SELECT user_id FROM identities WHERE provider = ? AND subject = ?", [DEMO_PROVIDER, DEMO_SUBJECT]))!.user_id);
  return demoId;
}

/** A small deterministic random number generator, so one seed always reads the same (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface TeamAtEvent { team: number; name: string; opr: number; auto: number; wins: number; losses: number; ties: number; matches: number }
interface PlayedMatch { level: string; series: number; number: number; label: string; red: number[]; blue: number[]; time: string | null }

/** The event the demo scouts: the season's most recent finished event with a good number of played qualification matches. */
async function pickEvent(today: string): Promise<{ season: number; code: string; name: string; region: string | null } | null> {
  for (const minMatches of [16, 8, 1]) {
    const r = await get<any>(
      `SELECT e.season, e.code, e.name, e.region FROM events e
         JOIN matches m ON m.season = e.season AND m.code = e.code AND m.level = 'qual' AND m.played = 1
        WHERE e.season = (SELECT MAX(season) FROM matches WHERE played = 1) AND COALESCE(e."end", e.start) <= ?
        GROUP BY e.season, e.code HAVING COUNT(*) >= ? ORDER BY COALESCE(e."end", e.start) DESC, COUNT(*) DESC LIMIT 1`, [today, minMatches]);
    if (r) return { season: Number(r.season), code: String(r.code), name: String(r.name), region: r.region ?? null };
  }
  return null;
}

/** Re-seed every demo row from the current data, in one transaction (a visitor never sees half a demo). */
export async function seedDemo(userId: number, now = Date.now()): Promise<void> {
  const today = new Date(now).toISOString().slice(0, 10);
  const ev = await pickEvent(today);
  const stmts: InStatement[] = [];
  const S = (sql: string, args: any[] = []) => stmts.push({ sql, args });

  // Out with the last seed (the demo's own rows only: by its user id, its workspace and its sample account ids).
  const wsRow = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [DEMO_WORKSPACE_ID]);
  // The last seed's entries, read before they go: a device that already pulled them holds a cursor (seq) into them, so the
  // new seed numbers on from the highest one, and an entry it no longer has comes back as a tombstone (entries.ts pulls
  // seq > cursor). Without this, a visitor who stayed through a re-seed would never see it.
  const oldEntries = wsRow ? await all<{ uuid: string; season: number; team: number; event_code: string | null; match_label: string | null; kind: string; author_account_id: number | null; author_name: string | null; template_id: string | null; seq: number }>(
    "SELECT uuid, season, team, event_code, match_label, kind, author_account_id, author_name, template_id, seq FROM workspace_scout_entries WHERE workspace_id = ?", [wsRow.id]) : [];
  for (const t of ["user_state", "scout_entries", "inbox_items", "video_library", "video_notes", "video_watch", "digest_prefs"]) S(`DELETE FROM ${t} WHERE user_id = ?`, [userId]);
  if (wsRow) for (const t of ["workspace_scout_entries", "workspace_picklist", "workspace_picklist_versions", "workspace_assignments", "workspace_match_assignments", "workspace_entry_comments", "workspace_activity"]) S(`DELETE FROM ${t} WHERE workspace_id = ?`, [wsRow.id]);
  S("DELETE FROM workspace_members WHERE account_id BETWEEN ? AND ?", [DEMO_ACCOUNT_ID, DEMO_ACCOUNT_LAST]);

  const iso = new Date(now).toISOString();
  S("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, orphaned_at = NULL, orphan_reason = NULL",
    [DEMO_WORKSPACE_ID, DEMO_WORKSPACE_NAME, iso, iso]);
  for (const s of DEMO_SCOUTS) S("INSERT INTO workspace_members (account_id, cp_workspace_id, workspace_name, role, updated_at) VALUES (?, ?, ?, ?, ?)", [s.accountId, DEMO_WORKSPACE_ID, DEMO_WORKSPACE_NAME, s.role, now]);
  const WS = `(SELECT id FROM workspaces WHERE cp_workspace_id = '${DEMO_WORKSPACE_ID}')`;
  // The workspace's entry numbers carry on from the last seed's highest (see oldEntries above).
  let seq = oldEntries.reduce((m, e) => Math.max(m, Number(e.seq)), 0);
  /** A tombstone (deleted, a new seq) for each of the last seed's entries this one doesn't write again: every path writes
   *  them, an empty re-seed included, so a device that pulled them is told they're gone. */
  const tombstones = (kept: ReadonlySet<string>) => {
    for (const o of oldEntries) {
      if (kept.has(o.uuid)) continue;
      S(`INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq, template_id, template_version)
           VALUES (${WS}, ?, ?, ?, ?, ?, ?, '{}', '', ?, 1, ?, ?, ?, ?, ?, ?, 0)`,
        [o.uuid, o.season, o.team, o.event_code, o.match_label, o.kind, now, o.author_account_id, o.author_name, o.author_account_id, o.author_name, ++seq, o.template_id]);
    }
  };
  const state = (key: keyof PersonalState, value: unknown) => S("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)", [userId, key, JSON.stringify(value), now]);
  state("settings", DEFAULT_SETTINGS);
  S("INSERT INTO digest_prefs (user_id, enabled, token, updated_at, welcomed_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enabled = 1", [userId, `demo-${userId}`, iso, iso]);

  if (!ev) { // No finished event anywhere yet (an empty database): the demo opens with its settings only.
    tombstones(new Set());
    S("DELETE FROM kv WHERE key = 'demo:summary'");
    S("INSERT INTO kv (key, value, updated_at) VALUES ('demo:seededAt', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [String(now), iso]);
    await writeBatch(stmts);
    return;
  }

  const teams: TeamAtEvent[] = (await all<any>(
    `SELECT s.team, COALESCE(t.name, '') name, COALESCE(s.opr_np, 0) opr, COALESCE(s.opr_auto, 0) auto, s.wins, s.losses, s.ties, s.matches
       FROM team_event_stats s LEFT JOIN teams t ON t.number = s.team WHERE s.season = ? AND s.code = ? ORDER BY s.opr_np DESC`, [ev.season, ev.code]))
    .map((r) => ({ team: Number(r.team), name: String(r.name), opr: Number(r.opr), auto: Number(r.auto), wins: Number(r.wins ?? 0), losses: Number(r.losses ?? 0), ties: Number(r.ties ?? 0), matches: Number(r.matches ?? 0) }));
  const matchRows = await all<any>(
    `SELECT m.level, m.series, m.number, m.label, m.time, mt.team, mt.alliance FROM matches m JOIN match_teams mt
        ON mt.season = m.season AND mt.code = m.code AND mt.level = m.level AND mt.series = m.series AND mt.number = m.number
      WHERE m.season = ? AND m.code = ? AND m.level = 'qual' AND m.played = 1 ORDER BY m.number, mt.alliance, mt.station`, [ev.season, ev.code]);
  const byKey = new Map<string, PlayedMatch>();
  for (const r of matchRows) {
    const k = `${r.level}:${r.series}:${r.number}`;
    const m = byKey.get(k) ?? { level: r.level, series: Number(r.series), number: Number(r.number), label: r.label || `Q${r.number}`, red: [], blue: [], time: r.time ?? null };
    (r.alliance === "red" ? m.red : m.blue).push(Number(r.team));
    byKey.set(k, m);
  }
  const matches = [...byKey.values()].filter((m) => m.red.length && m.blue.length);
  if (!teams.length) for (const t of new Set(matches.flatMap((m) => [...m.red, ...m.blue]))) teams.push({ team: t, name: "", opr: 0, auto: 0, wins: 0, losses: 0, ties: 0, matches: 0 });
  if (!teams.length) { tombstones(new Set()); S("DELETE FROM kv WHERE key = 'demo:summary'"); S("INSERT INTO kv (key, value, updated_at) VALUES ('demo:seededAt', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [String(now), iso]); await writeBatch(stmts); return; }

  // The workspace's default event for new entries is the demo's event (Settings › Workspace; Scout suggests it).
  S("UPDATE workspaces SET settings = ?, settings_version = settings_version + 1 WHERE cp_workspace_id = ?",
    [JSON.stringify({ defaults: { season: ev.season, eventCode: ev.code, updatedAt: iso, updatedBy: DEMO_SCOUTS[1].name }, entryPolicy: { create: "members", edit: "members", delete: "author-or-admin" } }), DEMO_WORKSPACE_ID]);
  const rand = rng(ev.season * 7919 + [...ev.code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const maxOpr = Math.max(1, ...teams.map((t) => t.opr));
  const strength = new Map(teams.map((t) => [t.team, Math.max(0.05, Math.min(1, t.opr / maxOpr))]));
  const mine = teams[0];
  const myTeam = { teamNumber: mine.team, name: mine.name || `Team ${mine.team}` };
  const others = teams.slice(1);

  // Personal: My team, followed teams and events, the shortlist (its order is the pick order) with notes and colours.
  state("myTeam", mine.team);
  const upcoming = await get<any>(`SELECT season, code FROM events WHERE season = ? AND start > ? ${ev.region ? "AND region = ?" : ""} ORDER BY start LIMIT 1`,
    ev.region ? [ev.season, today, ev.region] : [ev.season, today]);
  state("tracked", { teams: others.slice(0, 4).map((t) => t.team), events: [`${ev.season}:${ev.code}`, ...(upcoming ? [`${upcoming.season}:${upcoming.code}`] : [])] });
  const shortlist = others.slice(0, 8);
  state("bookmarks", shortlist.map((t) => t.team));
  const record = (t: TeamAtEvent) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
  state("shortlistNotes", Object.fromEntries(shortlist.slice(0, 5).map((t, i) => [String(t.team), [
    `First pick if they're there. ${record(t)} at ${ev.code}, about ${Math.round(t.opr)} points a match.`,
    `Strong auto (about ${Math.round(t.auto)} points). Ask about their endgame in the pits.`,
    `Steady partner: ${record(t)}. Check their drivetrain held up in the last matches.`,
    `Good second pick: scores well and plays clean.`,
    `Backup option if the top picks are gone.`,
  ][i]])));
  state("teamColors", Object.fromEntries(shortlist.slice(0, 3).map((t, i) => [String(t.team), ["emerald", "sky", "orange"][i]])));
  state("videoLinks", {});

  // Saved predictions: real engine calls on real pairings from the event.
  const saved: SavedPrediction[] = [];
  try {
    const { matchExplanation } = await import("../api/predictMatch.js");
    const pairings = [[[mine.team, others[1]?.team], [others[0]?.team, others[2]?.team]], [[mine.team, others[3]?.team], [others[4]?.team, others[5]?.team]], [[others[0]?.team, others[6]?.team], [others[1]?.team, others[7]?.team]]];
    for (const [i, [red, blue]] of pairings.entries()) {
      if ([...red, ...blue].some((t) => t == null)) continue;
      const x = await matchExplanation(ev.season, red as number[], blue as number[], "qual");
      if (x) saved.push({ id: `demo${i}`, season: ev.season, red: x.red, blue: x.blue, winProbRed: x.winProbRed, predictedRed: x.predictedRed, predictedBlue: x.predictedBlue, tier: x.confidence.tier, savedAt: now - (i + 1) * 3600_000, ...(i === 0 ? { note: "If we're paired like this in the playoffs" } : {}) });
    }
  } catch { /* ratings not ready: no saved predictions */ }
  state("predictionHistory", saved);

  // Scouting answers: sample values shaped by each team's real strength at the event, for whatever template the season has.
  const answer = (f: ScoutField, s: number): Record<string, unknown> => {
    const jitter = () => (rand() - 0.5) * 0.4;
    const level = Math.max(0, Math.min(1, s + jitter()));
    switch (f.type) {
      case "toggle": return { [f.id]: f.id === "broke" ? rand() < 0.06 : f.id === "defense" ? rand() < 0.2 : rand() < 0.3 + level * 0.65 };
      case "toggleDetail": { const yes = rand() < 0.35 + level * 0.6; return { [f.id]: yes, ...(yes ? { [detailKey(f.id)]: f.id === "canDefend" ? "Can push, prefers to score" : "Most matches" } : {}) }; }
      case "counter": return { [f.id]: f.id === "fouls" ? (rand() < 0.75 ? 0 : 1) : Math.round(level * (f.max ?? 10) * 0.55) };
      case "rating": return { [f.id]: Math.max(1, Math.min(f.max ?? 5, Math.round(1 + level * ((f.max ?? 5) - 1)))) };
      // A match's choices run worst to best (None → Full); a pit's are just kinds (drivetrain, start side).
      case "choice": { const o = f.options ?? []; return o.length ? { [f.id]: o[Math.min(o.length - 1, Math.floor((f.phase === "pit" ? rand() : level) * o.length))] } : {}; }
      case "number": return { [f.id]: f.id === "weight" ? Math.round(28 + rand() * 12) : Math.round(level * (f.max ?? 10)) };
      default: return {};
    }
  };
  const matchFields = builtinTemplate(ev.season, "match").fields, pitFields = builtinTemplate(ev.season, "pit").fields;
  const answers = (fields: ScoutField[], team: number) => JSON.stringify(Object.assign({}, ...fields.map((f) => answer(f, strength.get(team) ?? 0.3))));
  const matchNote = (team: number) => {
    const s = strength.get(team) ?? 0.3, r = rand();
    if (r > 0.45) return "";
    return s > 0.75 ? ["Fast cycles, never wasted time.", "Carried the alliance in TeleOp.", "Clean auto, no fouls."][Math.floor(rand() * 3)]
      : s > 0.45 ? ["Solid, a bit slow in endgame.", "Good auto, missed a few in TeleOp.", "Played some defense late."][Math.floor(rand() * 3)]
        : ["Struggled to score this match.", "Lost connection for ~10 s mid-match.", "Mostly played defense."][Math.floor(rand() * 3)];
  };

  // Personal scouting (Scout › Personal): pit notes on the shortlist's top teams and two match entries.
  for (const [i, t] of shortlist.slice(0, 3).entries()) {
    S("INSERT INTO scout_entries (uuid, user_id, season, team, event_code, match_label, kind, data, notes, updated_at, deleted) VALUES (?, ?, ?, ?, ?, NULL, 'pit', ?, ?, ?, 0)",
      [`demo-personal-pit-${i}`, userId, ev.season, t.team, ev.code, answers(pitFields, t.team), ["Friendly team, happy to share their auto paths.", "Asked about their lift: rebuilt it after the last event.", "Small team, very organised pit."][i], now - (i + 2) * 3600_000]);
  }
  for (const [i, m] of matches.filter((x) => x.red.includes(mine.team) || x.blue.includes(mine.team)).slice(0, 2).entries()) {
    S("INSERT INTO scout_entries (uuid, user_id, season, team, event_code, match_label, kind, data, notes, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 'match', ?, ?, ?, 0)",
      [`demo-personal-match-${i}`, userId, ev.season, mine.team, ev.code, m.label, answers(matchFields, mine.team), i === 0 ? "Our match: auto worked, endgame was late." : "", now - (i + 5) * 3600_000]);
  }

  // The team workspace: one scout per slot each match (as match assignments would split it), plus pit scouting.
  const slotScout = [DEMO_SCOUTS[1], DEMO_SCOUTS[2], DEMO_SCOUTS[3], DEMO_SCOUTS[4]];
  const scouted = matches.slice(0, 30);
  const entryUuids: { uuid: string; team: number; label: string | null; kind: string; author: (typeof DEMO_SCOUTS)[number] }[] = [];
  const span = Math.max(1, scouted.length);
  for (const [mi, m] of scouted.entries()) {
    const slots = [m.red[0], m.red[1], m.blue[0], m.blue[1]];
    for (const [si, team] of slots.entries()) {
      if (team == null) continue;
      // The demo user scouts a few matches themselves (their own team's), so "mine" shows too.
      const author = (m.red.includes(mine.team) || m.blue.includes(mine.team)) && team === mine.team ? DEMO_SCOUTS[0] : slotScout[si];
      const uuid = `demo-ws-${m.number}-${si}`;
      const at = now - (span - mi) * 9 * 60_000 - 86_400_000;
      S(`INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq, template_id, template_version)
           VALUES (${WS}, ?, ?, ?, ?, ?, 'match', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0)`,
        [uuid, ev.season, team, ev.code, m.label, answers(matchFields, team), matchNote(team), at, author.accountId, author.name, author.accountId, author.name, ++seq, `match-${ev.season}`]);
      entryUuids.push({ uuid, team, label: m.label, kind: "match", author });
    }
  }
  for (const [i, t] of teams.slice(0, 24).entries()) {
    const author = DEMO_SCOUTS[1 + (i % 4)];
    const uuid = `demo-ws-pit-${t.team}`;
    S(`INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq, template_id, template_version)
         VALUES (${WS}, ?, ?, ?, ?, NULL, 'pit', ?, ?, ?, 0, ?, ?, ?, ?, ?, 'pit', 0)`,
      [uuid, ev.season, t.team, ev.code, answers(pitFields, t.team), i % 3 === 0 ? "Talked to their drive coach; they want a partner with a strong auto." : "", now - 2 * 86_400_000 + i * 60_000, author.accountId, author.name, author.accountId, author.name, ++seq]);
    entryUuids.push({ uuid, team: t.team, label: null, kind: "pit", author });
  }
  tombstones(new Set(entryUuids.map((e) => e.uuid)));

  // Comments on a few entries, and the inbox items they (and other activity) make for the demo user.
  const inbox: { at: number; type: string; d: Record<string, unknown>; actor: (typeof DEMO_SCOUTS)[number]; read: boolean }[] = [];
  const commented = entryUuids.filter((e) => e.kind === "match").slice(0, 40).filter((_, i) => i % 9 === 0).slice(0, 4);
  const lines = ["Agree, their auto is the best here.", "Double-check this one: I had them scoring more.", "They fixed this after lunch.", "Worth a pit visit before alliance selection."];
  for (const [i, e] of commented.entries()) {
    const by = DEMO_SCOUTS[1 + ((i + 1) % 4)], at = now - (6 - i) * 3600_000;
    S("INSERT INTO workspace_entry_comments (workspace_id, entry_uuid, author_account_id, author_name, body, created_at) VALUES (" + WS + ", ?, ?, ?, ?, ?)", [e.uuid, by.accountId, by.name, lines[i], at]);
    S(`INSERT INTO workspace_activity (workspace_id, at, actor_account_id, actor_name, type, subject, details) VALUES (${WS}, ?, ?, ?, 'comment.created', ?, ?)`,
      [at, by.accountId, by.name, `entry:${e.uuid}`, JSON.stringify({ uuid: e.uuid, team: e.team, matchLabel: e.label, kind: e.kind, eventCode: ev.code, season: ev.season, excerpt: lines[i] })]);
  }
  // A comment thread on one of the demo user's own entries, so the inbox has it.
  const ownEntry = entryUuids.find((e) => e.author.accountId === DEMO_ACCOUNT_ID);
  if (ownEntry) {
    const at = now - 50 * 60_000, body = "Nice notes. Can you add how their endgame went?";
    S("INSERT INTO workspace_entry_comments (workspace_id, entry_uuid, author_account_id, author_name, body, created_at) VALUES (" + WS + ", ?, ?, ?, ?, ?)", [ownEntry.uuid, DEMO_SCOUTS[1].accountId, DEMO_SCOUTS[1].name, body, at]);
    inbox.push({ at, type: "comment.created", d: { uuid: ownEntry.uuid, team: ownEntry.team, matchLabel: ownEntry.label, kind: "match", eventCode: ev.code, season: ev.season, excerpt: body }, actor: DEMO_SCOUTS[1], read: false });
  }

  // The shared pick list: the strongest teams, ranked, with notes from the scouts.
  const picks = others.slice(0, 12);
  for (const [i, t] of picks.entries()) {
    const by = DEMO_SCOUTS[i % 2 === 0 ? 1 : 0];
    const note = i === 0 ? "Everyone agrees: first pick." : i === 2 ? "Great auto; check reliability." : i === 5 ? "Sleeper pick: improved every match." : "";
    S(`INSERT INTO workspace_picklist (workspace_id, season, team, rank, added_by_account_id, added_by_name, added_at, note, note_by_account_id, note_by_name, note_updated_at)
         VALUES (${WS}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ev.season, t.team, i + 1, by.accountId, by.name, now - 3 * 3600_000 + i * 60_000, note, note ? by.accountId : null, note ? by.name : null, note ? now - 2 * 3600_000 : null]);
  }
  S(`INSERT INTO workspace_picklist_versions (workspace_id, season, version, updated_at) VALUES (${WS}, ?, ?, ?)`, [ev.season, picks.length, now - 2 * 3600_000]);
  if (picks[2]) inbox.push({ at: now - 2 * 3600_000, type: "picklist.moved", d: { season: ev.season, team: picks[2].team, to: 3 }, actor: DEMO_SCOUTS[1], read: true });

  // Assignments: pit visits (some done) and match scouting, one slot per scout.
  for (const [i, t] of teams.slice(0, 8).entries()) {
    const to = DEMO_SCOUTS[i % 5], done = i < 5;
    S(`INSERT INTO workspace_assignments (workspace_id, season, event_code, team, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at, status, done_at, done_by, done_by_name)
         VALUES (${WS}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ev.season, ev.code, t.team, to.accountId, to.name, DEMO_SCOUTS[1].accountId, DEMO_SCOUTS[1].name, now - 3 * 86_400_000, done ? "done" : "open", done ? now - 2 * 86_400_000 : null, done ? to.accountId : null, done ? to.name : null]);
  }
  const first = scouted[0]?.label ?? null, last = scouted[scouted.length - 1]?.label ?? null;
  const watch = [{ kind: "slot", slot: "red1" }, { kind: "slot", slot: "red2" }, { kind: "slot", slot: "blue1" }, { kind: "slot", slot: "blue2" }];
  for (const [i, w] of watch.entries()) {
    const to = slotScout[i];
    S(`INSERT INTO workspace_match_assignments (workspace_id, season, event_code, watching, from_match, to_match, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at, updated_at)
         VALUES (${WS}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ev.season, ev.code, JSON.stringify(w), first, last, to.accountId, to.name, DEMO_ACCOUNT_ID, DEMO_DISPLAY_NAME, now - 3 * 86_400_000, now - 3 * 86_400_000]);
  }
  S(`INSERT INTO workspace_match_assignments (workspace_id, season, event_code, watching, from_match, to_match, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at, updated_at)
       VALUES (${WS}, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`, [ev.season, ev.code, JSON.stringify({ kind: "all" }), DEMO_ACCOUNT_ID, DEMO_DISPLAY_NAME, DEMO_SCOUTS[1].accountId, DEMO_SCOUTS[1].name, now - 4 * 3600_000, now - 4 * 3600_000]);
  inbox.push({ at: now - 4 * 3600_000, type: "assignment.match_created", d: { watching: "All 4 teams", range: "Playoffs", eventCode: ev.code, season: ev.season }, actor: DEMO_SCOUTS[1], read: false });
  const editedOwn = entryUuids.filter((e) => e.author.accountId === DEMO_ACCOUNT_ID)[1];
  if (editedOwn) inbox.push({ at: now - 7 * 3600_000, type: "entry.edited", d: { uuid: editedOwn.uuid, team: editedOwn.team, matchLabel: editedOwn.label, kind: "match", eventCode: ev.code, season: ev.season, edits: 2 }, actor: DEMO_SCOUTS[2], read: true });
  inbox.push({ at: now - 3 * 86_400_000, type: "member.joined", d: { role: "admin" }, actor: DEMO_SCOUTS[1], read: true });
  for (const it of inbox) {
    if (!inboxCategory(it.type)) continue;
    const { title, body } = inboxText(it.type, it.d, it.actor.name, DEMO_WORKSPACE_NAME);
    S(`INSERT INTO inbox_items (user_id, at, workspace_id, workspace_name, category, type, subject, actor_account_id, actor_name, title, body, link, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, it.at, DEMO_WORKSPACE_ID, DEMO_WORKSPACE_NAME, inboxCategory(it.type), it.type, String(it.d.uuid ?? it.type), it.actor.accountId, it.actor.name, title, body, inboxLink(DEMO_WORKSPACE_ID, it.type, it.d, { admin: true }), it.read ? it.at + 60_000 : null]);
  }
  for (const [i, e] of entryUuids.filter((x) => x.kind === "match").slice(0, 12).entries()) {
    S(`INSERT INTO workspace_activity (workspace_id, at, actor_account_id, actor_name, type, subject, details) VALUES (${WS}, ?, ?, ?, 'entry.added', ?, ?)`,
      [now - 86_400_000 - (12 - i) * 9 * 60_000, e.author.accountId, e.author.name, `entry:${e.uuid}`, JSON.stringify({ uuid: e.uuid, team: e.team, matchLabel: e.label, kind: e.kind, eventCode: ev.code, season: ev.season })]);
  }

  // Videos: real cards from the feed for the demo's teams, saved, queued and watched, with two notes.
  try {
    const { videoFeed } = await import("../api/videosFeed.js");
    const feed = await videoFeed({ viewer: "demo", userId: null, hints: { myTeam: mine.team, teams: others.slice(0, 6).map((t) => t.team), history: [] }, filter: "all", cursor: null, now });
    const items: FeedItem[] = feed.items.slice(0, 10);
    const lib = (list: string, it: FeedItem, i: number) => S("INSERT INTO video_library (user_id, list, item_key, item, at) VALUES (?, ?, ?, ?, ?)", [userId, list, it.key, JSON.stringify(it), new Date(now - i * 3600_000).toISOString()]);
    items.slice(0, 3).forEach((it, i) => lib("saved", it, i));
    items.slice(3, 6).forEach((it, i) => lib("later", it, i));
    items.slice(0, 8).forEach((it, i) => lib("history", it, i + 1));
    for (const [i, it] of items.slice(0, 2).entries()) {
      const at = new Date(now - (i + 1) * 5400_000).toISOString();
      S("INSERT INTO video_notes (user_id, item_key, video_id, t, body, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, it.key, it.videoId, i === 0 ? 12 : 95, i === 0 ? "Watch their auto path here: start on the far side." : "Endgame starts here: how fast they get in position.", JSON.stringify(it), at, at]);
    }
  } catch { /* no videos yet: the library opens empty */ }

  const summary: DemoSummary = { season: ev.season, eventCode: ev.code, eventName: ev.name, myTeam: mine.team, myTeamName: myTeam.name, workspaceId: DEMO_WORKSPACE_ID, seededAt: iso };
  S("INSERT INTO kv (key, value, updated_at) VALUES ('demo:summary', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [JSON.stringify(summary), iso]);
  S("INSERT INTO kv (key, value, updated_at) VALUES ('demo:seededAt', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [String(now), iso]);
  await writeBatch(stmts);
}

/** What the /demo page links to: the event and team the demo was last seeded from (null before the first seed, or with no event). */
export async function demoSummary(): Promise<DemoSummary | null> {
  try { const r = await get<{ value: string }>("SELECT value FROM kv WHERE key = 'demo:summary'"); return r ? JSON.parse(r.value) as DemoSummary : null; } catch { return null; }
}
