// Choose OPR's ridge strength λ on held-out matches (not by fiat).
// Per event: fit OPR on the first 75% of played quals, predict each held-out
// alliance's non-penalty score as the sum of its robots' OPRs, and score the
// squared error. Reports RMSE per λ for the tuning season and a check season.
//
//   npx tsx scripts/fit-opr-lambda.ts [tuneSeason=2024] [checkSeason=2025]
import "../server/env.js";
import { migrate } from "../server/db.js";
import { loadSeason } from "../server/stats/load.js";
import { oprRows, solveOpr } from "../server/stats/opr.js";

const tune = Number(process.argv[2] ?? 2024), check = Number(process.argv[3] ?? 2025);
const LAMBDAS = [0, 0.25, 0.5, 1, 2, 3, 5, 8];
await migrate();

async function evaluate(season: number) {
  const events = (await loadSeason(season)).filter((e) => !e.remote && !e.hybrid);
  const err = new Map(LAMBDAS.map((l) => [l, { se: 0, n: 0 }]));
  let used = 0;
  for (const ev of events) {
    const quals = ev.matches.filter((m) => m.level === "qual" && m.played);
    if (quals.length < 12) continue;
    const cut = Math.floor(quals.length * 0.75);
    const train = oprRows(quals.slice(0, cut)), test = oprRows(quals.slice(cut));
    if (!train.length || !test.length) continue;
    used++;
    for (const l of LAMBDAS) {
      const { opr } = solveOpr(train, l);
      const e = err.get(l)!;
      const mean = train.reduce((s, r) => s + r.values.np, 0) / train.reduce((s, r) => s + r.teams.length, 0);
      for (const r of test) {
        const pred = r.teams.reduce((s, t) => s + (opr.np.get(t) ?? mean), 0);
        e.se += (pred - r.values.np) ** 2;
        e.n++;
      }
    }
  }
  return { used, rmse: LAMBDAS.map((l) => ({ lambda: l, rmse: Math.sqrt(err.get(l)!.se / Math.max(1, err.get(l)!.n)), n: err.get(l)!.n })) };
}

for (const s of [tune, check]) {
  const r = await evaluate(s);
  console.log(`\n${s}: ${r.used} events`);
  const best = r.rmse.reduce((a, b) => (b.rmse < a.rmse ? b : a));
  for (const x of r.rmse) console.log(`  λ=${String(x.lambda).padEnd(4)} RMSE ${x.rmse.toFixed(2)}${x === best ? "  ← best" : ""}`);
}
