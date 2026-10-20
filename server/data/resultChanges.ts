// Official result changes: what the sync saw change in an event's results.
//
// Every detail write of an event (the full sync and the live fast lane both
// go through syncEvent → writeEventBundle) reads the event's stored matches,
// compares them with the incoming bundle, and writes the bundle plus a row
// per real change in one transaction. Kinds:
//   posted   — a match that had no result now has one
//   revised  — a posted result's values changed (before and after kept)
//   schedule — an unplayed match's time or field moved, or a lineup changed
// A repeated poll of the same data compares equal and adds nothing. Each row
// also carries a diff key (match + kind + the match's previous change + the
// new value, UNIQUE) as a second guard, and the batch fails as a whole (then
// reads and diffs again) if another writer stored the event in between (see
// writeEventBundle). Matches a write leaves out are remembered as they were
// (result_watch.missing), so one that comes back is compared, not re-posted.
//
// The first detail write of an event after this shipped is its baseline
// (result_watch.since): earlier history was never tracked and isn't invented.
// Retention: the newest RESULT_CHANGES_PER_EVENT rows per event; older ones
// are dropped in the same transaction and counted in result_watch.pruned.
//
// This only reads and writes matches/match_teams/result_* rows. The pre-match
// prediction ledger (predictions) is never touched here.
import { createHash } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { all, get, writeBatch } from "../db.js";
import { bundleStatements, matchKey, type EventBundle, type MatchRow } from "./bundle.js";
import type { ScoreSplit } from "./seasons.js";
import type { ResultChangeKind, ResultScoreSide, ResultSnapshot, ScheduleSnapshot } from "../../src/shared/api.js";

/** Changes kept per event (an event has up to ~150 matches; a few corrections each is plenty). */
export const RESULT_CHANGES_PER_EVENT = 500;

type Source = "first" | "ftc-scout";

/** A stored match as the diff needs it. */
export interface StoredMatch {
  level: string; series: number; number: number; label: string;
  time: string | null; field: string | null; played: boolean; source: string;
  result: ResultSnapshot | null;
  schedule: ScheduleSnapshot;
}

export interface Change {
  level: string; series: number; number: number; label: string;
  kind: ResultChangeKind;
  fields: string[];
  before: ResultSnapshot | ScheduleSnapshot | null;
  after: ResultSnapshot | ScheduleSnapshot | null;
  prevSource: string | null;
}

const COMPONENTS = ["total", "np", "auto", "teleop", "endgame", "pen", "tips"] as const;
const BONUS = ["movement", "goal", "pattern"] as const;
const asc = (xs: number[]) => [...xs].sort((a, b) => a - b);
const num = (x: unknown): number | null => (x == null ? null : Number(x));

function sideFromSplit(x: ScoreSplit): ResultScoreSide {
  return {
    total: x.total, np: x.np, auto: x.auto, teleop: x.teleop, endgame: x.endgame, pen: x.pen, tips: x.tips ?? null,
    bonus: x.bonus ? { movement: !!x.bonus.movement, goal: !!x.bonus.goal, pattern: !!x.bonus.pattern } : null,
  };
}

function sideFromRow(r: any, p: "red" | "blue"): ResultScoreSide {
  let bonus: ResultScoreSide["bonus"] = null;
  const raw = r[`${p}_bonus`];
  if (raw) { try { const b = JSON.parse(String(raw)); bonus = { movement: !!b.movement, goal: !!b.goal, pattern: !!b.pattern }; } catch { bonus = null; } }
  return {
    total: num(r[`${p}_total`]), np: num(r[`${p}_np`]), auto: num(r[`${p}_auto`]), teleop: num(r[`${p}_teleop`]),
    endgame: num(r[`${p}_endgame`]), pen: num(r[`${p}_pen`]), tips: num(r[`${p}_tips`]), bonus,
  };
}

/** The incoming match as snapshots (same normalisation as the stored side). */
export function incoming(m: MatchRow): { result: ResultSnapshot | null; schedule: ScheduleSnapshot } {
  const result = m.played && m.redScore && m.blueScore
    ? { red: sideFromSplit(m.redScore), blue: sideFromSplit(m.blueScore), dq: asc([...m.red, ...m.blue].filter((t) => t.dq).map((t) => t.team)) }
    : null;
  return { result, schedule: { time: m.time, field: m.field ?? null, red: asc(m.red.map((t) => t.team)), blue: asc(m.blue.map((t) => t.team)) } };
}

/** Values that differ between two results. Across sources only totals compare (their breakdowns are split differently). */
export function resultFields(a: ResultSnapshot, b: ResultSnapshot, sameSource: boolean): string[] {
  const out: string[] = [];
  for (const p of ["red", "blue"] as const) {
    for (const c of sameSource ? COMPONENTS : (["total"] as const)) {
      const x = a[p][c], y = b[p][c];
      // A value one side doesn't report (null) isn't a revision: the source added or dropped detail.
      if (x != null && y != null && x !== y) out.push(`${p}.${c}`);
    }
    if (sameSource && a[p].bonus && b[p].bonus) for (const k of BONUS) if (a[p].bonus![k] !== b[p].bonus![k]) out.push(`${p}.bonus.${k}`);
  }
  if (sameSource && a.dq.join(",") !== b.dq.join(",")) out.push("dq");
  return out;
}

/** Schedule values that differ. Time only while the match is unplayed (once played, time is the actual start). */
export function scheduleFields(a: ScheduleSnapshot, b: ScheduleSnapshot, o: { unplayed: boolean; sameSource: boolean }): string[] {
  const out: string[] = [];
  if (o.unplayed && o.sameSource && a.time && b.time && a.time !== b.time) out.push("time");
  if (a.field && b.field && a.field !== b.field) out.push("field");
  // A side with no teams listed is missing data, not a lineup change.
  for (const p of ["red", "blue"] as const) if (a[p].length && b[p].length && a[p].join(",") !== b[p].join(",")) out.push(p);
  return out;
}

/**
 * The changes between an event's stored matches and an incoming bundle's.
 * `watched` false: this write is the baseline, nothing is a change. Matches
 * missing from the bundle are left alone (a fallback feed may list fewer).
 */
export function diffMatches(stored: StoredMatch[], matches: MatchRow[], source: Source, watched: boolean): Change[] {
  if (!watched) return [];
  const old = new Map(stored.map((m) => [matchKey(m), m]));
  const out: Change[] = [];
  for (const m of matches) {
    const was = old.get(matchKey(m));
    const now = incoming(m);
    const base = { level: m.level, series: m.series, number: m.number, label: m.label, prevSource: was?.source ?? null };
    if (!was) {
      // New to a watched event and already played (scheduled and scored between two polls).
      if (now.result) out.push({ ...base, kind: "posted", fields: [], before: null, after: now.result });
      continue;
    }
    const sameSource = was.source === source;
    if (!was.result && now.result) out.push({ ...base, kind: "posted", fields: [], before: null, after: now.result });
    else if (was.result && now.result) {
      const fields = resultFields(was.result, now.result, sameSource);
      if (fields.length) out.push({ ...base, kind: "revised", fields, before: was.result, after: now.result });
    } else if (was.result && !now.result && sameSource) {
      out.push({ ...base, kind: "revised", fields: ["result"], before: was.result, after: null });
    }
    const sf = scheduleFields(was.schedule, now.schedule, { unplayed: !was.played && !m.played, sameSource });
    if (sf.length) out.push({ ...base, kind: "schedule", fields: sf, before: was.schedule, after: now.schedule });
  }
  return out;
}

/** Stored matches of one event. */
export async function readStored(season: number, code: string): Promise<StoredMatch[]> {
  const rows = await all<any>("SELECT * FROM matches WHERE season = ? AND code = ?", [season, code]);
  const teams = await all<any>("SELECT level, series, number, team, alliance, dq FROM match_teams WHERE season = ? AND code = ?", [season, code]);
  const byMatch = new Map<string, any[]>();
  for (const t of teams) {
    const k = matchKey({ level: String(t.level), series: Number(t.series), number: Number(t.number) });
    (byMatch.get(k) ?? byMatch.set(k, []).get(k)!).push(t);
  }
  return rows.map((r) => {
    const key = { level: String(r.level), series: Number(r.series), number: Number(r.number) };
    const ts = byMatch.get(matchKey(key)) ?? [];
    const side = (al: string) => asc(ts.filter((t) => t.alliance === al).map((t) => Number(t.team)));
    const played = Number(r.played) === 1;
    const time = r.time == null ? null : String(r.time), field = r.field == null ? null : String(r.field);
    return {
      ...key, label: String(r.label), time, field, played, source: String(r.source),
      result: played && r.red_total != null && r.blue_total != null
        ? { red: sideFromRow(r, "red"), blue: sideFromRow(r, "blue"), dq: asc(ts.filter((t) => Number(t.dq) === 1).map((t) => Number(t.team))) }
        : null,
      schedule: { time, field, red: side("red"), blue: side("blue") },
    };
  });
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

/** Left-out matches remembered per event (an event has up to ~150; more is a feed listing almost nothing). */
export const MISSING_KEPT = 300;

/** The guard's failure: another writer stored this event between this write's read and its batch. */
const isStale = (e: unknown) => /UNIQUE constraint failed: result_watch/.test(String((e as Error)?.message ?? e));

/** Test seam: runs between the read and the write (to stand in for another writer). */
export const resultChangesIo = { afterRead: async (): Promise<void> => {} };

/**
 * Write one event bundle and record what changed in its results, atomically
 * (one batch = one transaction). The stored rows are read just before
 * writing; the batch opens with a guard that fails it as a whole when the
 * event's detail_synced_at is no longer the one read (another writer stored
 * this event in between: the writer lease normally rules that out, but
 * `npm run sync` doesn't hold it), and then it reads and diffs again, so a
 * bundle is never saved without its changes. Event-list-only bundles (no
 * detail) write exactly as before.
 */
export async function writeEventBundle(b: EventBundle, o: { now?: string; attempts?: number } = {}): Promise<{ changes: number }> {
  if (!b.detail) { await writeBatch(bundleStatements(b)); return { changes: 0 }; }
  const attempts = o.attempts ?? 3;
  for (let i = 1; ; i++) {
    try { return await writeOnce(b, o.now ?? new Date().toISOString()); }
    catch (e) { if (!isStale(e) || i >= attempts) throw e; }
  }
}

async function writeOnce(b: EventBundle, at: string): Promise<{ changes: number }> {
  const { season, code, source } = b.event;
  const matches = b.detail!.matches;
  const k = [season, code];
  const watch = await get<{ since: string; missing: string }>("SELECT since, missing FROM result_watch WHERE season = ? AND code = ?", k);
  if (!watch) {
    // Baseline: this write is the first one watched; nothing before it is known.
    await writeBatch([...bundleStatements(b), { sql: "INSERT OR IGNORE INTO result_watch (season, code, since) VALUES (?, ?, ?)", args: [...k, at] }]);
    return { changes: 0 };
  }
  const token = (await get<{ t: string | null }>("SELECT detail_synced_at t FROM events WHERE season = ? AND code = ?", k))?.t ?? null;
  const stored = await readStored(season, code);
  // Matches an earlier write left out still count as stored: one that comes back is compared with what it was.
  let missing: Record<string, StoredMatch> = {};
  try { missing = JSON.parse(watch.missing || "{}"); } catch { missing = {}; }
  const storedKeys = new Set(stored.map((m) => matchKey(m)));
  const base = [...stored, ...Object.entries(missing).filter(([key]) => !storedKeys.has(key)).map(([, m]) => m)];
  const changes = diffMatches(base, matches, source, true);
  const incomingKeys = new Set(matches.map((m) => matchKey(m)));
  const nextMissing = JSON.stringify(Object.fromEntries(base.filter((m) => !incomingKeys.has(matchKey(m))).slice(0, MISSING_KEPT).map((m) => [matchKey(m), m])));
  await resultChangesIo.afterRead();
  // The guard: a second watch row for this event (a primary-key failure, so the whole batch rolls back)
  // unless the event is still as it was read.
  const stmts: InStatement[] = [{
    sql: `INSERT INTO result_watch (season, code, since) SELECT ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM events WHERE season = ? AND code = ? AND detail_synced_at IS ?)`,
    args: [...k, at, ...k, token],
  }];
  if (nextMissing !== (watch.missing || "{}")) stmts.push({ sql: "UPDATE result_watch SET missing = ? WHERE season = ? AND code = ?", args: [nextMissing, ...k] });
  if (changes.length) {
    // Each match's latest change of each kind is part of the diff key: the same value coming back later
    // (A → B → A) is a new change, a replay of one write is not.
    const last = new Map<string, number>();
    for (const r of await all<any>("SELECT level, series, number, kind, MAX(id) id FROM result_changes WHERE season = ? AND code = ? GROUP BY level, series, number, kind", k)) {
      last.set(`${r.level}:${r.series}:${r.number}:${r.kind}`, Number(r.id));
    }
    for (const c of changes) {
      const after = c.after ? JSON.stringify(c.after) : null;
      const key = sha([season, code, c.level, c.series, c.number, c.kind, last.get(`${c.level}:${c.series}:${c.number}:${c.kind}`) ?? 0, after ?? "-"].join("|"));
      stmts.push({
        sql: `INSERT OR IGNORE INTO result_changes (season, code, level, series, number, label, kind, fields, before, after, source, prev_source, checked_at, diff_key)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [...k, c.level, c.series, c.number, c.label, c.kind, JSON.stringify(c.fields), c.before ? JSON.stringify(c.before) : null, after, source, c.prevSource, at, key],
      });
    }
    // Retention: the newest RESULT_CHANGES_PER_EVENT stay; the rest are counted, then dropped.
    const cutoff = "(SELECT id FROM result_changes WHERE season = ? AND code = ? ORDER BY id DESC LIMIT 1 OFFSET ?)";
    stmts.push({ sql: `UPDATE result_watch SET pruned = pruned + (SELECT COUNT(*) FROM result_changes WHERE season = ? AND code = ? AND id <= ${cutoff}) WHERE season = ? AND code = ?`, args: [...k, ...k, RESULT_CHANGES_PER_EVENT, ...k] });
    stmts.push({ sql: `DELETE FROM result_changes WHERE season = ? AND code = ? AND id <= ${cutoff}`, args: [...k, ...k, RESULT_CHANGES_PER_EVENT] });
  }
  await writeBatch([...stmts, ...bundleStatements(b)]);
  return { changes: changes.length };
}
