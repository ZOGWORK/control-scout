// Engine program Part 12.7, step 1 (measure; judged by the numbers it claims to fix, not headline accuracy):
// would count-based phase distributions fix anything the engine's consumers get wrong today? The consumers the
// brief names are bonus-RP odds (2025+), score-range widths and the event simulator. Today none of them samples
// a phase on its own: bonus odds integrate a logistic over the alliance's whole non-penalty score, and the
// simulator draws that total and splits it by phase share. So the test is whether those calls are already
// right where lumpy, low-count scoring would bite (low scores, auto-heavy alliances):
//   - 80% score ranges: share of real final scores inside, by expected-score quintile, 2023–24 to 2025–26;
//   - bonus-RP odds (2025–26 quals, walk-forward as the ledger states them): stated against earned per bonus,
//     by stated-probability decile.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/counts-research.ts [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { BONUS_MIN_SAMPLES, BONUS_SLOTS, BonusHistory, FITTED_MODEL, RatingBook, explainMatch, type BonusModelSource } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
interface R { season: number; level: string; exp: number; autoShare: number; inside: boolean; below: boolean; bonus?: { p: number[]; got: boolean[] } }
const rows: R[] = [];
const book = new RatingBook(M.rating);
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  // Bonus odds as the live ledger states them (server/stats/job.ts): walk-forward, refitted every 50 new
  // alliances from this season's results strictly before the match, never the shipped whole-season fit.
  const history = new BonusHistory();
  let bonusSrc: BonusModelSource | null = null, fittedAt = 0;
  for (const m of matches) {
    if (s >= 2025 && m.level === "qual") { const known = history.countBefore(m.time); if (known >= Math.max(BONUS_MIN_SAMPLES, fittedAt + 50)) { bonusSrc = history.modelBefore(m.time); fittedAt = known; } }
    if (unrated.has(m.eventCode)) { history.add(m); continue; }
    book.setTime(m.time);
    if (predictable(m)) {
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const x = explainMatch(book, m.red.teams, m.blue.teams, { noise: M.noise, calibration: M.calibration, contextual: M.contextual, context: ctx, band: M.band, ...(s === 2025 && m.level === "qual" && bonusSrc ? { bonus: { season: 2025, model: bonusSrc } } : {}) });
      const exp = book.withRegion(ctx.region, () => book.withEvent(ctx.event, () => [m.red, m.blue].map((al) => book.allianceExpectation(al.teams, m.level))));
      for (const [al, k, range, pred] of [[m.red, 0, x.scoreRangeA, x.predictedScoreA], [m.blue, 1, x.scoreRangeB, x.predictedScoreB]] as const) {
        const b = x.bonus ? (k === 0 ? x.bonus.A : x.bonus.B) : null;
        rows.push({
          season: s, level: m.level, exp: pred, autoShare: exp[k].np > 0 ? exp[k].auto / exp[k].np : 0,
          inside: al.total >= range[0] && al.total <= range[1], below: al.total < range[0],
          ...(b && al.bonusRp ? { bonus: { p: BONUS_SLOTS.map((sl) => b.p[sl]), got: BONUS_SLOTS.map((sl) => al.bonusRp![sl]) } } : {}),
        });
      }
    }
    book.update(m);
    history.add(m);
  }
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out: Record<string, unknown> = {};
for (const s of [2023, 2024, 2025]) {
  const S = rows.filter((r) => r.season === s);
  const cut = (f: (r: R) => number) => [0.2, 0.4, 0.6, 0.8].map((p) => q(S.map(f), p));
  const bucket = (f: (r: R) => number) => { const c = cut(f); return [0, 1, 2, 3, 4].map((i) => S.filter((r) => (i === 0 || f(r) > c[i - 1]) && (i === 4 || f(r) <= c[i]))); };
  const cov = (B: R[]) => ({ n: B.length, inside: B.filter((r) => r.inside).length / B.length, below: B.filter((r) => r.below).length / B.length });
  const byScore = bucket((r) => r.exp).map(cov), byAuto = bucket((r) => r.autoShare).map(cov);
  out[s] = { all: cov(S), byExpectedScoreQuintile: byScore, byAutoShareQuintile: byAuto };
  const pc = (c: { inside: number; below: number }) => `${(100 * c.inside).toFixed(1)}% in (${(100 * c.below).toFixed(1)}% below)`;
  console.log(`${s}: 80% ranges, ${pc(cov(S))}`);
  console.log(`  by expected score (low → high): ${byScore.map(pc).join("  ")}`);
  console.log(`  by auto share (low → high):     ${byAuto.map(pc).join("  ")}`);
}
const B = rows.filter((r) => r.bonus);
const bonus = BONUS_SLOTS.map((sl, j) => {
  const dec = [...B].sort((a, b) => a.bonus!.p[j] - b.bonus!.p[j]);
  const bins = Array.from({ length: 10 }, (_, k) => dec.slice(Math.floor((k * dec.length) / 10), Math.floor(((k + 1) * dec.length) / 10)))
    .map((D) => ({ n: D.length, stated: D.reduce((a, r) => a + r.bonus!.p[j], 0) / D.length, earned: D.filter((r) => r.bonus!.got[j]).length / D.length }));
  const err = bins.reduce((a, b) => a + b.n * Math.abs(b.stated - b.earned), 0) / B.length;
  console.log(`2025 bonus ${sl}: calibration error ${(100 * err).toFixed(2)} pts; deciles stated/earned ${bins.map((b) => `${(100 * b.stated).toFixed(0)}/${(100 * b.earned).toFixed(0)}`).join(" ")}`);
  return { slot: sl, n: B.length, error: err, deciles: bins };
});
out.bonus2025 = { note: "walk-forward season model, as the live ledger states bonus odds", slots: bonus };
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
