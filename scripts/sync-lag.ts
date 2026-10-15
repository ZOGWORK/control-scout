// Does syncing faster make predictions better? (evidence for the live fast lane, server/data/live.ts)
//
//   npx tsx scripts/result-delays.ts 2025 30 delays.json   # sample FIRST publication delays (GET only)
//   npx tsx scripts/sync-lag.ts 2025 delays.json 2026       # simulate; extra seasons: live-ledger coverage only
//
// Walk-forward over a season, like the backtest ledger, but each match is
// predicted 60 s before it starts from ratings that include only the results
// the server would have had by then under a sync cadence:
//   oracle  — every result the moment FIRST publishes it
//   60 s    — the fast lane (results land at the next 60 s tick after publication)
//   15 min  — the old event-day cycle
//   daily   — nothing from the same day (ratings as of the previous night)
// Publication delay (start → FIRST posts the result) is sampled from real
// FIRST postResultTime − actualStartTime measurements (scripts/result-delays.ts).
import { readFileSync } from "node:fs";
import { RatingBook, FITTED_MODEL, explainMatch, npOf, type EventRecord, type MatchRecord } from "@control-scout/predict-engine";
import { loadSeason, toEventRecord } from "../server/stats/load.js";
import { SEASON_NUMBERS } from "../server/data/seasons.js";
import { configure } from "../server/db.js";

await configure();
const SEASON = Number(process.argv[2] ?? 2025);
const delays: number[] = JSON.parse(readFileSync(process.argv[3], "utf8")).map((d: any) => d.delayS * 1000).filter((x: number) => x > 0 && x < 3600_000);
if (!delays.length) throw new Error("No usable publication delays in the sample (need 0 < delay < 1 h): nothing to simulate.");
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 2 ** 32; };
const keyOf = (m: MatchRecord) => `${m.eventCode}|${m.level}:${m.series}:${m.number}`;
const delayOf = (m: MatchRecord) => delays[Math.floor(hash(keyOf(m)) * delays.length)];

// Ratings up to the season before.
const base = new RatingBook(FITTED_MODEL.rating);
for (const s of SEASON_NUMBERS.filter((x) => x < SEASON).sort()) {
  const evs = await loadSeason(s);
  const recs = evs.map((e) => toEventRecord(e)).filter((x): x is EventRecord => !!x);
  base.startSeason(s);
  for (const m of recs.flatMap((e) => e.matches).sort((a, b) => a.time - b.time)) base.update(m);
}
const evs = await loadSeason(SEASON);
const recs = evs.map((e) => toEventRecord(e)).filter((x): x is EventRecord => !!x); // rated events only
const matches = recs.flatMap((e) => e.matches).sort((a, b) => a.time - b.time);
const targets = matches.filter((m) => m.red.teams.length === 2 && m.blue.teams.length === 2);
console.log(`${SEASON}: ${recs.length} rated events, ${matches.length} matches, ${targets.length} 2v2 matches predicted`);

const DAY = 864e5;
type Scn = { name: string; avail: (m: MatchRecord) => number };
const phase = (m: MatchRecord, P: number) => hash(m.eventCode + "phase") * P; // each server's ticks fall at a random offset
const tick = (m: MatchRecord, P: number) => { const a = m.time + delayOf(m), ph = phase(m, P); return Math.ceil((a - ph) / P) * P + ph; };
const scenarios: Scn[] = [
  { name: "oracle", avail: (m) => m.time + delayOf(m) },
  { name: "60 s", avail: (m) => tick(m, 60_000) },
  { name: "15 min", avail: (m) => tick(m, 900_000) },
  { name: "daily", avail: (m) => (Math.floor(m.time / DAY) + 1) * DAY },
];

const res = new Map<string, Map<string, { p: number; y: number; sameEvent: number }>>();
const ratingMoves: number[] = []; const ratingLevels: number[] = [];
for (const sc of scenarios) {
  const book = base.clone(); book.startSeason(SEASON);
  const updates = matches.map((m) => ({ m, at: sc.avail(m) })).sort((a, b) => a.at - b.at || a.m.time - b.m.time);
  const preds = targets.map((m) => ({ m, at: m.time - 60_000 })).sort((a, b) => a.at - b.at);
  const out = new Map<string, { p: number; y: number; sameEvent: number }>();
  const seenByEvent = new Map<string, number>();
  let u = 0;
  for (const { m, at } of preds) {
    while (u < updates.length && updates[u].at <= at) {
      const um = updates[u].m;
      const teams = [...um.red.teams, ...um.blue.teams];
      const before = sc.name === "oracle" ? teams.map((t) => npOf(book.get(t))) : [];
      book.update(um);
      if (sc.name === "oracle") teams.forEach((t, i) => { const after = npOf(book.get(t)); ratingMoves.push(Math.abs(after - before[i])); ratingLevels.push(after); });
      seenByEvent.set(um.eventCode, (seenByEvent.get(um.eventCode) ?? 0) + 1);
      u++;
    }
    book.setTime(at);
    const x = explainMatch(book, m.red.teams, m.blue.teams, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration });
    const y = m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5;
    out.set(keyOf(m), { p: x.winProbA, y, sameEvent: seenByEvent.get(m.eventCode) ?? 0 });
  }
  res.set(sc.name, out);
}

const keys = targets.map(keyOf);
const brier = (r: { p: number; y: number }) => (r.p - r.y) ** 2;
const acc = (r: { p: number; y: number }): number | null => (r.y === 0.5 ? null : (r.p > 0.5) === (r.y === 1) ? 1 : 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length)); };
function summary(name: string, ks: string[]) {
  const r = res.get(name)!;
  const rows = ks.map((k) => r.get(k)!);
  const a = rows.map(acc).filter((x): x is number => x != null);
  return { brier: mean(rows.map(brier)), acc: mean(a), n: rows.length };
}
// Quantile; NaN for an empty sample (prints "NaN" instead of throwing).
const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
console.log(`rating move per team per match (oracle pass): median ${q(ratingMoves, 0.5).toFixed(2)} pts, p90 ${q(ratingMoves, 0.9).toFixed(2)}; median rating ${q(ratingLevels, 0.5).toFixed(1)} (np pts per robot)`);
for (const sc of scenarios) { const s = summary(sc.name, keys); console.log(`${sc.name.padEnd(7)} all: Brier ${s.brier.toFixed(4)} acc ${(s.acc * 100).toFixed(2)}% (n ${s.n})`); }
// Paired comparisons where the information actually differed.
for (const [a, b] of [["60 s", "15 min"], ["60 s", "daily"], ["oracle", "60 s"]]) {
  const ra = res.get(a)!, rb = res.get(b)!;
  const diff = keys.filter((k) => ra.get(k)!.sameEvent !== rb.get(k)!.sameEvent);
  const d = diff.map((k) => brier(rb.get(k)!) - brier(ra.get(k)!));
  const dp = diff.map((k) => Math.abs(ra.get(k)!.p - rb.get(k)!.p));
  const flips = diff.filter((k) => (ra.get(k)!.p > 0.5) !== (rb.get(k)!.p > 0.5)).length;
  if (!diff.length) { console.log(`${a} vs ${b}: no match saw different same-event results`); continue; }
  const sa = summary(a, diff), sb = summary(b, diff);
  console.log(`${a} vs ${b}: ${diff.length} of ${keys.length} matches saw different same-event results; on those Brier ${sb.brier.toFixed(4)} → ${sa.brier.toFixed(4)} (Δ ${mean(d).toFixed(4)} ± ${(1.96 * se(d)).toFixed(4)} 95% CI), acc ${(sb.acc * 100).toFixed(2)}% → ${(sa.acc * 100).toFixed(2)}%, |Δp| median ${q(dp, 0.5).toFixed(3)} p90 ${q(dp, 0.9).toFixed(3)}, ${flips} favourite flips; whole season Δ Brier ${(d.reduce((x, y) => x + y, 0) / keys.length).toFixed(5)}`);
}

// Live ledger: a call is logged only if the lineup is seen ≥ 60 s before the start.
// Quals: assumed published well ahead (both cadences log them). Playoffs: the
// lineup exists once both alliances' previous playoff match is published (round
// one: once the last qual is published — alliance selection only follows it, so
// this is generous to both cadences). Expected logged = clamp((start − 60 s − k)/P, 0, 1).
for (const s of [SEASON, ...process.argv.slice(4).map(Number)]) {
  const evRecs = s === SEASON ? recs : (await loadSeason(s)).map((e) => toEventRecord(e, { anyType: true })).filter((x): x is EventRecord => !!x);
  let n = 0; const logged = { "60 s": 0, "15 min": 0, "15 min + 2 min cycle": 0 };
  for (const e of evRecs) {
    const quals = e.matches.filter((m) => m.level === "qual");
    const lastQualAvail = quals.length ? Math.max(...quals.map((m) => m.time + delayOf(m))) : null;
    const po = e.matches.filter((m) => m.level === "playoff").sort((a, b) => a.time - b.time);
    for (const m of po) {
      if (m.red.teams.length !== 2 || m.blue.teams.length !== 2) continue;
      const prevOf = (teams: number[]) => po.filter((x) => x.time < m.time && [x.red.teams, x.blue.teams].some((al) => al.some((t) => teams.includes(t)))).pop();
      const feeders = [prevOf(m.red.teams), prevOf(m.blue.teams)];
      const k = Math.max(...feeders.map((f) => (f ? f.time + delayOf(f) : lastQualAvail ?? -Infinity)));
      n++;
      const slack = m.time - 60_000 - k;
      logged["60 s"] += Math.min(1, Math.max(0, slack / 60_000));
      logged["15 min"] += Math.min(1, Math.max(0, slack / 900_000));
      logged["15 min + 2 min cycle"] += Math.min(1, Math.max(0, (slack - 120_000) / 900_000));
    }
  }
  console.log(`${s} playoff 2v2 matches: ${n}; expected live calls logged: ${Object.entries(logged).map(([k, v]) => `${k} ${v.toFixed(0)} (${((v / Math.max(1, n)) * 100).toFixed(0)}%)`).join(", ")}`);
}
