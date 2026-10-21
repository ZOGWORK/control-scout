// Reliability index job (rules: src/shared/reliability.ts): per team, per event
// and per season, from stored match results, lineups (on-field / DQ flags), each
// event's OPR and the report cards. Public match data only: workspace scouting
// never comes here (members see their blend in the browser, from their own
// workspace's consensus answer). Rewritten whole per season by the stats job.
import type { InStatement } from "@libsql/client";
import { all, kvGet, writeBatch } from "../db.js";
import type { DbEvent } from "./load.js";
import type { ReportCardField } from "../../src/shared/api.js";
import { NEAR_ZERO_SHARE, RATIO_CAP, RECENT, reliabilityIndex, shrinkTo, type ReliabilityParts } from "../../src/shared/reliability.js";

type Log = (m: string) => void;

/** One team's raw tallies at one event (or a season, pooled). */
export interface Tally {
  listed: number;
  onField: number;
  noShows: number;
  dqs: number;
  /** Estimated contributions, in units of the event's average robot share. */
  contribs: number[];
  /** Σ squared deviations of contribs from the team's own event mean (pooled across events for a season). */
  ss: number;
  nearZero: number;
  penSum: number;
  /** In match order: what each listed match was. */
  seq: ("noShow" | "nearZero" | "ok")[];
}

const tally = (): Tally => ({ listed: 0, onField: 0, noShows: 0, dqs: 0, contribs: [], ss: 0, nearZero: 0, penSum: 0, seq: [] });

/**
 * Raw tallies per event and team. `opr(code, team)` is the team's event OPR (non-penalty), null when unknown.
 * Pure: events → tallies.
 */
export function tallyReliability(events: DbEvent[], opr: (code: string, team: number) => number | null): Map<string, Map<number, Tally>> {
  const out = new Map<string, Map<number, Tally>>();
  const ordered = [...events].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.code.localeCompare(b.code));
  for (const e of ordered) {
    if (e.remote) continue;
    const quals = e.matches.filter((m) => m.level === "qual" && m.played && m.redScore && m.blueScore).sort((a, b) => a.series - b.series || a.number - b.number);
    if (!quals.length) continue;
    // An average robot's share of an alliance's non-penalty score at this event.
    let np = 0, robots = 0;
    for (const m of quals) for (const [side, sc] of [[m.red, m.redScore!], [m.blue, m.blueScore!]] as const) {
      const on = side.filter((t) => t.onField).length;
      if (on) { np += sc.np; robots += on; }
    }
    const share = robots ? np / robots : 0;
    const teams = new Map<number, Tally>();
    out.set(e.code, teams);
    for (const m of quals) {
      for (const [side, sc] of [[m.red, m.redScore!], [m.blue, m.blueScore!]] as const) {
        const on = side.filter((t) => t.onField);
        for (const t of side) {
          let a = teams.get(t.team); if (!a) { a = tally(); teams.set(t.team, a); }
          a.listed++;
          if (!t.onField) { a.noShows++; a.seq.push("noShow"); continue; }
          a.onField++;
          if (t.dq) a.dqs++;
          a.penSum += sc.pen / on.length;
          const partner = on.length === 2 ? on.find((x) => x.team !== t.team) : undefined;
          const p = partner ? opr(e.code, partner.team) : null;
          if (p != null && share > 0) {
            const c = (sc.np - p) / share;
            a.contribs.push(c);
            if (c <= NEAR_ZERO_SHARE) { a.nearZero++; a.seq.push("nearZero"); continue; }
          }
          a.seq.push("ok");
        }
      }
    }
    for (const a of teams.values()) {
      const mean = a.contribs.reduce((s, x) => s + x, 0) / Math.max(1, a.contribs.length);
      a.ss = a.contribs.reduce((s, x) => s + (x - mean) ** 2, 0);
    }
  }
  return out;
}

/** Event tallies of one team pooled into its season (contributions keep their own event's centring). */
export function pool(xs: Tally[]): Tally {
  const s = tally();
  for (const a of xs) {
    s.listed += a.listed; s.onField += a.onField; s.noShows += a.noShows; s.dqs += a.dqs; s.contribs.push(...a.contribs);
    s.ss += a.ss; s.nearZero += a.nearZero; s.penSum += a.penSum; s.seq.push(...a.seq);
  }
  return s;
}

export interface Field { noShowRate: number; dqRate: number; nearZeroRate: number; swingVar: number; penPerRobot: number }

export function fieldOf(all: Tally[]): Field {
  const s = pool(all);
  return {
    noShowRate: s.listed ? s.noShows / s.listed : 0,
    dqRate: s.onField ? s.dqs / s.onField : 0,
    nearZeroRate: s.contribs.length ? s.nearZero / s.contribs.length : 0,
    swingVar: s.contribs.length ? s.ss / s.contribs.length : 0,
    penPerRobot: s.onField ? s.penSum / s.onField : 0,
  };
}

/**
 * x against the field's average. A field average of 0 is a known zero (e.g. a season where nobody gave away a
 * penalty), not missing data: a team at 0 then costs nothing, one above it the most.
 */
export const ratioTo = (x: number, field: number) => (field > 0 ? x / field : x > 0 ? RATIO_CAP : 0);

/**
 * Shrunk parts of one tally. `missSd`: the team's report-card miss spread (shrunk), null without live calls;
 * `fieldMissSd` null: the season has no scored live calls at all, so predictability doesn't apply to anyone
 * (ratio 0, no cost). A team with no live calls in a season that has them reads at the field's level (1), as
 * shrinkage with no data of its own would put it.
 */
export function partsOf(a: Tally, f: Field, missSd: number | null, fieldMissSd: number | null): ReliabilityParts {
  const n = a.contribs.length;
  const pen = shrinkTo(a.onField ? a.penSum / a.onField : null, a.onField, f.penPerRobot);
  return {
    noShowRate: shrinkTo(a.listed ? a.noShows / a.listed : null, a.listed, f.noShowRate),
    dqRate: shrinkTo(a.onField ? a.dqs / a.onField : null, a.onField, f.dqRate),
    nearZeroRate: shrinkTo(n ? a.nearZero / n : null, n, f.nearZeroRate),
    swing: Math.sqrt(Math.max(0, shrinkTo(n ? a.ss / n : null, n, f.swingVar))),
    penaltyRatio: ratioTo(pen, f.penPerRobot),
    predictabilityRatio: fieldMissSd == null ? 0 : missSd == null ? (fieldMissSd > 0 ? 1 : 0) : ratioTo(missSd, fieldMissSd),
  };
}

/** The field's own parts: ratios of 1 (the average against itself), or 0 where the average is a known zero / doesn't apply. */
export const fieldParts = (f: Field, fieldMissSd: number | null): ReliabilityParts => ({
  noShowRate: f.noShowRate, dqRate: f.dqRate, nearZeroRate: f.nearZeroRate, swing: Math.sqrt(f.swingVar),
  penaltyRatio: f.penPerRobot > 0 ? 1 : 0, predictabilityRatio: fieldMissSd != null && fieldMissSd > 0 ? 1 : 0,
});

const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const INSERT = `INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero,
  no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES (${Array(19).fill("?").join(", ")})`;

function rowArgs(season: number, code: string, team: number, a: Tally, p: ReliabilityParts, at: string) {
  const recent = a.seq.slice(-RECENT);
  return [season, code, team, a.listed, a.noShows, a.dqs, a.nearZero, a.contribs.length, recent.length, recent.filter((x) => x === "noShow").length, recent.filter((x) => x === "nearZero").length,
    r4(p.noShowRate), r4(p.dqRate), r4(p.nearZeroRate), r4(p.swing), r4(p.penaltyRatio), r4(p.predictabilityRatio), reliabilityIndex(p), at];
}

/**
 * Statements rewriting a season's rows (pure). code '' = the season; team 0 with code '' = the field
 * (its idx is the field-average index the pages compare against).
 */
export function reliabilityStatements(season: number, byEvent: Map<string, Map<number, Tally>>, miss: { season: Map<number, number>; event: Map<string, number>; field: number | null }, at: string): { stmts: InStatement[]; teams: number } {
  const stmts: InStatement[] = [{ sql: "DELETE FROM team_reliability WHERE season = ?", args: [season] }];
  const perTeam = new Map<number, Tally[]>();
  for (const teams of byEvent.values()) for (const [t, a] of teams) { const xs = perTeam.get(t); if (xs) xs.push(a); else perTeam.set(t, [a]); }
  const f = fieldOf([...perTeam.values()].flat());
  const fp = fieldParts(f, miss.field);
  const fieldTally = pool([...perTeam.values()].flat());
  stmts.push({ sql: INSERT, args: rowArgs(season, "", 0, { ...fieldTally, seq: [] }, fp, at) });
  for (const [code, teams] of byEvent) for (const [t, a] of teams) stmts.push({ sql: INSERT, args: rowArgs(season, code, t, a, partsOf(a, f, miss.event.get(`${code}|${t}`) ?? null, miss.field), at) });
  for (const [t, xs] of perTeam) { const a = pool(xs); stmts.push({ sql: INSERT, args: rowArgs(season, "", t, a, partsOf(a, f, miss.season.get(t) ?? null, miss.field), at) }); }
  return { stmts, teams: perTeam.size };
}

/** Rewrite a season's reliability rows from its events (as loaded for the stats job). */
export async function computeReliability(season: number, events: DbEvent[], log: Log = () => {}, now = Date.now()): Promise<number> {
  const [oprs, cards, field] = await Promise.all([
    all<{ code: string; team: number; opr_np: number | null }>("SELECT code, team, opr_np FROM team_event_stats WHERE season = ? AND opr_np IS NOT NULL", [season]),
    all<{ code: string; team: number; err_var_shrunk: number | null }>("SELECT code, team, err_var_shrunk FROM team_report_cards WHERE season = ? AND err_var_shrunk IS NOT NULL", [season]),
    kvGet<ReportCardField>(`reportCards:field:${season}`),
  ]);
  const o = new Map(oprs.map((r) => [`${r.code}|${r.team}`, Number(r.opr_np)]));
  const miss = { season: new Map<number, number>(), event: new Map<string, number>(), field: field?.errSd ?? null };
  for (const c of cards) {
    const sd = Math.sqrt(Math.max(0, Number(c.err_var_shrunk)));
    if (c.code === "") miss.season.set(Number(c.team), sd); else miss.event.set(`${c.code}|${c.team}`, sd);
  }
  const byEvent = tallyReliability(events, (code, team) => o.get(`${code}|${team}`) ?? null);
  const { stmts, teams } = reliabilityStatements(season, byEvent, miss, new Date(now).toISOString());
  await writeBatch(stmts, 5000);
  if (teams) log(`${season}: reliability for ${teams} teams`);
  return teams;
}
