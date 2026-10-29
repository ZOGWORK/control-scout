// The daily refresh of the current automatic power-rankings week (docs/power-rankings.md, "Daily
// refresh"): every day at 00:00 America/New_York (./schedule.ts) the week's top 25 and facts are
// rebuilt from the latest data (./auto.ts buildPacket, against the same previous week as on Friday).
//
//   - Nothing shown changed (same teams, same order, same numbers): the stored week is kept exactly as
//     it is, Bruno's blurbs included, and only its `updated` date moves (the page: "Updated Sunday").
//   - Something changed: the new facts are stored, and only the blurbs that need it are written again.
//     A team whose place (rank and movement) is new, or that's new to the list, gets a new blurb from
//     Bruno: one call, a packet of just those teams. A team in the same place keeps Bruno's blurb while
//     every number in it still passes the fact check against the new facts (else Bruno writes it
//     again); its template ("Data summary") blurb is rebuilt from the new numbers, which costs nothing.
//     Owner edits are never overwritten: one whose team leaves the list is parked with the week and
//     restored if the team comes back. Bruno's intro is kept
//     unless the leader changed or it no longer passes the check (then the whole packet goes to Bruno so
//     he can write it again); a template intro is rebuilt; the owner's is kept.
//
// Only the current week (./schedule.ts isCurrentWeek), the newest published week, and only when it was
// generated: a hand-written week, a hidden one and every past week are never touched. One check per
// week and New York day across restarts and servers: the run claims its row in power_rankings_refreshes
// first (as Friday's publish claims its week). Off with either switch, autoPowerRankings or
// dailyPowerRankings.
import { get, run } from "../db.js";
import { isEnabled } from "../flags.js";
import { askBruno, buildPacket, CLAIM_STALE_MS, storedComparison } from "./auto.js";
import { checkBlurb, checkIntro, compose, templateBlurb, templateIntro, type PacketTeam, type StoredPacket } from "./factCheck.js";
import { getGenerated, invalidateGenerated, type GeneratedEntry, type GeneratedWeek } from "./generated.js";
import { dueRefresh, isCurrentWeek, localDate } from "./schedule.js";
import { publishedWeeks } from "./store.js";
import type { BlurbAuthor } from "../../src/shared/powerRankings.js";

type Log = (m: string) => void;
const quiet: Log = () => {};

export type RefreshResult =
  | { status: "off" | "none"; day: string }
  /** Already checked today (by this server or another), or a check is running now. */
  | { status: "done"; season: number; week: string; day: string }
  | { status: "unchanged"; season: number; week: string; day: string }
  | { status: "updated"; season: number; week: string; day: string; changed: number; bruno: number; template: number; kept: number }
  /** The owner edited the week while the check ran: their edit stands, and the next tick checks again. */
  | { status: "conflict"; season: number; week: string; day: string };

/** What a team's line shows (its blurb's facts and its movement): equal keys mean nothing shown changed. */
const factKey = (t: PacketTeam) => JSON.stringify([t.team, t.name, t.rank, t.priorRank, t.movement, t.rating, t.ratingDelta, t.record, t.opr, t.lastEvent, t.notes ?? null]);

/** Its place: rank and movement. A Bruno blurb is written about it, so a new place needs a new blurb. */
const placeKey = (t: PacketTeam) => JSON.stringify([t.rank, t.priorRank, t.movement]);

/** Did anything the week shows change between the stored packet and a fresh one? */
export function samePacket(a: StoredPacket, b: StoredPacket): boolean {
  return a.comparedWith === b.comparedWith
    // Who dropped out and from where (what the page shows); a frozen rating is only carried along.
    && JSON.stringify((a.droppedOut ?? []).map((d) => [d.team, d.lastRank])) === JSON.stringify((b.droppedOut ?? []).map((d) => [d.team, d.lastRank]))
    && a.teams.length === b.teams.length
    && a.teams.every((t, i) => factKey(t) === factKey(b.teams[i]));
}

export interface RefreshPlan {
  /** Teams whose shown facts changed (new to the list included). */
  changed: number[];
  /** Teams Bruno is asked to write again (a new place or new to the list, or a Bruno blurb the new facts contradict). */
  ask: number[];
  /** Owner-edited blurbs of changed teams, left as they are. */
  kept: number[];
  /** The intro must be written again by Bruno (his intro no longer holds): the whole packet goes. Only planned for a packet that changed. */
  intro: boolean;
}

/**
 * Which blurbs a fresh packet needs written again. Pure: the stored week and the new facts in, the
 * plan out. A template blurb of a team in the same place isn't in `ask`: it's rebuilt from the new facts.
 */
export function planRefresh(g: Pick<GeneratedWeek, "entries" | "packet" | "intro" | "introSource" | "published"> & { parked?: GeneratedWeek["parked"] }, fresh: StoredPacket): RefreshPlan {
  const oldTeam = new Map(g.packet.teams.map((t) => [t.team, t]));
  const oldEntry = new Map<number, Pick<GeneratedEntry, "text" | "source">>(g.entries.map((e) => [e.team, e]));
  // A returning team's parked owner edit counts as its entry: kept, never sent to Bruno.
  for (const p of g.parked ?? []) if (!oldEntry.has(p.team)) oldEntry.set(p.team, { text: p.text, source: "owner" });
  const plan: RefreshPlan = { changed: [], ask: [], kept: [], intro: false };
  for (const t of fresh.teams) {
    const was = oldTeam.get(t.team);
    const e = oldEntry.get(t.team);
    if (was && factKey(was) === factKey(t) && e) continue;
    plan.changed.push(t.team);
    if (e?.source === "owner") { plan.kept.push(t.team); continue; }
    const samePlace = !!(e && was && placeKey(was) === placeKey(t));
    // Same place, new numbers: a template blurb is rebuilt from them (no Bruno), and Bruno's is kept
    // while every number in it still checks out against the new facts.
    if (samePlace && (e!.source === "template" || checkBlurb(e!.text, t, fresh).ok)) continue;
    // A new place (or new to the list), or a blurb the new numbers contradict: Bruno writes it again.
    plan.ask.push(t.team);
  }
  if (g.introSource === "bruno") {
    const leaderChanged = g.packet.teams[0]?.team !== fresh.teams[0]?.team;
    // Checked on any change, even when teams only left the list (the intro may name one of them).
    plan.intro = leaderChanged || !checkIntro(g.intro, fresh, g.published).ok;
  }
  return plan;
}

/** The current week to refresh at `now`: the newest published week, when it's generated, live and still current. */
export async function currentGeneratedWeek(now: number): Promise<GeneratedWeek | null> {
  const last = (await publishedWeeks(localDate(now))).at(-1);
  if (!last?.generated || !isCurrentWeek(last.week, now)) return null;
  const g = await getGenerated(last.season, last.week);
  return g && g.status === "published" ? g : null;
}

/** Claim (season, week, day) for a check: true when this run may do it. A failed check, or a run that died, may be retried after CLAIM_STALE_MS. */
async function claim(season: number, week: string, day: string, at: number): Promise<boolean> {
  const now = new Date(at).toISOString();
  if (await run("INSERT INTO power_rankings_refreshes (season, week, day, status, started_at) VALUES (?, ?, ?, 'running', ?) ON CONFLICT (season, week, day) DO NOTHING",
    [season, week, day, now])) return true;
  const stale = new Date(at - CLAIM_STALE_MS).toISOString();
  return (await run(`UPDATE power_rankings_refreshes SET status = 'running', started_at = ?, finished_at = NULL, note = NULL
     WHERE season = ? AND week = ? AND day = ? AND status IN ('running', 'failed') AND started_at < ?`, [now, season, week, day, stale])) > 0;
}

async function finish(season: number, week: string, day: string, status: "unchanged" | "updated" | "failed", c: { changed?: number; bruno?: number; template?: number; kept?: number; note?: string | null } = {}) {
  await run(`UPDATE power_rankings_refreshes SET status = ?, finished_at = ?, changed = ?, bruno = ?, template = ?, kept = ?, note = ? WHERE season = ? AND week = ? AND day = ?`,
    [status, new Date().toISOString(), c.changed ?? 0, c.bruno ?? 0, c.template ?? 0, c.kept ?? 0, c.note ?? null, season, week, day]);
}

/**
 * Check one generated week against the data at `at` and store what changed (or only the date). `day`:
 * the New York date of the check. The write is guarded by the week's version, so an owner edit made
 * while Bruno was writing is never undone ("conflict").
 */
export async function refreshWeek(g: GeneratedWeek, day: string, at: number, log: Log = quiet): Promise<RefreshResult> {
  const base = { season: g.season, week: g.week, day };
  // Against the comparison the week went out with (recovered from its packet), never whichever earlier week is visible now.
  const fresh = await buildPacket(g.packet.season ?? g.season, g.week, at, storedComparison(g.packet));
  if (!fresh.teams.length || samePacket(g.packet, fresh)) {
    // Nothing shown changed (or no rated teams to rebuild from: the week stands as it was).
    await run("UPDATE power_rankings_generated SET updated = ? WHERE season = ? AND week = ? AND status = 'published'", [day, g.season, g.week]);
    invalidateGenerated();
    await finish(g.season, g.week, day, "unchanged", { note: fresh.teams.length ? null : "no rated teams in the latest data; the week was kept" });
    log(`power rankings ${g.week}: checked ${day}, nothing changed`);
    return { status: "unchanged", ...base };
  }

  const plan = planRefresh(g, fresh);
  const compared = !!fresh.comparedWith;
  const ask = new Set(plan.ask);
  // One call at most: the teams to rewrite, or the whole packet when the intro must be written again too.
  const subset: StoredPacket = { ...fresh, teams: fresh.teams.filter((t) => ask.has(t.team)) };
  const bruno = plan.intro || subset.teams.length ? await askBruno(plan.intro ? fresh : subset, log) : null;
  const composed = compose(plan.intro ? fresh : subset, bruno, day, compared);
  const written = new Map(composed.entries.map((e) => [e.team, e]));

  const oldEntry = new Map(g.entries.map((e) => [e.team, e]));
  const parked = new Map(g.parked.map((p) => [p.team, p.text]));
  const kept = new Set(plan.kept);
  const entries: GeneratedEntry[] = fresh.teams.map((t) => {
    const e = oldEntry.get(t.team);
    if (ask.has(t.team)) return written.get(t.team)!;
    if (!e && kept.has(t.team)) return { rank: t.rank, team: t.team, text: parked.get(t.team)!, source: "owner" }; // back: its parked edit
    if (e && kept.has(t.team)) return { ...e, rank: t.rank };
    if (!e || e.source === "template") return { rank: t.rank, team: t.team, text: templateBlurb(t, compared), source: "template" };
    return { ...e, rank: t.rank };
  });

  let intro = g.intro, introSource: BlurbAuthor = g.introSource;
  if (plan.intro) {
    intro = composed.intro; introSource = composed.introSource;
  } else if (g.introSource === "template") {
    intro = templateIntro(fresh, day, compared);
  }

  // Owner edits of teams that left are parked; those of teams that came back are unparked.
  const inList = new Set(entries.map((e) => e.team));
  for (const e of g.entries) if (e.source === "owner" && !inList.has(e.team)) parked.set(e.team, e.text);
  for (const team of inList) parked.delete(team);
  const changedText = (e: GeneratedEntry) => e.text !== oldEntry.get(e.team)?.text;
  const byBruno = entries.filter((e) => ask.has(e.team) && e.source === "bruno").length;
  const byTemplate = entries.filter((e) => e.source === "template" && changedText(e)).length;
  const n = await run(`UPDATE power_rankings_generated SET intro = ?, intro_source = ?, entries = ?, parked = ?, packet = ?, updated = ?, rev = rev + 1
     WHERE season = ? AND week = ? AND rev = ? AND status = 'published'`,
    [intro, introSource, JSON.stringify(entries), JSON.stringify([...parked].map(([team, text]) => ({ team, text }))), JSON.stringify(fresh), day, g.season, g.week, g.rev]);
  invalidateGenerated();
  if (!n) {
    // Edited (or hidden) while Bruno was writing: theirs stands. Drop the claim so a later tick checks again.
    await run("DELETE FROM power_rankings_refreshes WHERE season = ? AND week = ? AND day = ? AND status = 'running'", [g.season, g.week, day]);
    log(`power rankings ${g.week}: changed while the ${day} check ran; the change was kept and the check will run again`);
    return { status: "conflict", ...base };
  }
  const result = { changed: plan.changed.length, bruno: byBruno, template: byTemplate, kept: plan.kept.length };
  await finish(g.season, g.week, day, "updated", { ...result, note: plan.intro ? `intro rewritten (${introSource === "bruno" ? "Bruno" : "template"})` : null });
  log(`power rankings ${g.week}: updated ${day}: ${result.changed} teams changed, ${byBruno} blurbs by Bruno, ${byTemplate} from the template, ${result.kept} owner edits kept`);
  return { status: "updated", ...base, ...result };
}

/**
 * The scheduler's tick (server/index.ts, every few minutes, after Friday's publish tick): today's check
 * of the current week, once per New York day. Nothing with either switch off, on the day the week went
 * out, or when the current week is hand-written, hidden or not generated.
 */
export async function dailyRefreshTick(now = Date.now(), log: Log = quiet): Promise<RefreshResult> {
  const { day } = dueRefresh(now);
  if (!(await isEnabled("autoPowerRankings")) || !(await isEnabled("dailyPowerRankings"))) return { status: "off", day };
  const g = await currentGeneratedWeek(now);
  if (!g || g.published >= day) return { status: "none", day };
  const base = { season: g.season, week: g.week, day };
  if (g.updated === day) return { status: "done", ...base };
  const r = await get<{ status: string }>("SELECT status FROM power_rankings_refreshes WHERE season = ? AND week = ? AND day = ?", [g.season, g.week, day]);
  if (r && (r.status === "unchanged" || r.status === "updated")) return { status: "done", ...base };
  if (!(await claim(g.season, g.week, day, now))) return { status: "done", ...base };
  try {
    return await refreshWeek(g, day, now, log);
  } catch (e) {
    await finish(g.season, g.week, day, "failed", { note: (e as Error).message.slice(0, 300) }).catch(() => {});
    throw e;
  }
}
