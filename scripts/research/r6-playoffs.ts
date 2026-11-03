// Research R6 (Nov 2026): playoff-specific modeling. Two parts.
//  1. The live engine (3.3.0) on quals vs playoffs, decisive rated matches, per season: Brier, accuracy, margin
//     MAE, log loss, calibration bands, red (= higher seed) rate, finals (series 0, best of 3) vs bracket.
//  2. Separate playoff models, fitted on PLAYOFF rows only, walk-forward (monthly origins Oct 2024 – Jul 2026, each
//     fitted on the 365 days of playoff rows before it) and scored on playoff rows only, paired with the champion:
//       slope        p' = σ(a·z)                 playoff-only recalibration (mirrored, colour-blind)
//       seed         p' = σ(z + b)               a red-alliance (higher-seed) term only
//       slope+seed   p' = σ(a·z + b)             both
//       refit        the contextual model's inputs refitted on playoff rows (offset = raw logit), then σ(a·z + b)
//       margin       expected margin c·(μR − μB) + d by least squares (win chance unchanged)
//       playoff      slope+seed with the margin map: the full "separate playoff model"
//     Two champions (z = the champion's logit, used for its own baseline and every layered challenger):
//       walk-forward  (primary) the engine before its final stretch, with the stretch slope refitted at each origin
//                     on the 365 days of ALL rated matches before it, so no layer sees the scored month or later
//       served        the live engine's served chance (its stretch slope was fitted through July 2026: in-sample)
//
//   npx tsx scripts/research/r6-playoffs.ts <rows.json.gz from engine-slices --rows --features> <scores.json.gz>
//     <pre-stretch rows.json.gz from engine-slices --champion '{"rating":{},"recalibration":false}' --rows> [--out <file.json>]
import { writeFileSync } from "node:fs";
import { fit, fitContextual, contextualRaw, logit, sig } from "../part9/lib.js";
import { WINDOW, bands, loadRows, metrics, origins, paired, passes, rolledSeasons, type Row } from "./r67-lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const rows = loadRows(args[0], args[1]);
const pre = loadRows(args[2], args[1], true); // ties kept for the stretch fit, as the shipped fit
const isPO = (r: Row) => r.level === "playoff";
const m0 = (r: Row) => r.pred.champion.muR - r.pred.champion.muB;
const scored = (R: Row[]) => R.map((r) => ({ event: r.event, y: r.y, p: r.pred.champion.p, m: m0(r), margin: r.margin }));
const out: Record<string, unknown> = { generated: new Date().toISOString(), engine: "3.3.0", rows: rows.length };

// ---- Part 1: quals vs playoffs, live engine ------------------------------------------------------------------
const part1: Record<string, unknown> = {};
for (const s of [2023, 2024, 2025]) {
  const S = rows.filter((r) => r.season === s);
  const line: Record<string, unknown> = {};
  for (const [name, R] of [["qual", S.filter((r) => !isPO(r))], ["playoff", S.filter(isPO)], ["finals (series 0)", S.filter((r) => isPO(r) && r.key.split("|")[3] === "0")], ["bracket (series ≥1)", S.filter((r) => isPO(r) && r.key.split("|")[3] !== "0")]] as const) {
    const sc = scored(R);
    const fav = sc.reduce((a, r) => a + Math.max(r.p, 1 - r.p), 0) / sc.length;
    line[name] = { ...metrics(sc), favStated: fav, redWon: sc.reduce((a, r) => a + r.y, 0) / sc.length, redStated: sc.reduce((a, r) => a + r.p, 0) / sc.length, meanAbsMargin: sc.reduce((a, r) => a + Math.abs(r.margin), 0) / sc.length, bands: bands(sc) };
  }
  part1[s] = line;
  const f = (x: any) => `n ${x.n} Brier ${x.brier.toFixed(4)} [${x.brier95[0].toFixed(4)}, ${x.brier95[1].toFixed(4)}] acc ${(100 * x.accuracy).toFixed(2)}% MAE ${x.marginMae.toFixed(1)} fav ${(100 * x.favStated).toFixed(1)} red ${(100 * x.redStated).toFixed(1)}→${(100 * x.redWon).toFixed(1)}`;
  for (const k of Object.keys(line)) console.log(`${s} ${k}: ${f(line[k])}`);
}
out.qualsVsPlayoffs = part1;

// ---- Part 2: playoff challengers, walk-forward --------------------------------------------------------------
const P = rows.filter(isPO);
const preP = new Map(pre.map((r) => [r.key, r.pred.champion.p]));
type Fn = (r: Row) => number;
const names = ["slope", "seed", "slope+seed", "refit", "refit(ridge 1e-2)", "margin", "playoff"] as const;

/** The champion's chance at an origin: the served chance, or the pre-stretch chance with a stretch fitted before t0. */
function championAt(base: "walk-forward" | "served", t0: number): { champ: Fn; stretch?: number } {
  if (base === "served") return { champ: (r) => r.pred.champion.p };
  const X: number[][] = [], Y: number[] = [];
  for (const r of pre) if (r.time < t0 && r.time >= t0 - WINDOW) { const z = logit(r.pred.champion.p); X.push([z], [-z]); Y.push(r.y, 1 - r.y); }
  const [a] = fit(X, Y, [1e-4], [1]);
  return { champ: (r) => sig(a * logit(preP.get(r.key)!)), stretch: a };
}

function part2(base: "walk-forward" | "served") {
  const pred: Record<string, Map<string, { p: number; m: number }>> = Object.fromEntries([...names, "champion"].map((n) => [n, new Map()]));
  const fits: unknown[] = [];
  for (const [t0, t1] of origins()) {
    const train = P.filter((r) => r.time < t0 && r.time >= t0 - WINDOW), test = P.filter((r) => r.time >= t0 && r.time < t1);
    if (!test.length) continue;
    const { champ, stretch } = championAt(base, t0);
    const z = (r: Row) => logit(champ(r));
    for (const r of test) pred.champion.set(r.key, { p: champ(r), m: m0(r) });
    if (train.length < 500) { console.log(`origin ${new Date(t0).toISOString().slice(0, 10)}: ${train.length} playoff rows, too few, champion kept`); continue; }
    // Mirrored slope-only (colour-blind), as the shipped stretch.
    const Xm: number[][] = [], Ym: number[] = [];
    for (const r of train) { Xm.push([z(r)], [-z(r)]); Ym.push(r.y, 1 - r.y); }
    const [a1] = fit(Xm, Ym, [1e-4], [1]);
    // Red (higher seed) intercept: unmirrored. Offset z enters as a feature pinned near 1 by a stiff penalty.
    const [, b2] = fit(train.map((r) => [z(r), 1]), train.map((r) => r.y), [1e6, 1e-4], [1, 0]);
    const [a3, b3] = fit(train.map((r) => [z(r), 1]), train.map((r) => r.y), [1e-4, 1e-4], [1, 0]);
    // Contextual refit on playoff rows only (offset = the raw logit, as the shipped learner), then slope + seed.
    const refit = (ridge: number): Fn => {
      const T = train.filter((r) => r.x && r.x.every(Number.isFinite));
      const mdl = fitContextual(T.map((r) => r.x!), T.map((r) => logit(r.pRaw!)), T.map((r) => r.y), ridge);
      const raw = (r: Row) => (r.x && r.x.every(Number.isFinite) ? contextualRaw(mdl, r.x, logit(r.pRaw!)) : champ(r));
      const [a, b] = fit(T.map((r) => [logit(raw(r)), 1]), T.map((r) => r.y), [1e-4, 1e-4], [1, 0]);
      return (r) => sig(a * logit(raw(r)) + b);
    };
    const r4 = refit(1e-3), r5 = refit(1e-2);
    // Margin map: least squares of actual margin on (μR − μB, 1).
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = train.length;
    for (const r of train) { const x = m0(r); sx += x; sy += r.margin; sxx += x * x; sxy += x * r.margin; }
    const c = (n * sxy - sx * sy) / (n * sxx - sx * sx), d = (sy - c * sx) / n;
    for (const r of test) {
      const zz = z(r), m = m0(r);
      pred.slope.set(r.key, { p: sig(a1 * zz), m });
      pred.seed.set(r.key, { p: sig(zz + b2), m });
      pred["slope+seed"].set(r.key, { p: sig(a3 * zz + b3), m });
      pred.refit.set(r.key, { p: r4(r), m });
      pred["refit(ridge 1e-2)"].set(r.key, { p: r5(r), m });
      pred.margin.set(r.key, { p: champ(r), m: c * m + d });
      pred.playoff.set(r.key, { p: sig(a3 * zz + b3), m: c * m + d });
    }
    fits.push({ origin: new Date(t0).toISOString().slice(0, 10), train: train.length, test: test.length, ...(stretch ? { championStretch: +stretch.toFixed(4) } : {}), slope: +a1.toFixed(4), seedOnly: +b2.toFixed(4), slopeSeed: [+a3.toFixed(4), +b3.toFixed(4)], margin: [+c.toFixed(4), +d.toFixed(3)] });
  }
  const results: Record<string, Record<string, unknown>> = {};
  console.log(`#### champion: ${base}`);
  for (const { season, label } of rolledSeasons) {
    const R = P.filter((r) => r.season === season && pred.champion.has(r.key));
    const ch = (r: Row) => pred.champion.get(r.key)!;
    const champion = metrics(R.map((r) => ({ event: r.event, y: r.y, p: ch(r).p, m: m0(r), margin: r.margin })));
    results[label] = { champion };
    console.log(`== ${label}: playoff n ${R.length}, champion Brier ${champion.brier.toFixed(4)} acc ${(100 * champion.accuracy).toFixed(2)}% MAE ${champion.marginMae.toFixed(2)}`);
    for (const nm of names) {
      const pr = R.map((r) => { const c = pred[nm].get(r.key) ?? ch(r); return { event: r.event, y: r.y, margin: r.margin, a: ch(r).p, b: c.p, ma: m0(r), mb: c.m }; });
      const d = paired(pr);
      results[label][nm] = d;
      console.log(`  ${nm.padEnd(18)} ΔBrier ${(1e4 * d.brier).toFixed(2)}e-4 [${(1e4 * d.brier95[0]).toFixed(2)}, ${(1e4 * d.brier95[1]).toFixed(2)}]  Δacc ${d.accuracyPp.toFixed(2)} [${d.accuracy95[0].toFixed(2)}, ${d.accuracy95[1].toFixed(2)}]  ΔMAE ${d.marginMae.toFixed(3)} [${d.marginMae95[0].toFixed(3)}, ${d.marginMae95[1].toFixed(3)}]  ${passes(d) ? "PASS" : "-"}`);
    }
  }
  const gate = Object.fromEntries(names.map((nm) => [nm, rolledSeasons.every(({ label }) => passes(results[label][nm] as any))]));
  console.log("gate (both seasons):", JSON.stringify(gate));
  return { fits, challengers: results, gate };
}
out.walkForward = part2("walk-forward");
out.served = part2("served");
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1));
