// The Discord bot's question eval: the phrasings people actually use, asked of the same `searchAnswer` the bot calls
// (bot/ask.ts), so a search or prompt change can be judged against them instead of by impression.
//
//   npm run bot:eval                 restores the shipped snapshot into a temp folder and runs
//   DATABASE_URL=file:.data/scout.db npm run bot:eval
//
// The bank is bot/evals/answers.json, one {question, expect} per line. `expect` is what the question is:
//   records   a Control Scout records question — a sorry answer is a failure
//   working   a mechanism, maths or rules question — the bot answers it without a team card
//   product   about Control Scout itself
//   smalltalk a greeting, thanks, or who the bot is
//   question  a real records question whose subject isn't known from the words alone (a follow-up)
// It prints each answer's step and what it returned, and exits non-zero if a records question gets a sorry. The other
// kinds are reported, not gated: "working" is answered by the model when it is on, not by search alone.
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  const dir = join(tmpdir(), "control-scout-bot-eval");
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "scout.db").replace(/\\/g, "/")}`;
}
const { restoreSnapshotIfEmpty } = await import("../server/data/snapshot.js");
console.log(`data: ${await restoreSnapshotIfEmpty()}`);
const { migrate } = await import("../server/db.js");
await migrate();
const { ensureSearchIndex } = await import("../server/api/search.js");
const { rebuildSearch } = await import("../server/stats/job.js");
await ensureSearchIndex(rebuildSearch);
const { searchAnswer } = await import("../server/api/searchAnswer.js");

interface Case { question: string; expect: "records" | "working" | "product" | "smalltalk" | "question";
  /** A records phrasing search doesn't answer yet: reported, but not a regression (the bank's starting baseline). */
  known?: true }
const bank = JSON.parse(readFileSync(join(process.cwd(), "bot", "evals", "answers.json"), "utf8")) as Case[];
const results: { c: Case; step: string; sorry: boolean; what: string; ms: number }[] = [];
for (const c of bank) {
  const t = performance.now();
  const a = await searchAnswer(c.question, { learn: false, limit: 8, full: true });
  const what = a.stat?.title ?? a.card?.title ?? a.hits[0]?.title ?? a.understood?.label ?? a.sorry?.understood?.[0] ?? "(nothing)";
  results.push({ c, step: a.step, sorry: !!a.sorry, what, ms: Math.round(performance.now() - t) });
}
const bad = results.filter((r) => r.c.expect === "records" && (r.sorry || r.step === "no-match"));
const regressions = bad.filter((r) => !r.c.known), known = bad.filter((r) => r.c.known);
for (const r of results) {
  const mark = r.c.expect !== "records" ? "    " : r.sorry ? (r.c.known ? "known" : "FAIL") : "ok";
  console.log(`${mark} ${r.step.padEnd(14)} ${String(r.ms).padStart(5)} ms  ${r.c.question}  →  ${r.what}`);
}
const timed = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\n${results.length} questions · ${regressions.length} new records failures · ${known.length} known gaps · median ${timed[Math.floor(timed.length / 2)]} ms`);
if (known.length) console.log(`\nKnown gaps (in the bank on purpose; fix them, then drop `+"`known`"+`):\n${known.map((r) => `  - ${r.c.question}`).join("\n")}`);
if (regressions.length) {
  console.log(`\nRecords questions that got a sorry:\n${regressions.map((r) => `  - ${r.c.question}`).join("\n")}`);
  process.exit(1);
}
