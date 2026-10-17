// Automatic power rankings (docs/power-rankings.md, "Automatic weeks"): every Friday at 00:00
// America/New_York (./schedule.ts) the server publishes a top 25 from the live world ranking at that
// moment, with blurbs written by Bruno, Control Point's AI, and fact-checked here (./factCheck.ts).
//
//   1. The fact packet: the live ranking's top 25 (server/api/rankings.ts, the list /rankings shows),
//      movement against the previous published power-rankings week of the season (hand-written or
//      generated), the rating change against that week's frozen ratings when it recorded them, and
//      each team's record, OPR and last event from the season's stats.
//   2. Bruno writes from the packet (Control Point's POST /internal/bruno/power-rankings, through
//      server/auth/controlPoint.ts). Each blurb must pass the fact check; any that doesn't, and every
//      blurb when Control Point is unreachable, unset or answers with something unusable, is the
//      data-only template instead. A week is never skipped for want of Bruno.
//   3. The week is stored (power_rankings_generated, ./generated.ts) with who wrote each blurb and the
//      frozen packet, so it can be regenerated or audited later from the same facts.
//
// Exactly one generated week per season and ISO week, across restarts and servers: the run first
// claims the row (status 'pending'); a claim older than CLAIM_STALE_MS (a server that died mid-run)
// may be taken over. A hand-written file for the week means nothing is generated for it.
import { all, get, run } from "../db.js";
import { isEnabled } from "../flags.js";
import { defaultRankingsSeason, rankings } from "../api/rankings.js";
import { brunoAvailable, brunoPowerRankings } from "../auth/controlPoint.js";
import { POWER_RANKINGS_SIZE, weekIdOf } from "../../src/shared/powerRankings.js";
import { compose, type BrunoOutput, type FactPacket, type PacketTeam } from "./factCheck.js";
import { getGenerated, invalidateGenerated, type GeneratedWeek } from "./generated.js";
import { dueSlot, localDate } from "./schedule.js";
import { fileWeeks, publishedWeeks } from "./store.js";

/** A run that claimed a week this long ago and never finished is presumed dead. */
export const CLAIM_STALE_MS = 15 * 60_000;

type Log = (m: string) => void;
const quiet: Log = () => {};

const round1 = (x: number) => Math.round(x * 10) / 10;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The frozen packet as stored: the facts plus the week its movement was counted against. */
export type StoredPacket = FactPacket & { comparedWith: string | null };

function awardLabel(a: { type: string; name: string | null }): string {
  if (a.type === "Winner") return "Winning alliance";
  if (a.type === "Finalist") return "Finalist alliance";
  return (a.name ?? `${a.type} Award`).replace(/\s+sponsored by .*$/i, "").trim();
}

/** Each team's most recent event this season with matches played: its name, and rank and awards there. */
async function lastEvents(season: number, teams: number[]): Promise<Map<number, PacketTeam["lastEvent"]>> {
  const out = new Map<number, PacketTeam["lastEvent"]>();
  if (!teams.length) return out;
  const q = teams.map(() => "?").join(",");
  const rows = await all<{ team: number; code: string; name: string; rank: number | null; teams: number }>(
    `SELECT s.team, e.code, e.name, et.rank,
       (SELECT COUNT(*) FROM event_teams x WHERE x.season = e.season AND x.code = e.code) teams
     FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
     LEFT JOIN event_teams et ON et.season = s.season AND et.code = s.code AND et.team = s.team
     WHERE s.season = ? AND s.team IN (${q}) AND s.matches > 0
     ORDER BY COALESCE(e.end, e.start) DESC, e.code`, [season, ...teams]);
  const latest = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(Number(r.team))) latest.set(Number(r.team), r);
  const codes = [...new Set([...latest.values()].map((r) => r.code))];
  const awards = codes.length ? await all<{ code: string; team: number; type: string; placement: number; name: string | null }>(
    `SELECT code, team, type, placement, name FROM awards WHERE season = ? AND code IN (${codes.map(() => "?").join(",")}) AND team IN (${q})
     ORDER BY CASE type WHEN 'Winner' THEN 0 WHEN 'Finalist' THEN 1 WHEN 'Inspire' THEN 2 ELSE 3 END, placement`, [season, ...codes, ...teams]) : [];
  for (const [team, r] of latest) {
    const parts: string[] = [];
    if (r.rank != null && Number(r.teams) > 0) parts.push(`Ranked ${Number(r.rank)} of ${Number(r.teams)}`);
    const seen = new Set<string>();
    for (const a of awards.filter((x) => x.code === r.code && Number(x.team) === team)) {
      const label = awardLabel(a);
      if (seen.has(label)) continue;
      seen.add(label);
      if ([...parts, label].join("; ").length > 80) break;
      parts.push(label);
    }
    out.set(team, { name: clip(String(r.name).trim(), 120), result: parts.length ? parts.join("; ") : null });
  }
  return out;
}

/**
 * The fact packet for a season and week from the live ranking at `at`, with movement against the
 * previous published week of the season (`comparedWith`), if any.
 */
export async function buildPacket(season: number, week: string, at = Date.now()): Promise<StoredPacket> {
  const live = (await rankings({ season, week: null, places: [], page: 1 }, at)).rows.slice(0, POWER_RANKINGS_SIZE);
  // The previous week out by the publish date (New York), of either kind.
  const prev = (await publishedWeeks(localDate(at))).filter((w) => w.season === season && w.week < week).at(-1) ?? null;
  const priorRank = new Map(prev?.entries.map((e) => [e.team, e.rank]) ?? []);
  // A generated previous week froze its ratings; a hand-written one didn't (no rating change then).
  const priorRating = new Map<number, number>();
  if (prev?.generated) {
    const g = await getGenerated(prev.season, prev.week);
    for (const t of g?.packet.teams ?? []) priorRating.set(t.team, t.rating);
  }
  const teams = live.map((r) => Number(r.team));
  const q = teams.map(() => "?").join(",");
  const [stats, events] = await Promise.all([
    teams.length ? all<{ team: number; opr_np: number | null; wins: number; losses: number; ties: number; matches: number }>(
      `SELECT team, opr_np, wins, losses, ties, matches FROM team_season_stats WHERE season = ? AND team IN (${q})`, [season, ...teams]) : [],
    lastEvents(season, teams),
  ]);
  const byTeam = new Map(stats.map((s) => [Number(s.team), s]));
  return {
    season, week, comparedWith: prev?.week ?? null,
    teams: live.map((r, i) => {
      const team = Number(r.team);
      const s = byTeam.get(team);
      const was = priorRank.get(team) ?? null;
      const rating = round1(Number(r.rating));
      const oldRating = priorRating.get(team);
      return {
        team, name: clip((r.name ?? "").trim() || `Team ${team}`, 80), rank: i + 1,
        priorRank: was, movement: prev && was != null ? was - (i + 1) : null,
        rating, ratingDelta: oldRating != null ? round1(rating - oldRating) : null,
        record: s && Number(s.matches) > 0 ? { wins: Number(s.wins), losses: Number(s.losses), ties: Number(s.ties) } : null,
        opr: s?.opr_np == null ? null : round1(Number(s.opr_np)),
        lastEvent: events.get(team) ?? null,
      };
    }),
  };
}

/** What Control Point is sent: the contract's fields only. */
const wire = (p: StoredPacket): FactPacket => ({ season: p.season, week: p.week, teams: p.teams, ...(p.notes ? { notes: p.notes } : {}) });

/** Bruno's blurbs for a packet, or null when Control Point is unset, unreachable or answers with anything malformed. */
export async function askBruno(p: StoredPacket, log: Log = quiet): Promise<BrunoOutput | null> {
  if (!brunoAvailable()) { log("power rankings: Control Point isn't configured; using the data-only template"); return null; }
  try {
    const out = await brunoPowerRankings(wire(p));
    if (!out || typeof out !== "object" || !Array.isArray(out.blurbs) || (out.intro != null && typeof out.intro !== "string")) {
      log("power rankings: Bruno's answer was malformed; using the data-only template");
      return null;
    }
    return { intro: out.intro ?? "", blurbs: out.blurbs };
  } catch (e) {
    log(`power rankings: Bruno unavailable (${(e as { status?: number }).status ? `http ${(e as { status?: number }).status}` : (e as Error).name === "TimeoutError" ? "timeout" : "network"}); using the data-only template`);
    return null;
  }
}

export type PublishResult =
  | { status: "published"; season: number; week: string; bruno: number; template: number }
  | { status: "exists" | "overridden" | "empty" | "off"; season?: number; week: string };

/** Claim (season, week) for a run: true when this run may write it. */
async function claim(season: number, week: string, published: string, at: number): Promise<boolean> {
  const now = new Date(at).toISOString();
  if (await run("INSERT INTO power_rankings_generated (season, week, published, status, generated_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT (season, week) DO NOTHING",
    [season, week, published, now])) return true;
  // Taken: by a finished week (never twice), a run in progress, or a run that died long ago (take it over).
  const stale = new Date(at - CLAIM_STALE_MS).toISOString();
  return (await run("UPDATE power_rankings_generated SET generated_at = ?, published = ? WHERE season = ? AND week = ? AND status = 'pending' AND generated_at < ?",
    [now, published, season, week, stale])) > 0;
}

/**
 * Generate and publish one week (idempotent: a week that exists is left alone). `published`: the
 * New York date it goes out ("YYYY-MM-DD"). Bruno failing never stops it: the template stands in.
 */
export async function publishWeek(o: { week: string; published: string; at?: number; season?: number; log?: Log }): Promise<PublishResult> {
  const at = o.at ?? Date.now();
  const log = o.log ?? quiet;
  if (fileWeeks().some((d) => d.week === o.week)) return { status: "overridden", week: o.week };
  const season = o.season ?? (await defaultRankingsSeason());
  if (!(await claim(season, o.week, o.published, at))) return { status: "exists", season, week: o.week };
  try {
    const packet = await buildPacket(season, o.week, at);
    if (!packet.teams.length) {
      await run("DELETE FROM power_rankings_generated WHERE season = ? AND week = ? AND status = 'pending'", [season, o.week]);
      log(`power rankings ${o.week}: no rated teams in ${season} yet; nothing to publish`);
      return { status: "empty", season, week: o.week };
    }
    const bruno = await askBruno(packet, log);
    const c = compose(packet, bruno, o.published, !!packet.comparedWith);
    await run(
      `UPDATE power_rankings_generated SET status = 'published', intro = ?, intro_source = ?, entries = ?, packet = ?, generated_at = ?, edited_by = NULL, edited_at = NULL
       WHERE season = ? AND week = ? AND status = 'pending'`,
      [c.intro, c.introSource, JSON.stringify(c.entries), JSON.stringify(packet), new Date().toISOString(), season, o.week]);
    invalidateGenerated();
    const bruno_ = c.entries.filter((e) => e.source === "bruno").length;
    log(`power rankings ${o.week} (${season}) published: ${bruno_} blurbs by Bruno, ${c.entries.length - bruno_} from the template`);
    return { status: "published", season, week: o.week, bruno: bruno_, template: c.entries.length - bruno_ };
  } catch (e) {
    // Let the next tick try again (the week isn't skipped): drop this run's claim.
    await run("DELETE FROM power_rankings_generated WHERE season = ? AND week = ? AND status = 'pending'", [season, o.week]).catch(() => {});
    throw e;
  }
}

/**
 * The scheduler's tick (server/index.ts, every few minutes): publish this Friday's week if it's due
 * and not done yet. Catches up after downtime until the Friday's ISO week ends. Nothing with the
 * autoPowerRankings switch off.
 */
export async function autoPowerRankingsTick(now = Date.now(), log: Log = quiet): Promise<PublishResult | null> {
  const slot = dueSlot(now);
  if (!slot) return null;
  if (!(await isEnabled("autoPowerRankings"))) return { status: "off", week: slot.week };
  const season = await defaultRankingsSeason();
  const done = await get<{ status: string; generated_at: string }>("SELECT status, generated_at FROM power_rankings_generated WHERE season = ? AND week = ?", [season, slot.week]);
  if (done && (done.status !== "pending" || Date.parse(done.generated_at) > now - CLAIM_STALE_MS)) return { status: "exists", season, week: slot.week };
  return publishWeek({ week: slot.week, published: slot.friday, at: now, season, log });
}

/** The owner's "Publish now": this week (New York date), right away. */
export async function publishNow(now = Date.now(), log: Log = quiet): Promise<PublishResult> {
  const today = localDate(now);
  const week = weekIdOf(new Date(`${today}T12:00:00Z`));
  if (!(await isEnabled("autoPowerRankings"))) return { status: "off", week };
  return publishWeek({ week, published: today, at: now, log });
}

/**
 * The owner's "Regenerate": Bruno writes the week again from its frozen packet (the same facts),
 * fact-checked as before. Owner edits are replaced. Null when the week doesn't exist or is mid-run;
 * "unavailable" when Bruno couldn't answer (the week is left as it was).
 */
export async function regenerateWeek(season: number, week: string, log: Log = quiet): Promise<GeneratedWeek | "unavailable" | null> {
  const g = await getGenerated(season, week);
  if (!g || g.status === "pending") return null;
  const packet = g.packet as StoredPacket;
  const bruno = await askBruno(packet, log);
  if (!bruno) return "unavailable";
  const c = compose(packet, bruno, g.published, !!packet.comparedWith);
  await run("UPDATE power_rankings_generated SET intro = ?, intro_source = ?, entries = ?, generated_at = ?, edited_by = NULL, edited_at = NULL WHERE season = ? AND week = ?",
    [c.intro, c.introSource, JSON.stringify(c.entries), new Date().toISOString(), season, week]);
  invalidateGenerated();
  return getGenerated(season, week);
}
