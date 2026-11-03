// Research R4, recency and decay: how fast should old matches stop counting? A rating that learns with gain g is
// a weighted mean of its past results; the weights are set by how much evidence the book thinks it holds (its gain
// experience W: gain = max(kMin, k0 / (1 + W / n0))). Discounting old evidence by a half-life is exponential
// forgetting of W (the discounted-least-squares / forgetting-factor Kalman recursion):
//   per match   W ← W·2^(−1/h) + 1                 (h in matches; kMin 0, so the decay alone sets the floor)
//   per week    W ← W·2^(−Δweeks/h) at each update  (h in weeks; with the live floor, or with kMin 0)
// Endpoints: "whole season" (no decay, kMin 0: every match this season counts the same, gain ~1/n) and "last event
// only" (W back to 0 at a team's first match of each new event). The live engine is W = n with the kMin floor,
// which at steady state is per-match forgetting with W* = n0·(k0/kMin − 1).
// Every variant is the live engine otherwise (event form 2.9, regional priors, carry-over, overlap, recalibration).
//
//   DATABASE_URL=file:.data/research/snap.db npx tsx scripts/research/r4-recency.ts [--out docs/engine/research-2026-11/r4-recency-2026-11-03.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ENGINE_VERSION, RatingBook, type MatchRecord } from "@control-scout/predict-engine";
import { kvGet } from "../../server/db.js";
import { LEGACY_RATING, LIVE, M, SLICES, WEEK, brierWithTies, fmt, gatePasses, paired, patchedBook, replay, rollingPick, summary, type GainPatch, type Row, type Variant } from "./lib.js";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/engine/research-2026-11/r4-recency-2026-11-03.json";
const live = M.rating as { k0: number; n0: number; kMin: number };

/** Per-team discounted evidence W, decayed by match count or by elapsed weeks, optionally reset at a new event. */
function decay(opts: { perMatch?: number; perWeek?: number; resetAtEvent?: boolean }): GainPatch {
  const W = new Map<number, { w: number; t: number; ev: string }>();
  const eff = (t: number, m: MatchRecord) => {
    const s = W.get(t);
    if (!s) return 0;
    if (opts.resetAtEvent && s.ev !== m.eventCode) return 0;
    return opts.perWeek ? s.w * 2 ** (-Math.max(0, m.time - s.t) / WEEK / opts.perWeek) : s.w;
  };
  return {
    gainN: (t, _r, m) => eff(t, m),
    after: (m) => {
      const lam = opts.perMatch ? 2 ** (-1 / opts.perMatch) : 1;
      for (const t of [...m.red.teams, ...m.blue.teams]) W.set(t, { w: eff(t, m) * lam + 1, t: m.time, ev: m.eventCode });
    },
    season: () => W.clear(),
  };
}

interface Spec { name: string; family: string; h: number | null; label: string; book: () => RatingBook; legacy?: boolean }
const PER_MATCH = [2, 3, 4, 5, 6.4, 8, 12, 20, 40];
const PER_WEEK = [0.5, 1, 2, 4, 8, 16];
const specs: Spec[] = [
  { name: "live", family: "live", h: null, label: "live 3.3.0 (W = n, floor kMin 0.33)", book: () => new RatingBook(LIVE) },
  ...PER_MATCH.map((h) => ({ name: `match-${h}`, family: "per-match", h, label: `per-match half-life ${h}, kMin 0`, book: () => patchedBook({ kMin: 0 }, decay({ perMatch: h })) })),
  { name: "season", family: "per-match", h: Infinity, label: "whole season (no decay, kMin 0)", book: () => patchedBook({ kMin: 0 }, decay({})) },
  ...PER_WEEK.map((h) => ({ name: `week-${h}`, family: "per-week+floor", h, label: `per-week half-life ${h}, live floor`, book: () => patchedBook({}, decay({ perWeek: h })) })),
  ...PER_WEEK.map((h) => ({ name: `week0-${h}`, family: "per-week", h, label: `per-week half-life ${h}, kMin 0`, book: () => patchedBook({ kMin: 0 }, decay({ perWeek: h })) })),
  { name: "last-event", family: "endpoint", h: 0, label: "last event only (W reset at each new event), live floor", book: () => patchedBook({}, decay({ resetAtEvent: true })) },
  { name: "last-event0", family: "endpoint", h: 0, label: "last event only (W reset at each new event), kMin 0", book: () => patchedBook({ kMin: 0 }, decay({ resetAtEvent: true })) },
  { name: "no-event-form", family: "context", h: null, label: "live without event-local form (eventLambda 0): what the form layer adds", book: () => new RatingBook({ ...LIVE, eventLambdaAuto: 0, eventLambdaTeleop: 0 }) },
  { name: "legacy", family: "context", h: null, label: "Engine 1.x (frozen; the published 72.7% / 0.179)", book: () => new RatingBook(LEGACY_RATING), legacy: true },
];
const variants: Variant[] = specs.map((s) => ({ name: s.name, book: s.book(), legacy: s.legacy }));
const t0 = Date.now();
const rows = await replay(variants);
console.error(`replayed ${variants.length} books in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const SEASONS: [string, number, string][] = [["2024", 2024, "2024–25 (tuning)"], ["2025", 2025, "2025–26 (reused)"]];
const bySeason = (s: number) => rows.filter((r) => r.season === s);
const idx = (name: string) => specs.findIndex((s) => s.name === name);

// Curve: every variant against live, per season and slice.
const curve = specs.map((s, i) => ({
  ...s, book: undefined, h: s.h === Infinity ? "inf" : s.h,
  seasons: Object.fromEntries(SEASONS.map(([k, season]) => {
    const R = bySeason(season);
    return [k, { summary: summary(R, i), slices: Object.fromEntries(SLICES.map(([name, keep]) => [name, i === 0 ? null : paired(R.filter(keep), 0, i)])) }];
  })),
}));

// Rolling origins: each month uses the family member with the best Brier over the 365 days before it.
const families: Record<string, number[]> = {
  "per-match (kMin 0)": [...PER_MATCH.map((h) => idx(`match-${h}`)), idx("season")],
  "per-week, live floor": [0, ...PER_WEEK.map((h) => idx(`week-${h}`))],
  "per-week (kMin 0)": [...PER_WEEK.map((h) => idx(`week0-${h}`)), idx("season")],
  "all recency variants + live": specs.map((s, i) => (s.family === "context" ? -1 : i)).filter((i) => i >= 0),
};
const rolled = Object.fromEntries(Object.entries(families).map(([fam, members]) => {
  const { pick, months } = rollingPick(rows, members);
  const keep = (r: Row) => pick.has(r.key);
  const pa = (r: Row): [number, number] => { const j = pick.get(r.key)!; return [r.p[j], r.mg[j]]; };
  const seasons = Object.fromEntries(SEASONS.map(([k, season]) => {
    const R = bySeason(season).filter(keep);
    const slices = Object.fromEntries(SLICES.map(([name, f]) => [name, paired(R.filter(f), 0, -1, pa)]));
    return [k, { slices, gate: gatePasses(slices.all) }];
  }));
  return [fam, { members: members.map((j) => specs[j].name), months: months.map((m) => ({ ...m, pick: specs[m.pick].name })), seasons, gate: Object.values(seasons).every((x) => x.gate) }];
}));

// Fixed pick: the best per-match half-life on the tuning season, judged on both.
const tuningBest = (members: number[]) => members.reduce((b, j) => (summary(bySeason(2024), j).brier < summary(bySeason(2024), b).brier ? j : b), members[0]);
const fixed = Object.fromEntries(Object.entries(families).map(([fam, members]) => {
  const j = tuningBest(members);
  const seasons = Object.fromEntries(SEASONS.map(([k, season]) => [k, paired(bySeason(season), 0, j)]));
  return [fam, { pick: specs[j].name, seasons, gate: Object.values(seasons).every(gatePasses) }];
}));

// Reproduction check: the champion here must be the slice report's 3.3.0 champion (ties as 0.5, all rated matches).
const check = { brierWithTies2025: brierWithTies(bySeason(2025), 0), legacyBrierWithTies2025: brierWithTies(bySeason(2025), idx("legacy")), legacyAccuracy2025: summary(bySeason(2025), idx("legacy")).accuracy };
const floorW = live.n0 * (live.k0 / live.kMin - 1);
const out = {
  meta: {
    generated: new Date().toISOString().slice(0, 10), engine: ENGINE_VERSION, dataVersion: await kvGet<string>("data:version"), script: "scripts/research/r4-recency.ts",
    protocol: "Walk-forward replay of the backtest corpus 2023–24 (cold start, warm-up) → 2025–26; served call (predictMatch + contextual model); rated events, 2-robot alliances; DECISIVE matches only (ties out of every metric). Δ = variant − live 3.3.0 on identical matches, 95% intervals from 2000 event bootstraps. Rolling origins: monthly Oct 2024–Jul 2026, each month's member chosen by Brier on the 365 days before it. Gate: Δ Brier interval below zero and neither accuracy nor margin-MAE interval entirely worse, on 2024–25 and 2025–26.",
    liveFloor: { kMin: live.kMin, steadyStateW: floorW, equivalentPerMatchHalfLife: Math.log(0.5) / Math.log(1 - 1 / floorW) },
    check,
  },
  curve, rolled, fixed,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.error(`wrote ${OUT}`);

// Console tables for the note.
console.log(`check: champion Brier (ties 0.5) 2025 ${check.brierWithTies2025.toFixed(5)}; legacy ${check.legacyBrierWithTies2025.toFixed(5)} / ${(100 * check.legacyAccuracy2025).toFixed(2)}%`);
console.log(`live floor: W* ${floorW.toFixed(2)}, per-match half-life ${out.meta.liveFloor.equivalentPerMatchHalfLife.toFixed(2)}`);
console.log("\n| Variant | 2024–25 Brier | Δ×10⁴ [95%] | q1–10 Δ | 0–5 Δ | Δ acc pp | Δ margin MAE | 2025–26 Brier | Δ×10⁴ [95%] | q1–10 Δ | 0–5 Δ | Δ acc pp | Δ margin MAE |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const c of curve) {
  const cell = (k: string) => {
    const S = c.seasons[k], d = S.slices.all;
    if (!d) return `${S.summary.brier.toFixed(4)} | — | — | — | — | —`;
    return `${S.summary.brier.toFixed(4)} | ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)} | ${fmt.e4(S.slices["quals 1–10"]!.brier)} | ${fmt.e4(S.slices["0–5 rated matches"]!.brier)} | ${fmt.pp(d.accuracyPp)} | ${fmt.pp(d.marginMae, 3)}`;
  };
  console.log(`| ${c.label} | ${cell("2024")} | ${cell("2025")} |`);
}
for (const [fam, r] of Object.entries(rolled)) {
  console.log(`\nrolled ${fam}: gate ${r.gate ? "PASS" : "fail"}; picks ${r.months.map((m) => `${m.month}:${m.pick}`).join(" ")}`);
  for (const [k, S] of Object.entries(r.seasons)) for (const [name, d] of Object.entries(S.slices)) console.log(`  ${k} ${name}: n ${d.n} Δ ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)}  acc ${fmt.pp(d.accuracyPp)} ${fmt.cipp(d.accuracy95)}  mae ${fmt.pp(d.marginMae, 3)} ${fmt.cipp(d.marginMae95, 3)}`);
}
for (const [fam, f] of Object.entries(fixed)) console.log(`fixed ${fam}: pick ${f.pick} gate ${f.gate ? "PASS" : "fail"} ` + Object.entries(f.seasons).map(([k, d]) => `${k} Δ ${fmt.e4(d.brier)} ${fmt.ci4(d.brier95)} acc ${fmt.pp(d.accuracyPp)} mae ${fmt.pp(d.marginMae, 3)}`).join("; "));
