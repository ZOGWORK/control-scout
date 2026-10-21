// Partnership memory (engine 2.2): fit and judge the shrinkage on held-out seasons.
//
//   npx tsx scripts/partnership-fit.ts            fit + report (reads the local database)
//
// Walk-forward, exactly like the backtest ledger: before each match, the
// served engine's prediction from a rating book that has seen only earlier
// matches (2023 onward, the backtest's start), and pair features from a
// PartnershipBook that has seen every earlier match back to 2019–20. Only then
// are both books told the result.
//
// Protocol (fixed before looking at 2025–26):
//   fit β      on 2023–24 (CENTERSTAGE), for every (decay, k) on the grid;
//   select     (decay, k) by log loss on 2024–25 (INTO THE DEEP), β from 2023–24;
//   refit β    on 2023–24 + 2024–25 with the selected (decay, k);
//   held out   2025–26 (DECODE): log loss, Brier, accuracy vs the served engine,
//              with 95% intervals from an event-level bootstrap.
// Ship a numeric adjustment only if the held-out interval for Brier is below 0.
import "../server/env.js";
import { gzipSync } from "node:zlib";
import { FITTED_MODEL, PARTNERSHIP_PARAMS, PartnershipBook, RatingBook, partnershipFact, partnershipFeatures, predictMatch, type EventRecord, type MatchRecord, type PartnershipParams } from "@control-scout/predict-engine";
import { loadSeason, toEventRecord } from "../server/stats/load.js";

const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const FIRST_PREDICTED = 2023, FIT = [2023], SELECT = 2024, HELD_OUT = 2025;
const DECAYS = [0, 0.25, 0.5, 1];
const KS = [1, 2, 4, 8, 16, 32, 64];

interface Row { season: number; event: string; y: number; L: number; f: Map<string, [number, number]>; fact: boolean; factTogether: boolean }

const gzipSize = (x: unknown) => gzipSync(Buffer.from(JSON.stringify(x)), { level: 9 }).length;
const logit = (p: number) => Math.log(p / (1 - p));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.max(1e-6, Math.min(1 - 1e-6, p));

async function main() {
  const books = DECAYS.map((d) => new PartnershipBook(FITTED_MODEL.rating, { ...PARTNERSHIP_PARAMS, seasonDecay: d }));
  const book = new RatingBook(FITTED_MODEL.rating);
  const rows: Row[] = [];
  const teamsBy = new Map<number, Set<number>>();
  for (const s of SEASONS) {
    const events = (await loadSeason(s)).map((e) => ({ e, r: toEventRecord(e) })).filter((x): x is { e: typeof x.e; r: EventRecord } => !!x.r);
    for (const { e } of events) for (const b of books) b.nameEvent(s, e.code, e.name);
    const matches: MatchRecord[] = events.flatMap((x) => x.r.matches).sort((a, b) => a.time - b.time);
    teamsBy.set(s, new Set(matches.flatMap((m) => [...m.red.teams, ...m.blue.teams])));
    console.log(`${s}: ${events.length} rated events, ${matches.length} matches`);
    if (s >= FIRST_PREDICTED) book.startSeason(s);
    for (const m of matches) {
      if (s >= FIRST_PREDICTED && m.red.teams.length === 2 && m.blue.teams.length === 2 && m.red.total !== m.blue.total) {
        book.setTime(m.time);
        const p = predictMatch(book, m.red.teams, m.blue.teams, FITTED_MODEL.noise, FITTED_MODEL.calibration, { contextual: FITTED_MODEL.contextual, context: { level: m.level, event: m.eventCode } });
        const f = new Map<string, [number, number]>();
        DECAYS.forEach((d, i) => {
          for (const k of KS) {
            const x = partnershipFeatures(books[i], m.red.teams, m.blue.teams, s, { ...PARTNERSHIP_PARAMS, seasonDecay: d, k });
            f.set(`${d}|${k}`, [x.together, x.against]);
          }
        });
        const fact = partnershipFact(books[2], m.red.teams, m.blue.teams, s);
        rows.push({ season: s, event: m.eventCode, y: m.red.total > m.blue.total ? 1 : 0, L: logit(clamp(p.pRedWin)), f, fact: !!fact, factTogether: fact?.kind === "together" });
      }
      for (const b of books) b.observe(m);
      if (s >= FIRST_PREDICTED) book.update(m);
    }
    console.log(`  pair table: ${JSON.stringify(books[2].size)}`);
  }

  // Pack size of the shipped table (decay 0.5 book, pruned as served).
  const last = SEASONS.at(-1)!;
  const active = new Set([...(teamsBy.get(last) ?? []), ...(teamsBy.get(last - 1) ?? [])]);
  const all_ = books[2].toData();
  console.log(`Unfiltered table: ${all_.together.length} together, ${all_.against.length} against, ${(gzipSize(all_) / 1e6).toFixed(2)} MB gz`);
  const data = books[2].toData({ teams: active });
  const json = JSON.stringify(data);

  console.log(`\nShipped table through ${data.season}: ${data.together.length} together pairs, ${data.against.length} against pairs, ${data.events.length} events; ${(json.length / 1e6).toFixed(2)} MB raw, ${(gzipSync(Buffer.from(json), { level: 9 }).length / 1e6).toFixed(2)} MB gz`);

  /** Logistic fit of y ~ offset L + βT·fT + βA·fA (Newton, small ridge). */
  const fitBeta = (rs: Row[], key: string): [number, number] => {
    let b = [0, 0];
    for (let it = 0; it < 30; it++) {
      const g = [0, 0], H = [[1e-3, 0], [0, 1e-3]];
      for (const r of rs) {
        const x = r.f.get(key)!;
        const p = sig(r.L + b[0] * x[0] + b[1] * x[1]);
        const e = r.y - p, w = p * (1 - p);
        g[0] += e * x[0]; g[1] += e * x[1];
        H[0][0] += w * x[0] * x[0]; H[0][1] += w * x[0] * x[1]; H[1][1] += w * x[1] * x[1];
      }
      H[1][0] = H[0][1];
      const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
      const step = [(H[1][1] * g[0] - H[0][1] * g[1]) / det, (H[0][0] * g[1] - H[1][0] * g[0]) / det];
      b = [b[0] + step[0], b[1] + step[1]];
      if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-9) break;
    }
    return [b[0], b[1]];
  };
  const pOf = (r: Row, key: string, b: [number, number]) => { const x = r.f.get(key)!; return sig(r.L + b[0] * x[0] + b[1] * x[1]); };
  const ll = (rs: Row[], key: string, b: [number, number]) => -rs.reduce((s, r) => { const p = clamp(pOf(r, key, b)); return s + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rs.length;

  const fit = rows.filter((r) => FIT.includes(r.season)), sel = rows.filter((r) => r.season === SELECT), hold = rows.filter((r) => r.season === HELD_OUT);
  console.log(`\nRows: fit ${fit.length}, select ${sel.length}, held out ${hold.length}`);
  for (const [name, rs] of [["fit", fit], ["select", sel], ["held out", hold]] as const) {
    console.log(`  ${name}: a pair fact on ${(100 * rs.filter((r) => r.fact).length / rs.length).toFixed(1)}% of matches (together ${(100 * rs.filter((r) => r.factTogether).length / rs.length).toFixed(1)}%), pair-effect inputs non-zero on ${(100 * rs.filter((r) => { const x = r.f.get("0.5|8")!; return x[0] !== 0 || x[1] !== 0; }).length / rs.length).toFixed(1)}%`);
  }
  const base0: [number, number] = [0, 0];
  const anyKey = "0.5|8";
  console.log(`\nSelect block log loss, served engine alone: ${ll(sel, anyKey, base0).toFixed(5)}`);
  let best: { key: string; ll: number; b: [number, number] } | null = null;
  for (const d of DECAYS) for (const k of KS) {
    const key = `${d}|${k}`;
    const b = fitBeta(fit, key);
    const l = ll(sel, key, b);
    console.log(`  decay ${d}, k ${k}: βT ${b[0].toFixed(3)}, βA ${b[1].toFixed(3)} → select log loss ${l.toFixed(5)} (${(l - ll(sel, key, base0) >= 0 ? "+" : "")}${(l - ll(sel, key, base0)).toFixed(5)})`);
    if (!best || l < best.ll) best = { key, ll: l, b };
  }
  const [dSel, kSel] = best!.key.split("|").map(Number);
  const bFinal = fitBeta([...fit, ...sel], best!.key);
  console.log(`\nSelected decay ${dSel}, k ${kSel}; refit on 2023–24 + 2024–25: βT ${bFinal[0].toFixed(4)}, βA ${bFinal[1].toFixed(4)}`);

  // Held-out comparison with an event-level bootstrap.
  const metrics = (rs: Row[], b: [number, number]) => {
    let ll_ = 0, br = 0, acc = 0;
    for (const r of rs) { const p = clamp(pOf(r, best!.key, b)); ll_ -= r.y ? Math.log(p) : Math.log(1 - p); br += (p - r.y) ** 2; acc += (p > 0.5 ? 1 : 0) === r.y ? 1 : 0; }
    return { ll: ll_ / rs.length, brier: br / rs.length, acc: acc / rs.length };
  };
  const m0 = metrics(hold, base0), m1 = metrics(hold, bFinal);
  const byEvent = new Map<string, Row[]>();
  for (const r of hold) { const xs = byEvent.get(r.event) ?? []; xs.push(r); byEvent.set(r.event, xs); }
  const evs = [...byEvent.values()];
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const dB: number[] = [], dL: number[] = [], dA: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const sample: Row[] = [];
    for (let j = 0; j < evs.length; j++) sample.push(...evs[Math.floor(rand() * evs.length)]);
    const a = metrics(sample, base0), c = metrics(sample, bFinal);
    dB.push(c.brier - a.brier); dL.push(c.ll - a.ll); dA.push(c.acc - a.acc);
  }
  const ci = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `[${s[25].toExponential(2)}, ${s[974].toExponential(2)}]`; };
  console.log(`\nHeld out 2025–26 (${hold.length} non-tied 2v2 matches, ${evs.length} events):`);
  console.log(`  served engine: log loss ${m0.ll.toFixed(5)}, Brier ${m0.brier.toFixed(5)}, accuracy ${(100 * m0.acc).toFixed(2)}%`);
  console.log(`  + partnership: log loss ${m1.ll.toFixed(5)}, Brier ${m1.brier.toFixed(5)}, accuracy ${(100 * m1.acc).toFixed(2)}%`);
  console.log(`  Δ Brier ${(m1.brier - m0.brier).toExponential(2)} ${ci(dB)}, Δ log loss ${(m1.ll - m0.ll).toExponential(2)} ${ci(dL)}, Δ accuracy ${(100 * (m1.acc - m0.acc)).toFixed(3)} pp ${ci(dA.map((x) => 100 * x))}`);
  const affected = hold.filter((r) => { const x = r.f.get(best!.key)!; return x[0] !== 0 || x[1] !== 0; });
  if (affected.length) {
    const a0 = metrics(affected, base0), a1 = metrics(affected, bFinal);
    console.log(`  matches with any pair history (${affected.length}): Brier ${a0.brier.toFixed(5)} → ${a1.brier.toFixed(5)}, log loss ${a0.ll.toFixed(5)} → ${a1.ll.toFixed(5)}`);
  }
  const p: PartnershipParams = { ...PARTNERSHIP_PARAMS, seasonDecay: dSel, k: kSel, betaTogether: bFinal[0], betaAgainst: bFinal[1] };
  console.log(`\nCandidate params: ${JSON.stringify(p)}`);
}

await main();
