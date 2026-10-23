// Engine program Part 3, step 2 (tuning): replay the corpus with event-local form settings overridden
// and compare each config with the first on identical matches (paired, event-bootstrap 95% intervals),
// overall and on the event-phase slices it aims at. Tuning season 2024–25; 2025–26 is reused.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part3/tune-event.ts --configs '[{}, {"eventLambdaAuto":0.5,...}]'
import "../../server/env.js";
import { FITTED_MODEL, RatingBook, predictMatch, type RatingParams } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { outcome, predictable, seasonCorpus, type SeasonCorpus } from "../slices/corpus.js";
import { pairedMetrics, type PairedRow } from "../slices/report.js";

await migrate();
const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const M = FITTED_MODEL;
const configs: Partial<RatingParams>[] = JSON.parse(flag("--configs") ?? "[{}]");
const corpora: SeasonCorpus[] = [];
for (const s of [2023, 2024, 2025]) corpora.push(await seasonCorpus(s));

interface Call { event: string; season: number; y: number; p: number; tags: string[]; mu: [number, number]; act: [number, number] }
const runs: Call[][] = [];
for (const o of configs) {
  const book = new RatingBook({ ...M.rating, ...o });
  const calls: Call[] = [];
  for (const c of corpora) {
    book.startSeason(c.season);
    const seen = new Map<number, string[]>(), atEvent = new Map<string, number>();
    for (const m of c.matches) {
      const rated = !c.unrated.has(m.eventCode);
      if (predictable(m) && rated && c.season >= 2024) {
        book.setTime(m.time);
        const teams = [...m.red.teams, ...m.blue.teams];
        const pm = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) } });
        const p = pm.pRedWin;
        const ordinal = Math.min(...teams.map((t) => { const e = seen.get(t) ?? []; const i = e.indexOf(m.eventCode); return i >= 0 ? i + 1 : e.length + 1; }));
        const kHere = Math.min(...teams.map((t) => atEvent.get(`${t}|${m.eventCode}`) ?? 0));
        const tags = ["all", m.level === "playoff" ? "playoff" : m.number <= 10 ? "q1-10" : m.number <= 25 ? "q11-25" : "q26+", ordinal === 1 ? "1st event" : "later event", kHere === 0 ? "k=0" : kHere <= 3 ? "k=1-3" : "k=4+"];
        calls.push({ event: m.eventCode, season: c.season, y: outcome(m), p, tags, mu: [pm.red.mean, pm.blue.mean], act: [m.red.total, m.blue.total] });
      }
      if (rated) {
        for (const t of [...m.red.teams, ...m.blue.teams]) {
          const e = seen.get(t) ?? []; if (!e.includes(m.eventCode)) { e.push(m.eventCode); seen.set(t, e); }
          atEvent.set(`${t}|${m.eventCode}`, (atEvent.get(`${t}|${m.eventCode}`) ?? 0) + 1);
        }
        book.update(m);
      }
    }
  }
  runs.push(calls);
  console.log("ran", JSON.stringify(o));
}
const TAGS = ["all", "q1-10", "q11-25", "q26+", "playoff", "1st event", "later event", "k=0", "k=1-3", "k=4+"];
for (let i = 1; i < runs.length; i++) {
  console.log(`#${i} ${JSON.stringify(configs[i])}`);
  for (const season of [2024, 2025]) {
    const line: string[] = [];
    for (const tag of TAGS) {
      const pr: PairedRow[] = [];
      runs[0].forEach((a, j) => { if (a.season === season && a.tags.includes(tag)) pr.push({ event: a.event, y: a.y, a: a.p, b: runs[i][j].p, tags: {} }); });
      if (!pr.length) continue;
      const m = pairedMetrics(pr, 1000);
      line.push(`${tag} ${(1e4 * m.brier).toFixed(2)}[${(1e4 * m.brier95[0]).toFixed(1)},${(1e4 * m.brier95[1]).toFixed(1)}]${m.regression ? "!" : ""}`);
    }
    console.log(`  ${season}: ${line.join("  ")}`);
    // Expected-score MAE (both alliances), against the first config.
    const sel = runs[0].map((a, j) => j).filter((j) => runs[0][j].season === season);
    const mae = (r: Call[]) => sel.reduce((a, j) => a + Math.abs(r[j].mu[0] - r[j].act[0]) + Math.abs(r[j].mu[1] - r[j].act[1]), 0) / (2 * sel.length);
    console.log(`  ${season}: score MAE ${mae(runs[0]).toFixed(3)} -> ${mae(runs[i]).toFixed(3)}`);
  }
}
