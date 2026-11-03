// Research R6/R7 helper: the actual alliance scores of every match the slice replay predicts, keyed exactly as
// engine-slices rows are (season|event|level|series|number), so margin MAE can be scored from --rows dumps.
//
//   DATABASE_URL=file:<copy-of-snapshot.db> npx tsx scripts/research/r67-scores.ts <out.json.gz> [--seasons 2023,2024,2025]
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { matchKey, predictable, seasonCorpus } from "../slices/corpus.js";

const args = process.argv.slice(2);
const i = args.indexOf("--seasons");
const seasons = i >= 0 ? args[i + 1].split(",").map(Number) : [2023, 2024, 2025];
const out: Record<string, [number, number]> = {};
for (const s of seasons) {
  const { matches } = await seasonCorpus(s);
  for (const m of matches) if (predictable(m)) out[matchKey(s, m.eventCode, m.level, m.series, m.number)] = [m.red.total, m.blue.total];
  console.log(`${s}: ${Object.keys(out).length} keys so far`);
}
writeFileSync(args[0], gzipSync(JSON.stringify(out)));
