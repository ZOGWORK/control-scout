// Research brief item 11 (offline MLP baseline, comparison only): export the match list the MLP
// baseline trains and scores on. Same corpus and order as engine-slices (scripts/slices/corpus.ts):
// every 2-robot match with both alliances' phase scores, plus each robot's PRE-MATCH engine
// ratings (auto / TeleOp / endgame / penalties given away, matches folded in) read from a champion
// RatingBook replayed exactly as engine-slices replays it (same settings, same order, rated events
// only update it). Nothing here predicts; scripts/research/mlp_baseline.py does the rest.
//
//   DATABASE_URL=file:<copy-of-snapshot.db> npx tsx scripts/research/mlp-export.ts [--seasons 2023,2024,2025] --out <matches.json.gz>
//
// Always run it on a COPY of a database: it runs migrations.
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { matchKey, predictable, seasonCorpus } from "../slices/corpus.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SEASONS = (flag("--seasons") ?? "2023,2024,2025").split(",").map(Number).sort((a, b) => a - b);
const OUT = flag("--out");
if (!OUT) throw new Error("--out <file.json.gz> is required");

await migrate();
const book = new RatingBook({ ...FITTED_MODEL.rating });
/** One row per predictable match: [key, season, event, level, time, rated, red teams, blue teams, red phases, blue phases, pre-match ratings]. */
const rows: unknown[] = [];
for (const s of SEASONS) {
  const { unrated, matches } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    if (predictable(m)) {
      book.setTime(m.time);
      // Read as predictMatch reads them: under the event's region AND the event (its within-event form).
      const ratings = book.withRegion(m.region, () => book.withEvent(m.eventCode, () => [...m.red.teams, ...m.blue.teams].map((t) => {
        const r = book.get(t);
        return [r.auto, r.teleop, r.endgame, r.pen, r.n].map((x) => +x.toFixed(4));
      })));
      const ph = (a: typeof m.red) => [a.auto, a.teleop, a.endgame, a.penCommitted, a.total];
      rows.push([matchKey(s, m.eventCode, m.level, m.series, m.number), s, m.eventCode, m.level, m.time, !unrated.has(m.eventCode), m.red.teams, m.blue.teams, ph(m.red), ph(m.blue), ratings]);
    }
    if (!unrated.has(m.eventCode)) book.update(m);
  }
  console.log(`${s}: ${matches.length} matches, ${rows.length} predictable so far`);
}
writeFileSync(OUT, gzipSync(JSON.stringify({ columns: ["key", "season", "event", "level", "time", "rated", "red", "blue", "redPhases", "bluePhases", "ratings"], phases: ["auto", "teleop", "endgame", "penCommitted", "total"], ratingFields: ["auto", "teleop", "endgame", "pen", "n"], rows })));
console.log(`wrote ${rows.length} rows to ${OUT}`);
