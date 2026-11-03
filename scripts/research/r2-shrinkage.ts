// Research R2, shrinkage for low-sample teams: an empirical-Bayes prior strength per prior class.
//
// The live update gain g(n) = max(kMin, k0 / (1 + n/n0)) applied to a robot's share s = ½ of its alliance's miss
// is a sequential partial-pooling estimate: per robot, g·s = 1 / (A + B·n) with A = 1/(k0·s) and B = A/n0, i.e. a
// normal-mean update whose prior (the season start: carry-over z, rookie z, regional lift) is worth A − 1
// observations of noise-to-prior-variance (σ²/τ² = A − 1 ≈ 2.08 at k0 0.65). That ratio is the SAME for a robot
// whose prior comes from last season's ratings and for one with no history, although the engine itself states the
// second prior is far less certain (uncRookie 350 vs uncKnown 150 points², used only for the probability's width).
// Empirical Bayes says the prior's weight should follow its variance: with τ²_R = ρ·τ²_K,
//   σ²/τ²_R = (A − 1)/ρ,  A_R = 1 + (A − 1)/ρ,  g_R(n)·s = 1 / (A_R + B·n),
// which in the engine's own terms is the live gain computed as if a no-history robot had played Δ fewer matches:
//   gainN = n − Δ,  Δ = n0 · (1 − A_R / A).
// ρ = 1 is the live engine; ρ = uncRookie/uncKnown = 2.33 is the engine's own stated variance ratio (no fit). The
// script also reports a method-of-moments check of ρ from the champion's own replay, a grid of ρ, and the
// rolling-origin choice of ρ (each month: the best ρ on the 365 days before it).
//
//   DATABASE_URL=file:.data/research/snap.db npx tsx scripts/research/r2-shrinkage.ts [--out docs/engine/research-2026-11/r2-shrinkage-2026-11-03.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ENGINE_VERSION, RatingBook, type TeamRating } from "@control-scout/predict-engine";
import { kvGet } from "../../server/db.js";
import { LEGACY_RATING, LIVE, M, SLICES, brierWithTies, fmt, gatePasses, paired, patchedBook, replay, rollingPick, summary, type GainPatch, type Row, type Variant } from "./lib.js";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/engine/research-2026-11/r2-shrinkage-2026-11-03.json";
const live = M.rating as { k0: number; n0: number; uncKnown: number; uncRookie: number };
const SHARE = 0.5;
const A = 1 / (live.k0 * SHARE);
/** Matches of gain experience a no-history robot is spared at prior-variance ratio ρ. */
export const headStart = (rho: number) => live.n0 * (1 - (1 + (A - 1) / rho) / A);

function rookieStrength(rho: number): GainPatch {
  const d = headStart(rho);
  return { gainN: (t, r, _m, book) => (book.priorZ(t).known ? undefined : Math.max(-0.9 * live.n0, r.n - d)) };
}

// Method-of-moments probe on the champion (a no-op patch: it only records). Per team and season: the prior it was
// stored with, its class, and its stored rating object (which ends the season holding its final rating).
const probe = new Map<string, { season: number; known: boolean; prior: number; ref: TeamRating }>();
let season = 0;
const champion = patchedBook({}, {
  gainN: (t, r, _m, book) => {
    const k = `${season}|${t}`;
    if (!probe.has(k) && r.n === 0) probe.set(k, { season, known: book.priorZ(t).known, prior: r.auto + r.teleop + r.endgame, ref: r });
    return undefined;
  },
  season: (s) => { season = s; },
});

const RHOS = [0.5, 0.7, 1.5, live.uncRookie / live.uncKnown, 3.5, 5, 8];
interface Spec { name: string; rho: number | null; label: string; book: () => RatingBook; legacy?: boolean }
const specs: Spec[] = [
  { name: "live", rho: 1, label: "live 3.3.0 (ρ = 1: one prior strength for every robot)", book: () => champion },
  ...RHOS.map((rho) => ({ name: `rho-${+rho.toFixed(2)}`, rho, label: `ρ ${+rho.toFixed(2)} (head start Δ ${headStart(rho).toFixed(2)} matches)`, book: () => patchedBook({}, rookieStrength(rho)) })),
  { name: "legacy", rho: null, label: "Engine 1.x (frozen; the published 72.7% / 0.179)", book: () => new RatingBook(LEGACY_RATING), legacy: true },
];
const variants: Variant[] = specs.map((s) => ({ name: s.name, book: s.book(), legacy: s.legacy }));
const t0 = Date.now();
const rows = await replay(variants);
console.error(`replayed ${variants.length} books in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const SEASONS: [string, number][] = [["2024", 2024], ["2025", 2025]];
const bySeason = (s: number) => rows.filter((r) => r.season === s);
const idx = (name: string) => specs.findIndex((s) => s.name === name);

// Moments: Var((final − prior) / sd) by class, robots with 20+ matches (final ratings are then mostly data).
const moments = Object.fromEntries([2024, 2025].map((s) => {
  const xs = [...probe.values()].filter((p) => p.season === s && p.ref.n >= 20);
  const finals = xs.map((p) => p.ref.auto + p.ref.teleop + p.ref.endgame);
  const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
  const sd = Math.sqrt(finals.reduce((a, b) => a + (b - mean) ** 2, 0) / (finals.length - 1));
  const v = (known: boolean) => {
    const d = xs.filter((p) => p.known === known).map((p) => (p.ref.auto + p.ref.teleop + p.ref.endgame - p.prior) / sd);
    const m = d.reduce((a, b) => a + b, 0) / d.length;
    return { n: d.length, meanMiss: m, variance: d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length - 1), meanSquare: d.reduce((a, b) => a + b * b, 0) / d.length };
  };
  const known = v(true), rookie = v(false);
  return [String(s), { robots: xs.length, popSd: sd, known, rookie, varianceRatio: rookie.variance / known.variance, meanSquareRatio: rookie.meanSquare / known.meanSquare }];
}));

const grid = specs.map((s, i) => ({
  name: s.name, rho: s.rho, label: s.label, headStart: s.rho ? headStart(s.rho) : null,
  seasons: Object.fromEntries(SEASONS.map(([k, season]) => {
    const R = bySeason(season);
    return [k, { summary: summary(R, i), slices: Object.fromEntries(SLICES.map(([name, keep]) => [name, i === 0 ? null : paired(R.filter(keep), 0, i)])) }];
  })),
}));

const family = specs.map((s, i) => (s.rho != null ? i : -1)).filter((i) => i >= 0);
const roll = rollingPick(rows, family);
const pa = (r: Row): [number, number] => { const j = roll.pick.get(r.key)!; return [r.p[j], r.mg[j]]; };
const rolledSeasons = Object.fromEntries(SEASONS.map(([k, season]) => {
  const R = bySeason(season).filter((r) => roll.pick.has(r.key));
  const slices = Object.fromEntries(SLICES.map(([name, f]) => [name, paired(R.filter(f), 0, -1, pa)]));
  return [k, { slices, gate: gatePasses(slices.all) }];
}));
const rolled = { months: roll.months.map((m) => ({ ...m, pick: specs[m.pick].name })), seasons: rolledSeasons, gate: Object.values(rolledSeasons).every((x) => x.gate) };

// The a-priori candidate (ρ = uncRookie/uncKnown, nothing fitted) and the tuning season's best ρ, judged on both.
const apriori = idx(`rho-${+(live.uncRookie / live.uncKnown).toFixed(2)}`);
const tuned = family.reduce((b, j) => (summary(bySeason(2024), j).brier < summary(bySeason(2024), b).brier ? j : b), family[0]);
const judged = (j: number) => { const seasons = Object.fromEntries(SEASONS.map(([k, season]) => [k, paired(bySeason(season), 0, j)])); return { pick: specs[j].name, seasons, gate: Object.values(seasons).every(gatePasses) }; };

const check = { brierWithTies2025: brierWithTies(bySeason(2025), 0), legacyBrierWithTies2025: brierWithTies(bySeason(2025), idx("legacy")), legacyAccuracy2025: summary(bySeason(2025), idx("legacy")).accuracy };
const out = {
  meta: {
    generated: new Date().toISOString().slice(0, 10), engine: ENGINE_VERSION, dataVersion: await kvGet<string>("data:version"), script: "scripts/research/r2-shrinkage.ts",
    protocol: "Walk-forward replay of the backtest corpus 2023–24 (cold start, warm-up) → 2025–26; served call (predictMatch + contextual model); rated events, 2-robot alliances; DECISIVE matches only (ties out of every metric). Δ = variant − live 3.3.0 on identical matches, 95% intervals from 2000 event bootstraps. Rolling origins: monthly Oct 2024–Jul 2026, each month's ρ chosen by Brier on the 365 days before it. Gate: Δ Brier interval below zero and neither accuracy nor margin-MAE interval entirely worse, on 2024–25 and 2025–26.",
    formula: { A, B: A / live.n0, priorNoiseRatioKnown: A - 1, headStart: "n0 · (1 − (1 + (A − 1)/ρ) / A)", class: "no history: RatingBook.priorZ(t).known === false (in the cold-start 2023–24, every robot)" },
    check,
  },
  moments, grid, rolled, apriori: judged(apriori), tuned: judged(tuned),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.error(`wrote ${OUT}`);

console.log(`check: champion Brier (ties 0.5) 2025 ${check.brierWithTies2025.toFixed(5)}; legacy ${check.legacyBrierWithTies2025.toFixed(5)} / ${(100 * check.legacyAccuracy2025).toFixed(2)}%`);
console.log("moments", JSON.stringify(moments));
console.log("\n| Variant | 2024–25 Brier | Δ×10⁴ [95%] | q1–10 Δ | 0–5 Δ | Δ acc pp | Δ margin MAE | 2025–26 Brier | Δ×10⁴ [95%] | q1–10 Δ | 0–5 Δ | Δ acc pp | Δ margin MAE |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const c of grid) {
  const cell = (k: string) => {
    const S = c.seasons[k], d = S.slices.all;
    if (!d) return `${S.summary.brier.toFixed(4)} | — | — | — | — | —`;
    return `${S.summary.brier.toFixed(4)} | ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)} | ${fmt.e4(S.slices["quals 1–10"]!.brier)} ${fmt.ci4(S.slices["quals 1–10"]!.brier95)} | ${fmt.e4(S.slices["0–5 rated matches"]!.brier)} ${fmt.ci4(S.slices["0–5 rated matches"]!.brier95)} | ${fmt.pp(d.accuracyPp)} | ${fmt.pp(d.marginMae, 3)}`;
  };
  console.log(`| ${c.label} | ${cell("2024")} | ${cell("2025")} |`);
}
console.log(`\nrolled: gate ${rolled.gate ? "PASS" : "fail"}; picks ${rolled.months.map((m) => `${m.month}:${m.pick}`).join(" ")}`);
for (const [k, S] of Object.entries(rolled.seasons)) for (const [name, d] of Object.entries(S.slices)) console.log(`  ${k} ${name}: n ${d.n} Δ ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)}  acc ${fmt.pp(d.accuracyPp)} ${fmt.cipp(d.accuracy95)}  mae ${fmt.pp(d.marginMae, 3)} ${fmt.cipp(d.marginMae95, 3)}`);
for (const [name, f] of [["apriori", out.apriori], ["tuned", out.tuned]] as const) console.log(`${name}: ${f.pick} gate ${f.gate ? "PASS" : "fail"} ` + Object.entries(f.seasons).map(([k, d]) => `${k} Δ ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)} acc ${fmt.pp(d.accuracyPp)} ${fmt.cipp(d.accuracy95)} mae ${fmt.pp(d.marginMae, 3)} ${fmt.cipp(d.marginMae95, 3)}`).join("; "));
