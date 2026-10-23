// Engine program Part 12.8 (measure only; no build authorised): two test-only slice tags.
//   Short turnaround: in a qualification match, the fewest matches any robot sat out since its previous match
//   at the event (schedule order; start times are too patchy). Does an alliance whose robot just played do
//   worse than the engine says? Measured as the alliance's win rate against its stated chance (and the score
//   miss), with event-bootstrap intervals, alliance by alliance.
//   Alliance colour: red's win rate against red's stated chance, per season, quals and playoffs.
// A tag graduates to a build item only with an effect that survives the held-out season (2025–26).
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/tags-research.ts [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, predictMatch } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { outcome, predictable, seasonCorpus } from "../slices/corpus.js";
import { rng } from "../slices/report.js";

await migrate();
const M = FITTED_MODEL;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
interface A { season: number; event: string; level: string; gap: number; p: number; y: number; miss: number; red: boolean }
const rows: A[] = [];
const book = new RatingBook(M.rating);
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  const last = new Map<string, number>(); // event|team → index of its last qual at the event
  const idx = new Map<string, number>();  // event → quals seen so far
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    book.setTime(m.time);
    if (predictable(m)) {
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const pc = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      const y = outcome(m);
      const k = idx.get(m.eventCode) ?? 0;
      for (const [al, red] of [[m.red, true], [m.blue, false]] as const) {
        const gaps = al.teams.map((t) => { const l = last.get(`${m.eventCode}|${t}`); return l == null ? Infinity : k - l - 1; });
        const pr = red ? pc.pRedWin : 1 - pc.pRedWin, pred = red ? pc.red.mean : pc.blue.mean;
        rows.push({ season: s, event: `${s}|${m.eventCode}`, level: m.level, gap: m.level === "qual" ? Math.min(...gaps) : NaN, p: pr, y: red ? y : 1 - y, miss: al.total - pred, red });
      }
    }
    if (m.level === "qual") { const k = idx.get(m.eventCode) ?? 0; for (const t of [...m.red.teams, ...m.blue.teams]) last.set(`${m.eventCode}|${t}`, k); idx.set(m.eventCode, k + 1); }
    book.update(m);
  }
}
/** mean(y − p) with an event-bootstrap 95% interval. */
function gapStat(R: A[], f: (r: A) => number, draws = 1000) {
  const by = new Map<string, A[]>(); for (const r of R) { const l = by.get(r.event) ?? []; l.push(r); by.set(r.event, l); }
  const evs = [...by.values()], rnd = rng(11), mean = (S: A[]) => S.reduce((a, r) => a + f(r), 0) / S.length;
  const d: number[] = [];
  for (let b = 0; b < draws; b++) d.push(mean(Array.from({ length: evs.length }, () => evs[Math.floor(rnd() * evs.length)]).flat()));
  d.sort((a, b) => a - b);
  return { n: R.length, mean: mean(R), lo: d[Math.floor(draws * 0.025)], hi: d[Math.floor(draws * 0.975)] };
}
const out: Record<string, unknown> = {};
const fmt = (x: { n: number; mean: number; lo: number; hi: number }, k = 100, u = "pts") => `${(k * x.mean).toFixed(2)} [${(k * x.lo).toFixed(2)}, ${(k * x.hi).toFixed(2)}] ${u} (n ${x.n})`;
for (const s of [2023, 2024, 2025]) {
  const Q = rows.filter((r) => r.season === s && r.level === "qual" && Number.isFinite(r.gap));
  const bands: [string, (g: number) => boolean][] = [["0 (back-to-back)", (g) => g === 0], ["1", (g) => g === 1], ["2–3", (g) => g >= 2 && g <= 3], ["4+", (g) => g >= 4]];
  const turn = Object.fromEntries(bands.map(([name, f]) => { const R = Q.filter((r) => f(r.gap)); return [name, { winMinusStated: gapStat(R, (r) => r.y - r.p), scoreMiss: gapStat(R, (r) => r.miss) }]; }));
  const colour = Object.fromEntries((["qual", "playoff"] as const).map((lv) => [lv, gapStat(rows.filter((r) => r.season === s && r.level === lv && r.red), (r) => r.y - r.p)]));
  out[s] = { turnaround: turn, redWinMinusStated: colour };
  console.log(`${s}: short turnaround (fewest matches sat out by any robot since its last), alliance won − stated / score miss`);
  for (const [name, v] of Object.entries(turn)) console.log(`  ${name.padEnd(17)} ${fmt(v.winMinusStated)}  miss ${fmt(v.scoreMiss, 1, "points")}`);
  console.log(`  red won − stated: quals ${fmt(colour.qual)}  playoffs ${fmt(colour.playoff)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
