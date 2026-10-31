// Does schedule difficulty explain part of the gap between a team's qualification rank and its rating rank?
//
//   npm run schedule:eval -- [season …] [--min-teams N]
//
// Finished past events (every scheduled qualification match played, at least --min-teams ranked teams, league
// meets left out: their FIRST rank is the league's running standing). Per team:
//   rating rank — its place in the field by the engine's rating at the event's start (no hindsight; last-season
//                 priors for teams with no result yet), the figure the site would have shown that morning
//   qual rank   — its official rank there
//   gap         — (qual rank − rating rank) / (field − 1): + = finished lower than its rating said
//   z           — its full-schedule difficulty, normalised across the field (src/shared/scheduleDifficulty.ts)
// Reported: Pearson r and R² of gap on z (the share of the gap's variance the schedule accounts for), the slope in
// places per standard deviation of schedule, and the mean gap of the hardest and easiest quarter of schedules. A
// second pass reads strength from the season-end ratings instead (hindsight, but a steadier measure of how good
// each robot really was). Variants of the formula are compared on the same teams.
import "../server/env.js";
import { all, migrate } from "../server/db.js";
import { forecasterFor } from "../server/predict/engine.js";
import { scheduleDifficulty, type ScheduleMatch } from "../src/shared/scheduleDifficulty.js";
import type { RatingBook } from "@control-scout/predict-engine";

await migrate();
const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seasons = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
const minTeams = Number(flag("--min-teams") ?? 12);

interface Ev { code: string; startMs: number; ranks: Map<number, number>; quals: ScheduleMatch[] }

async function loadEvents(season: number): Promise<Ev[]> {
  const evs = await all<any>("SELECT code, start, type FROM events WHERE season = ? AND start IS NOT NULL", [season]);
  const ranks = await all<any>("SELECT code, team, rank FROM event_teams WHERE season = ? AND rank IS NOT NULL", [season]);
  const lineups = await all<any>(
    `SELECT m.code, m.series, m.number, m.played, mt.team, mt.alliance, mt.surrogate FROM matches m
     JOIN match_teams mt ON mt.season = m.season AND mt.code = m.code AND mt.level = m.level AND mt.series = m.series AND mt.number = m.number
     WHERE m.season = ? AND m.level = 'qual'`, [season]);
  const rankBy = new Map<string, Map<number, number>>();
  for (const r of ranks) { if (!rankBy.has(r.code)) rankBy.set(r.code, new Map()); rankBy.get(r.code)!.set(Number(r.team), Number(r.rank)); }
  const matchBy = new Map<string, Map<string, ScheduleMatch>>();
  for (const l of lineups) {
    if (!matchBy.has(l.code)) matchBy.set(l.code, new Map());
    const k = `${l.series}:${l.number}`, ms = matchBy.get(l.code)!;
    if (!ms.has(k)) ms.set(k, { red: [], blue: [], played: !!Number(l.played), noRank: [] });
    const m = ms.get(k)!;
    (l.alliance === "red" ? m.red : m.blue).push(Number(l.team));
    if (Number(l.surrogate)) m.noRank!.push(Number(l.team));
  }
  const out: Ev[] = [];
  for (const e of evs) {
    if (String(e.type).replace(/\s+/g, "") === "LeagueMeet") continue;
    const rk = rankBy.get(e.code), ms = matchBy.get(e.code);
    if (!rk || !ms || rk.size < minTeams) continue;
    const quals = [...ms.values()];
    if (!quals.every((m) => m.played) || quals.some((m) => m.red.length !== 2 || m.blue.length !== 2)) continue;
    out.push({ code: e.code, startMs: Date.parse(`${e.start}T00:00:00Z`), ranks: rk, quals });
  }
  return out;
}

interface Row { season: number; event: string; gap: number; gapPlaces: number; z: Record<string, number> }

const npOf = (book: RatingBook, t: number) => { const r = book.get(t); return r.auto + r.teleop + r.endgame; };

/** Per-team rows for one event from one set of ratings. */
function rowsFor(season: number, ev: Ev, rating: Map<number, number>): Row[] {
  const sd = scheduleDifficulty(rating, ev.quals);
  if (!sd) return [];
  const field = [...rating.keys()];
  const n = field.length;
  const byRating = [...field].sort((a, b) => rating.get(b)! - rating.get(a)!);
  const ratingRank = new Map(byRating.map((t, i) => [t, i + 1]));
  // Official ranks re-numbered within the teams we rate (1…n).
  const byQual = [...field].sort((a, b) => ev.ranks.get(a)! - ev.ranks.get(b)!);
  const qualRank = new Map(byQual.map((t, i) => [t, i + 1]));
  // Variants, each z-scored within the event.
  const variants: Record<string, (o: number, p: number) => number> = { "opp − part (shipped)": (o, p) => o - p, "2·opp − part": (o, p) => 2 * o - p, "opponents only": (o) => o, "partners only (−)": (_o, p) => -p };
  const rows = sd.teams.filter((t) => t.full && t.full.matches >= 3);
  const zs: Record<string, Map<number, number>> = {};
  for (const [name, fn] of Object.entries(variants)) {
    const v = rows.map((t) => fn(t.full!.opponents, t.full!.partners));
    const m = v.reduce((a, b) => a + b, 0) / v.length, s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
    zs[name] = new Map(rows.map((t, i) => [t.team, (v[i] - m) / s]));
  }
  return rows.map((t) => {
    const g = qualRank.get(t.team)! - ratingRank.get(t.team)!;
    return { season, event: `${season}:${ev.code}`, gap: g / (n - 1), gapPlaces: g, z: Object.fromEntries(Object.keys(variants).map((k) => [k, zs[k].get(t.team)!])) };
  });
}

function stats(rows: Row[], key: string) {
  const x = rows.map((r) => r.z[key]), y = rows.map((r) => r.gap), yp = rows.map((r) => r.gapPlaces);
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length, myp = yp.reduce((a, b) => a + b, 0) / yp.length;
  let sxy = 0, sxx = 0, syy = 0, sxyp = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; sxyp += (x[i] - mx) * (yp[i] - myp); }
  const r = sxy / Math.sqrt(sxx * syy);
  const sorted = rows.map((row, i) => ({ z: x[i], g: row.gapPlaces })).sort((a, b) => b.z - a.z);
  const q = Math.floor(sorted.length / 4);
  const avg = (xs: { g: number }[]) => xs.reduce((a, b) => a + b.g, 0) / xs.length;
  // Bootstrap 95% interval for r, resampling whole events (a field's teams aren't independent), fixed seed.
  let seed = 12345;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => { if (!groups.has(row.event)) groups.set(row.event, []); groups.get(row.event)!.push(i); });
  const ids = [...groups.values()];
  const rs: number[] = [];
  for (let b = 0; b < 400; b++) {
    let a = 0, c = 0, d = 0, e = 0, f = 0, n = 0;
    for (let k = 0; k < ids.length; k++) for (const j of ids[Math.floor(rand() * ids.length)]) { n++; a += x[j]; c += y[j]; d += x[j] * y[j]; e += x[j] ** 2; f += y[j] ** 2; }
    rs.push((d - (a * c) / n) / Math.sqrt((e - (a * a) / n) * (f - (c * c) / n)));
  }
  rs.sort((p, q2) => p - q2);
  return { n: x.length, r, r2: r * r, lo: rs[10], hi: rs[389], slope: sxyp / sxx, hard: avg(sorted.slice(0, q)), easy: avg(sorted.slice(-q)) };
}

const all2: Record<"start" | "end", Row[]> = { start: [], end: [] };
for (const season of seasons.length ? seasons : [2023, 2024, 2025]) {
  const f = await forecasterFor(season);
  const evs = await loadEvents(season);
  const byStart = new Map<number, Ev[]>();
  for (const e of evs) { if (!byStart.has(e.startMs)) byStart.set(e.startMs, []); byStart.get(e.startMs)!.push(e); }
  const start: Row[] = [];
  // Ratings as they stood the morning each event began (the season replayed to that instant).
  f.replayTo(season, [...byStart.keys()], (ms, book) => {
    for (const e of byStart.get(ms)!) start.push(...rowsFor(season, e, new Map([...e.ranks.keys()].map((t) => [t, npOf(book, t)]))));
  });
  const endBook = f.book(season);
  const end: Row[] = endBook ? evs.flatMap((e) => rowsFor(season, e, new Map([...e.ranks.keys()].map((t) => [t, npOf(endBook, t)])))) : [];
  all2.start.push(...start); all2.end.push(...end);
  const s = stats(start, "opp − part (shipped)"), s2 = stats(end, "opp − part (shipped)");
  console.log(`${season}: ${evs.length} events, ${s.n} teams | start ratings r=${s.r.toFixed(3)} R²=${(s.r2 * 100).toFixed(1)}% | season-end ratings r=${s2.r.toFixed(3)} R²=${(s2.r2 * 100).toFixed(1)}%`);
}
const fmt = (s: ReturnType<typeof stats>) => `r=${s.r.toFixed(3)} [${s.lo.toFixed(3)}, ${s.hi.toFixed(3)}]  R²=${(s.r2 * 100).toFixed(1)}%  slope ${s.slope >= 0 ? "+" : ""}${s.slope.toFixed(2)} places/SD  hardest quarter ${s.hard >= 0 ? "+" : ""}${s.hard.toFixed(2)} places, easiest quarter ${s.easy >= 0 ? "+" : ""}${s.easy.toFixed(2)} places  (n=${s.n})`;
for (const which of ["start", "end"] as const) {
  console.log(`\nPooled, ${which === "start" ? "ratings at each event's start (no hindsight)" : "season-end ratings (hindsight)"}:`);
  for (const k of Object.keys(all2[which][0]?.z ?? {})) console.log(`  ${k.padEnd(22)} ${fmt(stats(all2[which], k))}`);
}
process.exit(0);
