// Engine program Part 8, step 2 (tuning): replay the corpus with prior settings
// overridden and score the live engine's win probability on the slices the
// priors drive. Tuning season 2024–25 (its priors come from 2023–24); 2025–26 is
// reported, labelled reused, and decides nothing.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part8/tune-priors.ts [--grid <name>] [--configs '<json array of rating overrides>'] [--out <file.json>]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, predictMatch, type RatingParams } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { homeRegions, outcome, predictable, seasonCorpus, type SeasonCorpus } from "../slices/corpus.js";

await migrate();
const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const M = FITTED_MODEL;
const SEASONS = [2023, 2024, 2025];
const corpora: SeasonCorpus[] = [];
for (const s of SEASONS) corpora.push(await seasonCorpus(s));

/** Prototype only (research): a regional prior offset layered on the book from outside. */
interface RegionProto { source: "home" | "event"; kappa: number; who: "noHistory" | "all"; freezeN: number; carryLast: number; atFirstMatch?: boolean }
type Override = Partial<RatingParams> & { _region?: RegionProto };
const home = await homeRegions();
const GRIDS: Record<string, Override[]> = {
  carry: [0.2, 0.35, 0.5, 0.65, 0.8, 1].map((e) => ({ carryEndgame: e })),
  carryAT: [0.85, 0.95, 1, 1.05, 1.15].flatMap((a) => [{ carryAuto: a, carryTeleop: a, carryEndgame: 0.5 }]),
  rookie: [-0.9, -0.7, -0.55, -0.4, -0.25].map((z) => ({ rookieZ: z, carryEndgame: 0.5 })),
  rho: [0.5, 0.6, 0.7, 0.8].flatMap((r) => [{ rho1: r, carryEndgame: 0.5 }]),
  unc: [[100, 250], [150, 350], [200, 450], [250, 600], [300, 800]].map(([k, r]) => ({ uncKnown: k, uncRookie: r, carryEndgame: 0.5 })),
};
const configs: Override[] = flag("--configs") ? JSON.parse(flag("--configs")!) : [{}, ...(GRIDS[flag("--grid") ?? "carry"] ?? [])];

interface Acc { n: number; b: number; ll: number; c: number; d: number }
const acc = (): Acc => ({ n: 0, b: 0, ll: 0, c: 0, d: 0 });
const add = (a: Acc, p: number, y: number) => {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  a.n++; a.b += (q - y) ** 2; a.ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  if (y !== 0.5) { a.d++; a.c += (p > 0.5) === (y === 1) ? 1 : 0; }
};
const fin = (a: Acc) => ({ n: a.n, brier: a.b / a.n, logLoss: a.ll / a.n, accuracy: a.c / a.d });

const results: unknown[] = [];
const perConfig: Map<string, { p: number; y: number; tags: string[] }>[] = [];
for (const o of configs) {
  const { _region: RP, ...ro } = o;
  const book = new RatingBook({ ...M.rating, ...ro });
  // Regional offset prototype: per region and phase, the shrunk mean lift (rating at its freezeN-th match
  // minus the prior it started from) of earlier teams of that kind this season, added to new priors.
  const PHS = ["auto", "teleop", "endgame"] as const;
  let lift = new Map<string, { s: Record<string, number>; n: number }>(), lastLift = new Map<string, Record<string, number>>();
  const started = new Map<number, { region: string; prior: Record<string, number>; frozen: boolean; known: boolean }>();
  const teamRegion = new Map<number, string>();
  const offsetFor = (region: string) => {
    const L = lift.get(region), last = lastLift.get(region);
    return Object.fromEntries(PHS.map((c) => [c, ((L?.s[c] ?? 0) + (RP!.carryLast && last ? RP!.carryLast * last[c] * RP!.kappa : 0)) / ((L?.n ?? 0) + RP!.kappa)]));
  };
  if (RP) {
    const B = book as any, orig = B.priorFor.bind(book);
    B.priorFor = (t: number) => {
      const r = orig(t), reg = teamRegion.get(t);
      if (!reg || (RP.who === "noHistory" && book.priorZ(t).known)) return r;
      const off = offsetFor(reg);
      for (const c of PHS) r[c] = Math.max(0, r[c] + off[c]);
      return r;
    };
  }
  const blocks: Record<string, Acc> = {};
  const per = new Map<string, { p: number; y: number; tags: string[] }>(); // key → call, for paired comparisons
  const t0 = Date.now();
  for (const c of corpora) {
    if (RP) {
      // Last season's final regional lifts seed this season (scaled by carryLast); then start fresh.
      lastLift = new Map([...lift].map(([k, v]) => [k, Object.fromEntries(PHS.map((c) => [c, v.s[c] / Math.max(1, v.n)]))]));
      lift = new Map(); started.clear(); teamRegion.clear();
    }
    book.startSeason(c.season);
    const firstEv = new Map<number, string>();
    for (const m of c.matches) {
      const rated = !c.unrated.has(m.eventCode);
      if (predictable(m) && rated && c.season >= 2024) {
        book.setTime(m.time);
        if (RP?.atFirstMatch) for (const t of [...m.red.teams, ...m.blue.teams]) if (!teamRegion.has(t)) { const r = RP.source === "home" ? home.get(t) : c.byCode.get(m.eventCode)?.region; if (r) teamRegion.set(t, r); }
        const teams = [...m.red.teams, ...m.blue.teams];
        const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: { level: m.level, event: m.eventCode } }).pRedWin;
        const y = outcome(m);
        const n = teams.map((t) => book.get(t).n);
        const firstHere = teams.some((t) => { const e = firstEv.get(t); return e == null || e === m.eventCode; });
        const noHist = teams.some((t) => !book.priorZ(t).known);
        const tags = ["all", firstHere ? "firstEvent" : null, n.reduce((a, b) => a + b, 0) < 24 ? "thin" : null, Math.min(...n) <= 5 ? "min0-5" : null, noHist ? "noHistoryOnField" : null, m.level === "qual" && m.number <= 10 ? "q1-10" : null];
        for (const tg of tags) if (tg) add((blocks[`${c.season}|${tg}`] ??= acc()), p, y);
        per.set(`${c.season}|${m.eventCode}|${m.level}|${m.series}|${m.number}`, { p, y, tags: tags.filter((t): t is string => !!t) });
      }
      if (predictable(m)) for (const t of [...m.red.teams, ...m.blue.teams]) if (!firstEv.has(t) && rated) firstEv.set(t, m.eventCode);
      if (RP && rated) for (const t of [...m.red.teams, ...m.blue.teams]) {
        if (!teamRegion.has(t)) { const r = RP.source === "home" ? home.get(t) : c.byCode.get(m.eventCode)?.region; if (r) teamRegion.set(t, r); }
        if (!started.has(t) && teamRegion.has(t)) { const g = book.get(t), known = book.priorZ(t).known; started.set(t, { region: teamRegion.get(t)!, prior: { auto: g.auto, teleop: g.teleop, endgame: g.endgame }, frozen: false, known }); }
      }
      if (rated) book.update(m);
      if (RP && rated) for (const t of [...m.red.teams, ...m.blue.teams]) {
        const st = started.get(t);
        if (!st || st.frozen || (RP.who === "noHistory" && st.known)) continue;
        const r = book.get(t);
        if (r.n < RP.freezeN) continue;
        st.frozen = true;
        const L = lift.get(st.region) ?? { s: { auto: 0, teleop: 0, endgame: 0 }, n: 0 };
        for (const c of PHS) L.s[c] += r[c] - st.prior[c];
        L.n++; lift.set(st.region, L);
      }
    }
  }
  perConfig.push(per);
  const r = { override: o, seconds: (Date.now() - t0) / 1000, blocks: Object.fromEntries(Object.entries(blocks).sort().map(([k, a]) => [k, fin(a)])) };
  results.push(r);
  const b = r.blocks as Record<string, { brier: number }>;
  console.log(JSON.stringify(o).padEnd(70), ["2024|all", "2024|firstEvent", "2024|thin", "2024|noHistoryOnField", "2025|all", "2025|firstEvent", "2025|thin"].map((k) => `${k.replace("|", ":")} ${b[k]?.brier.toFixed(5)}`).join("  "));
}
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(results, null, 1));

// Paired comparison of every config against the first: Brier change with a 95% event-bootstrap interval.
if (args.includes("--paired")) {
  let seed = 20261022;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const base = perConfig[0];
  for (let i = 1; i < perConfig.length; i++) {
    for (const block of ["2024|all", "2024|firstEvent", "2024|thin", "2025|all", "2025|firstEvent", "2025|thin"]) {
      const [season, tag] = block.split("|");
      const ev = new Map<string, { d: number; n: number; acc: number; dec: number }>();
      for (const [k, b] of base) {
        if (!k.startsWith(season + "|") || !b.tags.includes(tag)) continue;
        const c = perConfig[i].get(k)!; const e = k.split("|")[1];
        const x = ev.get(e) ?? { d: 0, n: 0, acc: 0, dec: 0 };
        x.d += (c.p - c.y) ** 2 - (b.p - b.y) ** 2; x.n++;
        if (b.y !== 0.5) { x.dec++; x.acc += ((c.p > 0.5) === (c.y === 1) ? 1 : 0) - ((b.p > 0.5) === (b.y === 1) ? 1 : 0); }
        ev.set(e, x);
      }
      const E = [...ev.values()], tot = E.reduce((a, x) => a + x.d, 0) / E.reduce((a, x) => a + x.n, 0);
      const acc = E.reduce((a, x) => a + x.acc, 0) / E.reduce((a, x) => a + x.dec, 0);
      const draws: number[] = [];
      for (let k = 0; k < 2000; k++) { let d = 0, n = 0; for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rnd() * E.length)]; d += x.d; n += x.n; } draws.push(d / n); }
      draws.sort((a, b) => a - b);
      console.log(`#${i} ${block.padEnd(16)} dBrier ${tot.toFixed(5)} [${draws[49].toFixed(5)}, ${draws[1949].toFixed(5)}]  dAcc ${(100 * acc).toFixed(2)}pp`);
    }
  }
}
