// The held-out sets (docs/search-pipeline.md, "Eval"): questions written by people, never used to build search, asked
// the way the box asks and sorted by what went wrong, as patterns, never one fix per question. Each answer is read for
//   - the question understood (an intent read, or a card answering it)
//   - every filter it typed (a place, a time) applied and stated on the card
//   - a card at all: a team card, a list of names or a fallback alone is a fail
// and the pass rate printed by pattern. A card is not yet a pass (audit M2, 24 Nov): the answer is also graded
//   - against the answer a person wrote for it, where there is one (`want`, the q260 set's): every checkable fact in
//     it that stays true, a record, a decimal or a short want's names (never a rank or a rating, which move), is in
//     the answer (./search-heldout-grade.ts);
//   - its headline number against the team page's own API (./search-signoff/crosscheck.ts), over a local server on
//     the same snapshot.
// A wrong fact is "wrong answer", a number unlike the team page's "numbers differ from the team page".
//
// The sets live in scripts/search-heldout.json ({ set, n, q, want?, train? }). A question that appears word for word
// in the repo's tests or code isn't held out: it is marked "train": true (the training set), and the guard test
// (./search-heldout.test.ts) fails when a held-out one gets in. --split marks them; one file, so one rename.
//
//   npm run search:heldout                    the shipped snapshot, every held-out set
//   npm run search:heldout -- --set q260 --out .data/heldout.jsonl
//   npm run search:heldout -- --only "closest"   the questions with these words only
//   npm run search:heldout -- --train         the training set instead
//   npm run search:heldout -- --min 80        exit 1 below an 80% pass rate (CI, .github/workflows/ci.yml)
//   npm run search:heldout -- --split         move held-out questions found in tests or code to the training set
//   npm run search:heldout -- --claims      rewrite the recorded overlap (./search-heldout.claims.json) to this run's
//   DATABASE_URL=file:.data/scout.db npm run search:heldout
//
// Two readers claiming one question (the search audit's C2): the pipeline reads it whole (query/execute.ts
// pipelineReads) and the keyword layer finds a catalog intent with a phrasing to hand on (searchLayers.ts extract's
// canonical). The questions both claim are recorded by set and number in ./search-heldout.claims.json; a whole run
// fails when one more is claimed twice, and when one recorded no longer is (take it off the list: it only goes down,
// as keyword intents the pipeline covers are retired).
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldoutSets, type HeldOut } from "./heldoutSets.js";
import { TEST_HEADER } from "../server/testTraffic.js";
import { bootSearch, localServer } from "./search-local.js";
import { gradeWant, wantSeason } from "./search-heldout-grade.js";
import { leaks } from "./search-heldout-leaks.js";
import { answerSeason, crosscheck } from "./search-signoff/crosscheck.js";
import { answerText, type Live } from "./search-signoff/grade.js";

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SET = flag("set"), OUT = flag("out"), ONLY = flag("only")?.toLowerCase(), MIN = flag("min"), JSON_OUT = flag("json");
const TRAIN = process.argv.includes("--train"), CLAIMS = process.argv.includes("--claims");
const CLAIMS_FILE = join(import.meta.dirname, "search-heldout.claims.json");
// The record is the whole held-out run's: a part of one (or the training set) would write a smaller list over it, and
// --split asks nothing, so it would drop --claims without a word.
const SPLIT = process.argv.includes("--split");
if (CLAIMS && (TRAIN || SET || ONLY || SPLIT)) { console.log("FAIL: --claims records a whole held-out run only (no --set, --only, --train or --split)"); process.exit(1); }
// A --min with no number after it would turn the floor off: refused instead.
if (process.argv.includes("--min") && !Number.isFinite(Number(MIN ?? NaN))) { console.log(`FAIL: --min needs a number (got ${MIN ?? "nothing"})`); process.exit(1); }
type Q = HeldOut;
const FILE = join(import.meta.dirname, "search-heldout.json");
// Every set, the shared file's and each scripts/heldout/<set>.json, checked whole before any database is touched.
const all = heldoutSets();

if (SPLIT) {
  // "train" lives in the shared file only: a set's own file (scripts/heldout/) is its questions alone, so one of those
  // found in tests or code is named, to reword the test, never left held out with no word said.
  const found = leaks(all.filter((x) => !x.train).map((x) => x.q));
  const shared = JSON.parse(readFileSync(FILE, "utf8")) as Q[];
  const out = shared.map((x) => (!x.train && found.has(x.q) ? { ...x, train: true } : x));
  // Written whole beside it, then renamed over it: the file is the old one or the new one, never half of either.
  // One that fails part way (disk full, a locked file) leaves no .tmp behind.
  try {
    writeFileSync(`${FILE}.tmp`, `[\n${out.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n]\n`);
    renameSync(`${FILE}.tmp`, FILE);
  } finally {
    rmSync(`${FILE}.tmp`, { force: true });
  }
  const trained = out.filter((x) => x.train).length;
  console.log(`moved ${out.filter((x, i) => x.train && !shared[i].train).length} to the training set (now ${trained}); held out: ${all.length - trained}`);
  const own = all.filter((x) => found.has(x.q) && !shared.some((y) => y.set === x.set && y.n === x.n));
  if (own.length) {
    console.log(`in a set's own file, so reword the test or code that has it:\n${own.map((x) => `  scripts/heldout/${x.set}.json #${x.n}: ${x.q}`).join("\n")}`);
    process.exit(1);
  }
  process.exit(0);
}
const sets = all.filter((x) => !!x.train === TRAIN).filter((x) => (!SET || x.set === SET) && (!ONLY || x.q.toLowerCase().includes(ONLY)));
// A set or a filter that matches nothing asks nothing: never a pass.
if (!sets.length) { console.error(`no ${TRAIN ? "training" : "held-out"} questions match${SET ? ` set ${SET}` : ""}${ONLY ? ` "${ONLY}"` : ""}`); process.exit(1); }

const { season, data } = await bootSearch();
console.log(`data: ${data}`);
const local = await localServer();
// The team-page check needs this server: one that doesn't answer would make every comparison "not compared", a pass.
if (!(await fetch(`${local.base}/api/health`, { headers: { [TEST_HEADER]: "1" }, signal: AbortSignal.timeout(30_000) }).then((x) => x.ok).catch(() => false))) { console.log("FAIL: the local server doesn't answer"); process.exit(1); }
const { fold } = await import("../server/api/query/names.js");
const { parseQuery } = await import("../server/api/query/parse.js");
const { parseContext } = await import("../server/api/query/context.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { pickedQuery } = await import("../server/api/searchPageAnswer.js");
const { seasonLabel } = await import("../src/shared/format.js");
const { LEXICON } = await import("../server/api/query/lexicon.js");
const { pipelineReads } = await import("../server/api/query/execute.js");
const { extract } = await import("../server/api/searchLayers.js");

const FILLER = new Set(LEXICON.filter((e) => e.syms.every((x) => x.k === "filler")).flatMap((e) => e.words));

type Row = Q & { ms: number; intent: string | null; filters: string[]; place: string | null; time: string | null; card: string; stated: boolean; pattern: string; unread: string[];
  graded: "correct" | "wrong" | "unchecked"; wrong: string; numbers: "same" | "differ" | "not compared";
  /** A team page the local server couldn't give, for this answer or its re-asked one: recorded whatever the verdict. */
  pageMissing: boolean;
  /** The pipeline and the keyword layer both claim it (see the header). */
  both: boolean };
const rows: Row[] = [];
/** crosscheck's note when the team page couldn't be fetched. */
const UNAVAILABLE = "team page unavailable";
for (const x of sets) {
  const t = performance.now();
  const a = await searchAnswer(x.q, { learn: false, limit: 12, full: true });
  const ms = performance.now() - t;
  const p = await parseQuery(x.q, await parseContext());
  const both = (await pipelineReads(x.q)) && !!(await extract(x.q)).canonical;
  const s = a.stat;
  const text = fold([s?.title, s?.heading, ...(s?.scope ?? []), s?.none, s?.headline?.label, s?.headline?.sub, a.card?.title, a.card?.none, a.card?.headline, a.understood?.label, a.understood?.fallback].filter(Boolean).join(" · "));
  const place = p.place?.name ?? null;
  const time = p.time ? p.time.label : null;
  const unread = p.leftover.filter((w) => !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
  // A place is stated by its name (or the region it's a part of, said so); a time by its words, its season or a
  // relaxation the card says.
  // A card saying the question isn't about FTC data (a.chat: "the weather in <city> today") shows no place's or time's
  // FTC data, so it names neither.
  const placeStated = !place || !!a.chat || text.includes(fold(place)) || /isnt a separate region/.test(text);
  // "This season" is the latest season (the current one, or the default when the current has no data yet) and "last
  // season" the one before the default: the card names that season. A season said is that season; a month said is
  // that month (its first three letters) and that year in full.
  const relative = p.time?.relative === "this" ? [CURRENT_SEASON, season] : p.time?.relative === "last" ? [season - 1] : [];
  const timeStated = !p.time || !!a.chat || /relaxed|no .* yet|showing \d{4}/.test(text) || text.includes(fold(p.time.label))
    || relative.some((y) => text.includes(fold(seasonLabel(y))))
    // A bare year ("states in 2024") is either season it touches: the one it starts or the one it ends.
    || (p.time.kind === "season" && p.time.season != null
      && [p.time.season, ...(p.time.year != null ? [p.time.year - 1] : [])].some((y) => text.includes(fold(seasonLabel(y)))))
    || (p.time.kind === "ever" && /every season|all seasons|each season|ever/.test(text))
    || (p.time.kind === "window" && p.time.year != null && fold(p.time.label).split(" ").filter((w) => w && w !== "in")
      .every((w) => (/^\d+$/.test(w) ? ` ${text} `.includes(` ${w} `) : text.includes(w.slice(0, 3)))));
  // An events question's answer is the list of events, its place and time in the heading.
  const answered = !!s || !!a.card || (a.understood?.kind === "events" && !a.understood.fallback);
  // A word left unread counts against the pipeline's own answers (it read the query and must explain every word) and
  // against a reader's that says it left a word out; another reader's answer is judged by its card.
  const piped = !!a.intent?.understood?.some((u) => u.startsWith("Intent: "));
  // Words the answer read past (understood.unread; never in the label, so never in `text`).
  const leftOut = !!a.understood?.unread?.length;
  // A question search can't answer yet, said so with what was read: its own pattern, never a pass.
  const pattern = !answered ? (a.sorry ? "sorry shown" : a.understood?.fallback || a.step === "recovery" || a.step === "closest" ? "fallback only"
      : a.understood?.kind === "team" ? "team card only" : a.understood?.kind === "events" ? "event list only" : "names only")
    : /isnt answered|not answered/.test(text) ? "not answered"
    : !placeStated ? "place not stated"
    : !timeStated ? "time not stated"
    : leftOut || (piped && unread.length) ? "words not read"
    : "pass";
  const card = s ? `${s.title} = ${s.headline?.value ?? s.none ?? "–"}` : a.card ? `${a.card.title}${a.card.none ? ` = ${a.card.none}` : ""}` : `(${a.understood?.kind ?? "none"}) ${a.understood?.label ?? ""}`;
  // Graded once it reads as an answer: the facts a person wrote for it, and its number against the team page.
  const live = a as unknown as Live;
  const isAnswer = pattern === "pass";
  const graded = (r: Live) => gradeWant(x.want, `${answerText(r)} ${JSON.stringify({ stat: r.stat, card: r.card })}`, answerSeason(r));
  let want = isAnswer ? graded(live) : null;
  // About another season than the one the want was written for (the default moved on): asked again in that season,
  // as the page's season picker asks it (server/api/searchPageAnswer.ts pickedQuery), and that answer graded.
  // Its number is checked against the team page too, as the first answer's is. The first answer's check still stands:
  // it is the one a visitor gets, so a number on it unlike the team page's fails the question whatever the re-ask
  // says. The re-ask stands in only for the written-answer grade.
  let check = isAnswer ? await crosscheck(local.base, live) : { compared: false, ok: true, note: "" };
  let pageMissing = check.note === UNAVAILABLE;
  if (want && x.want && /answer is about/.test(want.note ?? "")) {
    const again = (await searchAnswer(await pickedQuery(x.q, wantSeason(x.want)), { learn: false, limit: 12, full: true })) as unknown as Live;
    want = graded(again);
    const second = await crosscheck(local.base, again);
    if (second.note === UNAVAILABLE) pageMissing = true;
    if (!second.ok || (second.compared && check.ok && !check.compared)) check = second;
  }
  const verdict = want?.verdict === "wrong" ? "wrong answer" : !check.ok ? "numbers differ from the team page" : pattern;
  if (ONLY) console.log(JSON.stringify({ q: x.q, time: p.time, text, placeStated, timeStated, want }));
  rows.push({ ...x, ms: Math.round(ms), intent: p.intent ?? s?.intent ?? null, filters: [...(s?.scope ?? [])], place, time, card, stated: placeStated && timeStated, pattern: verdict, unread,
    graded: want?.verdict ?? "unchecked", wrong: want?.verdict === "wrong" ? `missing ${want.missing.join(", ")}` : check.note,
    numbers: check.compared ? (check.ok ? "same" : "differ") : "not compared", pageMissing, both });
}

if (OUT) writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const by = new Map<string, Row[]>();
for (const r of rows) (by.get(r.pattern) ?? by.set(r.pattern, []).get(r.pattern)!).push(r);
const passed = by.get("pass")?.length ?? 0;
for (const set of [...new Set(rows.map((r) => r.set))]) {
  const of = rows.filter((r) => r.set === set);
  console.log(`${set}: ${of.filter((r) => r.pattern === "pass").length}/${of.length} pass`);
}
const rate = (100 * passed) / Math.max(1, rows.length);
const wanted = rows.filter((r) => r.want), correct = wanted.filter((r) => r.graded === "correct").length, wrong = wanted.filter((r) => r.graded === "wrong").length;
const compared = rows.filter((r) => r.numbers !== "not compared"), differ = compared.filter((r) => r.numbers === "differ").length;
console.log(`all: ${passed}/${rows.length} pass (${rate.toFixed(1)}%) · season ${seasonLabel(season)} · ${TRAIN ? "training set" : "held out"}`);
console.log(`graded against the written answer: ${correct} correct, ${wrong} wrong, ${wanted.length - correct - wrong} unchecked (of ${wanted.length} with one)`);
console.log(`numbers against the team page: ${compared.length - differ} same, ${differ} differ (of ${compared.length} compared)`);
for (const [k, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}: ${rs.length}`);
  if (k !== "pass") for (const r of rs) console.log(`  ${r.set}#${r.n} "${r.q}" → ${r.card}${r.unread.length ? ` · unread ${r.unread.join(" ")}` : ""}${r.wrong ? ` · ${r.wrong}` : ""}`);
}
const slowest = Math.max(0, ...rows.map((r) => r.ms));
console.log(`\nslowest answer ${slowest} ms`);
// Claimed twice (see the header): read against the record on a whole held-out run only, a part of one claiming less.
const id = (r: Row) => `${r.set}#${r.n}`;
const twice = rows.filter((r) => r.both).map(id).sort();
console.log(`claimed by the pipeline and the keyword layer: ${twice.length}`);
let claimsFailed = false;
if (CLAIMS) {
  writeFileSync(CLAIMS_FILE, `${JSON.stringify({ both: twice }, null, 2)}\n`);
  console.log(`recorded ${twice.length} in scripts/search-heldout.claims.json`);
} else if (!TRAIN && !SET && !ONLY) {
  const recorded = new Set((JSON.parse(readFileSync(CLAIMS_FILE, "utf8")) as { both: string[] }).both);
  const more = twice.filter((k) => !recorded.has(k)), fewer = [...recorded].filter((k) => !twice.includes(k));
  const of = (k: string) => { const r = rows.find((x) => id(x) === k); return r ? `${k} "${r.q}"` : k; };
  if (more.length) console.log(`\nFAIL: claimed by both readers, not before (one reader per question):\n${more.map((k) => `  ${of(k)}`).join("\n")}`);
  if (fewer.length) console.log(`\nFAIL: recorded as claimed twice, now by one reader: take them off the list (--claims):\n${fewer.map((k) => `  ${of(k)}`).join("\n")}`);
  claimsFailed = more.length > 0 || fewer.length > 0;
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass: passed, total: rows.length, rate: +rate.toFixed(1), correct, wrong, wanted: wanted.length, compared: compared.length, differ, slowest }));
local.close();
// A team page the local server couldn't give is a broken run, never a silent "not compared".
const unavailable = rows.filter((r) => r.pageMissing);
if (unavailable.length) { console.log(`\nFAIL: the team page was unavailable for ${unavailable.length} answers (${unavailable.slice(0, 3).map((r) => `"${r.q}"`).join(", ")})`); process.exit(1); }
// The CI floor (--min): a pass rate under it fails the run.
if (MIN != null && rate < Number(MIN)) { console.log(`\nFAIL: ${rate.toFixed(1)}% is under the ${MIN}% minimum`); process.exit(1); }
if (claimsFailed) process.exit(1);
process.exit(0);
