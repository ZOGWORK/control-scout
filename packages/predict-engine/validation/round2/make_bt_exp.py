"""Derive the experimental event backtest from Control Point's backtest-events.mts (untracked copy).
usage: python make_bt_exp.py <src backtest-events.mts> <dst _bt-exp.mts> <dist-exp dir (file URL base)>"""
import sys
src, dst, dist = sys.argv[1:4]
s = open(src, encoding='utf-8').read().replace('\r\n', '\n')
def rep(o, n):
    global s
    assert o in s, o[:80]
    s = s.replace(o, n, 1)
D = 'file:///' + dist.replace('\\', '/').lstrip('/')
rep('import { RatingBook, npOf } from "../../server/predict/rating.ts";',
    f'import {{ RatingBook, npOf, predictMatch, FITTED_MODEL, phi }} from "{D}/index.js";')
rep('import { simulateEvent, pickWeights, DEFAULT_PICK, type BonusModel, type PickModel, type QualMatch } from "../../server/predict/sim.ts";',
    f'import {{ simulateEvent, pickWeights, DEFAULT_PICK }} from "{D}/sim.js";\ntype BonusModel = any; type PickModel = any; type QualMatch = any;')
# Snapshots also keep each team's reliability state and the book clock.
rep('const snap = (code: string) => new Map(teamsOf.get(code)!.map((t) => [t, { ...book.get(t) }]));',
    'const snap = (code: string) => { const m = new Map(teamsOf.get(code)!.map((t) => [t, { ...book.get(t) }])); relSnaps.set(m, { now: book.now, rel: new Map(teamsOf.get(code)!.map((t) => [t, book.reliabilityOf(t)])) }); return m; };')
rep('const bonusSamples: { np: number; m: boolean; g: boolean; p: boolean }[] = [];',
    '''const bonusSamples: { np: number; m: boolean; g: boolean; p: boolean }[] = [];
const relSnaps = new Map<any, { now: number; rel: Map<number, any> }>();
const VARIANT = { shift: process.argv.includes("--shift"), bonusOnline: process.argv.includes("--bonus-online") };
const seasonAlliances: { time: number; np: number; k: number }[] = [];
/** A read-only book over a snapshot (ratings + reliability as of the snapshot time). */
function snapBook(ratings: Map<number, any>) {
  const meta = relSnaps.get(ratings)!;
  const prior = { auto: 0, teleop: 0, endgame: 0, pen: 0, n: 0, uncertainty: 400, asOf: meta.now };
  const get = (t: number) => ratings.get(t) ?? prior;
  return {
    now: meta.now, reliabilityReady: true,
    get, reliabilityOf: (t: number) => meta.rel.get(t) ?? { bias: 0, variance: 1, failure: 0.05 },
    allianceExpectation(teams: number[]) {
      const o: any = { auto: 0, teleop: 0, endgame: 0, pen: 0, np: 0, uncertainty: 0 };
      for (const t of teams) { const r = get(t); o.auto += r.auto; o.teleop += r.teleop; o.endgame += r.endgame; o.pen += r.pen; o.uncertainty += r.uncertainty; }
      o.np = o.auto + o.teleop + o.endgame; return o;
    },
  } as any;
}
const PHI_INV = (p: number) => { let lo = -10, hi = 10; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (phi(mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; };
const logit = (p: number) => Math.log(p / (1 - p));
/** Score-gap shift that applies the contextual model's log-odds correction to the simulator's own
 *  per-match win probability (its horizon and uncertainty), keeping scores and winners coherent. */
function shiftFor(ratingsForCtx: Map<number, any>, simRatings: Map<number, any>) {
  const fb = snapBook(ratingsForCtx); const memo = new Map<string, number>();
  return (red: number[], blue: number[], level: "qual" | "playoff") => {
    const key = `${red.join(",")}|${blue.join(",")}|${level}`;
    const hit = memo.get(key); if (hit !== undefined) return hit;
    const pr = predictMatch(fb, red, blue, FITTED_MODEL.noise, FITTED_MODEL.calibration, { contextual: FITTED_MODEL.contextual, context: { level } });
    let d = 0;
    if (pr.model === "contextual" && pr.pRaw! > 1e-6 && pr.pRaw! < 1 - 1e-6) {
      const corr = logit(Math.min(1 - 1e-9, Math.max(1e-9, pr.pRedWin))) - logit(pr.pRaw!);
      const side = (ts: number[], opp: number[]) => {
        let mean = 0, unc = 0, pen = 0;
        for (const t of ts) { const r = simRatings.get(t) ?? { auto: 0, teleop: 0, endgame: 0, pen: 0, uncertainty: 400 }; mean += r.auto + r.teleop + r.endgame; unc += r.uncertainty; }
        for (const t of opp) pen += (simRatings.get(t) ?? { pen: 0 }).pen;
        const g = noise.a + noise.b * Math.max(0, mean + pen); return { mean: mean + pen, v: g * g + unc };
      };
      const R = side(red, blue), Bq = side(blue, red);
      const sig = Math.sqrt(R.v + Bq.v), delta = R.mean - Bq.mean;
      const pSim = Math.min(1 - 1e-9, Math.max(1e-9, phi(delta / sig)));
      const target = 1 / (1 + Math.exp(-(logit(pSim) + corr)));
      d = (sig * PHI_INV(target) - delta) / 2;
    }
    memo.set(key, d); return d;
  };
}
/** Causal joint bonus-pattern model: 8-way softmax on NP/100, fitted on earlier results. */
function fitJoint(rows: { np: number; k: number }[]): number[][] | null {
  if (rows.length < 500) return null;
  let W = Array.from({ length: 8 }, () => [0, 0]);
  const loss = (W: number[][]) => { let l = 0; for (const r of rows) { const x = r.np / 100; const sc = W.map((w) => w[0] + w[1] * x); const mx = Math.max(...sc); const lse = mx + Math.log(sc.reduce((a, v) => a + Math.exp(v - mx), 0)); l += lse - sc[r.k]; } let reg = 0; for (const w of W) reg += w[0] * w[0] + w[1] * w[1]; return l / rows.length + 1e-3 * 0.5 * reg; };
  let lr = 1, cur = loss(W);
  for (let it = 0; it < 400; it++) {
    const G = W.map(() => [0, 0]);
    for (const r of rows) { const x = r.np / 100; const sc = W.map((w) => w[0] + w[1] * x); const mx = Math.max(...sc); const e = sc.map((v) => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0); for (let c = 0; c < 8; c++) { const g = e[c] / s - (c === r.k ? 1 : 0); G[c][0] += g; G[c][1] += g * x; } }
    for (let c = 0; c < 8; c++) { G[c][0] = G[c][0] / rows.length + 1e-3 * W[c][0]; G[c][1] = G[c][1] / rows.length + 1e-3 * W[c][1]; }
    let ok = false;
    for (let tries = 0; tries < 30; tries++) { const N = W.map((w, c) => [w[0] - lr * G[c][0], w[1] - lr * G[c][1]]); const nl = loss(N); if (nl < cur) { W = N; cur = nl; lr *= 1.5; ok = true; break; } lr /= 2; }
    if (!ok) break;
  }
  return W;
}''')
# Collect the season's qualification alliance results with their times (for the causal bonus fit).
rep('    if (s === season && s >= 2025 && m.time <= cutoff && m.level === "qual") {',
    '''    if (s === season && s >= 2025 && m.level === "qual") for (const al of [m.red, m.blue]) if (al.bonusRp) seasonAlliances.push({ time: m.time, np: al.np, k: (al.bonusRp.movement ? 4 : 0) + (al.bonusRp.goal ? 2 : 0) + (al.bonusRp.pattern ? 1 : 0) });
    if (s === season && s >= 2025 && m.time <= cutoff && m.level === "qual") {''')
# Per-event variant inputs.
rep('  const common = { season, noise, bonus, pick, awards: awardsInput, prequalified: o.prequalified, ineligible: o.ineligible, slots: o.slots, runs, seed: 7 };',
    '''  let bonusJoint: number[][] | null = null;
  if (VARIANT.bonusOnline && season >= 2025) {
    const wk = Math.floor(e.startTime / (7 * 864e5));
    bonusJoint = jointCache.get(wk) ?? fitJoint(seasonAlliances.filter((x) => x.time < e.startTime));
    jointCache.set(wk, bonusJoint);
  }
  const common: any = { season, noise, bonus, pick, awards: awardsInput, prequalified: o.prequalified, ineligible: o.ineligible, slots: o.slots, runs, seed: 7, ...(bonusJoint ? { bonusJoint } : {}) };''')
rep('const awardsByTeam = indexAwards(awardRecords);', 'const awardsByTeam = indexAwards(awardRecords);\nconst jointCache = new Map<number, number[][] | null>();')
rep('''    ["pre", { ...common, ratings: new Map([...snapPre.get(e.code)!].map(([t, r]) => [t, { ...r, uncertainty: r.uncertainty + (preExtra ?? 0) }])), quals }],
    ["quals", { ...common, ratings: snapQuals.get(e.code)!, quals: playedQuals, ranks: e.ranks }],
    ["selected", { ...common, ratings: snapQuals.get(e.code)!, quals: playedQuals, ranks: e.ranks, alliances: o.alliances.length ? o.alliances : undefined }],''',
    '''    ["pre", (() => { const sr = new Map([...snapPre.get(e.code)!].map(([t, r]) => [t, { ...r, uncertainty: r.uncertainty + (preExtra ?? 0) }])); return { ...common, ratings: sr, quals, ...(VARIANT.shift ? { matchShift: shiftFor(snapPre.get(e.code)!, sr) } : {}) }; })()],
    ["quals", { ...common, ratings: snapQuals.get(e.code)!, quals: playedQuals, ranks: e.ranks, ...(VARIANT.shift ? { matchShift: shiftFor(snapQuals.get(e.code)!, snapQuals.get(e.code)!) } : {}) }],
    ["selected", { ...common, ratings: snapQuals.get(e.code)!, quals: playedQuals, ranks: e.ranks, alliances: o.alliances.length ? o.alliances : undefined, ...(VARIANT.shift ? { matchShift: shiftFor(snapQuals.get(e.code)!, snapQuals.get(e.code)!) } : {}) }],''')
rep('  season, runs, awardMode, events: simulated, pick, bonus,', '  season, runs, awardMode, events: simulated, pick, bonus, variant: VARIANT,')
open(dst, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
