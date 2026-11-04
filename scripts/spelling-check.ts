// Spelling correction on the real data (server/api/spelling.ts): every query in a file (one per line, or "12. query"
// lines) is searched with and without correction, and any whose answer changed, or that was offered a fix, is listed.
// A list of correctly spelled queries should list none. Then the misspellings it must fix, and what each reached.
//   npx tsx scripts/spelling-check.ts <queries.txt>
import { readFileSync } from "node:fs";
import { searchAnswer } from "../server/api/searchAnswer.js";
import { ensureSearchIndex } from "../server/api/search.js";
import { rebuildSearch } from "../server/stats/job.js";

const MISSPELLED = ["hypnotc robotics", "hipnotic robotics", "bad wolff", "enforcrs", "hypnotic oper", "4215 oper", "4215 recrod",
  "4215 awrds", "new jersey champinship", "qualifer new jersey", "new jersy", "oradel", "teams in oradel", "4215 wrolds", "bad wolf inspyre"];

await ensureSearchIndex(rebuildSearch);
const file = process.argv[2];
const qs = file ? [...new Set(readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*\d+\.\s+/, "").trim()).filter((l) => l && l.length <= 80))] : [];
let changed = 0, slowest = 0;
for (const q of qs) {
  const t = Date.now();
  const a = await searchAnswer(q, { learn: false, limit: 25 });
  slowest = Math.max(slowest, Date.now() - t);
  const b = await searchAnswer(q, { learn: false, limit: 25, spell: false });
  if (a.didYouMean !== b.didYouMean || a.step !== b.step) { changed++; console.log(`CHANGED ${JSON.stringify(q)}: ${b.step} → ${a.step}, did you mean ${JSON.stringify(a.didYouMean)}`); }
}
if (file) console.log(`${qs.length} queries, ${changed} changed by spelling; slowest ${slowest} ms`);
for (const q of MISSPELLED) {
  const a = await searchAnswer(q, { learn: false, limit: 25 });
  const top = a.stat?.title ?? a.card?.title ?? a.hits.slice(0, 3).map((h) => h.title).join(", ");
  console.log(`${q} → ${a.step} · did you mean ${JSON.stringify(a.didYouMean)} · ${a.understood?.label} · ${top}`);
}
process.exit(0);
