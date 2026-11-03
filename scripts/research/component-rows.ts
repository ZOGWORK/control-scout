// Research topics R3 + R5 (Nov 2026), shared input: the champion's per-phase expectations for every predicted
// match, next to the actual per-phase scores and the lineups. It replays the corpus exactly as
// scripts/engine-slices.ts does (same loader, exclusions, order, rating settings, region and event hints), so its
// rows join the slices harness's `--rows --features` file by match key.
//
//   DATABASE_URL=file:<copy-of-snapshot.db> npx tsx scripts/research/component-rows.ts --seasons 2023,2024,2025 --out <components.json.gz>
//
// Per predicted match (2-robot alliances, scrimmages included and flagged unrated):
//   exp.{red,blue}.{auto,teleop,endgame,pen}  the alliance's expected phase points before the match (pen = fouls it
//                                             is expected to commit, i.e. points it gives the other side), overlap
//                                             already taken off, exactly as predictMatch reads them
//   S                                         √(sd_red² + sd_blue²), the spread behind the raw Gaussian probability
//   x                                         the contextual model's inputs exactly as the served call read them
//   act.{red,blue}.{auto,teleop,endgame,pen,total}  what happened
// The raw probability is Φ(gap / S) with gap = Σ phases (red − blue) + (pen_blue − pen_red): the decomposition is exact.
// Always run it on a COPY of a database: it runs migrations. It writes nothing else to it.
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { FITTED_MODEL, RatingBook, contextualFeatures, predictMatch } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { matchKey, outcome, predictable, seasonCorpus } from "../slices/corpus.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SEASONS = (flag("--seasons") ?? "2023,2024,2025").split(",").map(Number).sort((a, b) => a - b);
const OUT = flag("--out");
if (!OUT) throw new Error("--out <file.json.gz> is required");

await migrate();
const M = FITTED_MODEL;
const book = new RatingBook({ ...M.rating });
const r1 = (x: number) => Math.round(x * 1000) / 1000;
const rows: unknown[] = [];
for (const s of SEASONS) {
  const { unrated, matches } = await seasonCorpus(s);
  book.startSeason(s);
  let n = 0;
  for (const m of matches) {
    if (predictable(m)) {
      book.setTime(m.time);
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const pc = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      // Read under the same region and event hints predictMatch uses (the contextual inputs include in-event form).
      const { exp, x } = book.withRegion(ctx.region, () => book.withEvent(ctx.event, () => ({
        exp: { red: book.allianceExpectation(m.red.teams, m.level), blue: book.allianceExpectation(m.blue.teams, m.level) },
        x: contextualFeatures(book, m.red.teams, m.blue.teams, { ...pc, pRedWin: pc.pRaw! }, ctx, M.contextual!.coefficients.length),
      })));
      const ph = (x: { auto: number; teleop: number; endgame: number; pen: number }) => ({ auto: r1(x.auto), teleop: r1(x.teleop), endgame: r1(x.endgame), pen: r1(x.pen) });
      const act = (a: typeof m.red) => ({ auto: a.auto, teleop: a.teleop, endgame: a.endgame, pen: a.penCommitted, total: a.total });
      rows.push({
        key: matchKey(s, m.eventCode, m.level, m.series, m.number), season: s, event: m.eventCode, level: m.level, time: m.time, y: outcome(m), rated: !unrated.has(m.eventCode),
        red: m.red.teams, blue: m.blue.teams, exp: { red: ph(exp.red), blue: ph(exp.blue) }, S: r1(Math.sqrt(pc.red.sd ** 2 + pc.blue.sd ** 2)),
        muR: r1(pc.red.mean), muB: r1(pc.blue.mean), pRaw: pc.pRaw, p: pc.pRedWin, model: pc.modelId ?? pc.model, x, act: { red: act(m.red), blue: act(m.blue) },
      });
      n++;
    }
    if (!unrated.has(m.eventCode)) book.update(m);
  }
  console.log(`${s}: ${matches.length} matches, ${n} predicted`);
}
writeFileSync(OUT, gzipSync(JSON.stringify(rows)));
console.log(`wrote ${rows.length} rows to ${OUT}`);
