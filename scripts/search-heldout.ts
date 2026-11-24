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
// The held-out sets live in scripts/search-heldout.json ({ set, n, q, want? }). A question that appears word for word
// in the repo's tests or code isn't held out: it is in the training set, scripts/search-train.json, and the guard test
// (./search-heldout.test.ts) fails when one gets in. --split moves them.
//
//   npm run search:heldout                    the shipped snapshot, every held-out set
//   npm run search:heldout -- --set q260 --out .data/heldout.jsonl
//   npm run search:heldout -- --only "closest"   the questions with these words only
//   npm run search:heldout -- --train         the training set instead
//   npm run search:heldout -- --min 80        exit 1 below an 80% pass rate (CI, .github/workflows/ci.yml)
//   npm run search:heldout -- --split         move held-out questions found in tests or code to the training set
//   DATABASE_URL=file:.data/scout.db npm run search:heldout
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootSearch, localServer } from "./search-local.js";
import { gradeWant, wantSeason } from "./search-heldout-grade.js";
import { leaks } from "./search-heldout-leaks.js";
import { answerSeason, crosscheck } from "./search-signoff/crosscheck.js";
import { answerText, type Live } from "./search-signoff/grade.js";

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SET = flag("set"), OUT = flag("out"), ONLY = flag("only")?.toLowerCase(), MIN = flag("min"), JSON_OUT = flag("json");
const TRAIN = process.argv.includes("--train");
type Q = { set: string; n: number; q: string; want?: string };
const HELD = join(import.meta.dirname, "search-heldout.json"), TRAINING = join(import.meta.dirname, "search-train.json");
const read = (f: string): Q[] => JSON.parse(readFileSync(f, "utf8"));
const write = (f: string, xs: Q[]) => writeFileSync(f, `[\n${xs.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n]\n`);

if (process.argv.includes("--split")) {
  const held = read(HELD), train = read(TRAINING);
  const found = leaks(held.map((x) => x.q));
  const moved = held.filter((x) => found.has(x.q));
  write(HELD, held.filter((x) => !found.has(x.q)));
  write(TRAINING, [...train, ...moved]);
  console.log(`moved ${moved.length} of ${held.length} to the training set (now ${train.length + moved.length}); held out: ${held.length - moved.length}`);
  process.exit(0);
}

const { season, data } = await bootSearch();
console.log(`data: ${data}`);
const local = await localServer();
// The team-page check needs this server: one that doesn't answer would make every comparison "not compared", a pass.
if (!(await fetch(`${local.base}/api/health`).then((x) => x.ok).catch(() => false))) { console.log("FAIL: the local server doesn't answer"); process.exit(1); }
const { fold } = await import("../server/api/query/names.js");
const { parseQuery } = await import("../server/api/query/parse.js");
const { parseContext } = await import("../server/api/query/context.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { pickedQuery } = await import("../server/api/searchPageAnswer.js");
const { seasonLabel } = await import("../src/shared/format.js");
const { LEXICON } = await import("../server/api/query/lexicon.js");

const FILLER = new Set(LEXICON.filter((e) => e.syms.every((x) => x.k === "filler")).flatMap((e) => e.words));
const sets = read(TRAIN ? TRAINING : HELD).filter((x) => (!SET || x.set === SET) && (!ONLY || x.q.toLowerCase().includes(ONLY)));

type Row = Q & { ms: number; intent: string | null; filters: string[]; place: string | null; time: string | null; card: string; stated: boolean; pattern: string; unread: string[];
  graded: "correct" | "wrong" | "unchecked"; wrong: string; numbers: "same" | "differ" | "not compared" };
const rows: Row[] = [];
for (const x of sets) {
  const t = performance.now();
  const a = await searchAnswer(x.q, { learn: false, limit: 12, full: true });
  const ms = performance.now() - t;
  const p = await parseQuery(x.q, await parseContext());
  const s = a.stat;
  const text = fold([s?.title, s?.heading, ...(s?.scope ?? []), s?.none, s?.headline?.label, s?.headline?.sub, a.card?.title, a.card?.none, a.card?.headline, a.understood?.label, a.understood?.fallback].filter(Boolean).join(" · "));
  const place = p.place?.name ?? null;
  const time = p.time ? p.time.label : null;
  const unread = p.leftover.filter((w) => !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
  // A place is stated by its name (or the region it's a part of, said so); a time by its words, its season or a
  // relaxation the card says.
  const placeStated = !place || text.includes(fold(place)) || /isnt a separate region/.test(text);
  // "This season" is the latest season (the current one, or the default when the current has no data yet) and "last
  // season" the one before the default: the card names that season. A season said is that season; a month said is
  // that month (its first three letters) and that year in full.
  const relative = p.time?.relative === "this" ? [CURRENT_SEASON, season] : p.time?.relative === "last" ? [season - 1] : [];
  const timeStated = !p.time || /relaxed|no .* yet|showing \d{4}/.test(text) || text.includes(fold(p.time.label))
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
  if (want && x.want && /answer is about/.test(want.note ?? "")) {
    const again = await searchAnswer(await pickedQuery(x.q, wantSeason(x.want)), { learn: false, limit: 12, full: true });
    want = graded(again as unknown as Live);
  }
  const check = isAnswer ? await crosscheck(local.base, live) : { compared: false, ok: true, note: "" };
  const verdict = want?.verdict === "wrong" ? "wrong answer" : !check.ok ? "numbers differ from the team page" : pattern;
  if (ONLY) console.log(JSON.stringify({ q: x.q, time: p.time, text, placeStated, timeStated, want }));
  rows.push({ ...x, ms: Math.round(ms), intent: p.intent ?? s?.intent ?? null, filters: [...(s?.scope ?? [])], place, time, card, stated: placeStated && timeStated, pattern: verdict, unread,
    graded: want?.verdict ?? "unchecked", wrong: want?.verdict === "wrong" ? `missing ${want.missing.join(", ")}` : check.note,
    numbers: check.compared ? (check.ok ? "same" : "differ") : "not compared" });
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
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pass: passed, total: rows.length, rate: +rate.toFixed(1), correct, wrong, wanted: wanted.length, compared: compared.length, differ, slowest }));
local.close();
// A team page the local server couldn't give is a broken run, never a silent "not compared".
const unavailable = rows.filter((r) => r.wrong === "team page unavailable");
if (unavailable.length) { console.log(`\nFAIL: the team page was unavailable for ${unavailable.length} answers (${unavailable.slice(0, 3).map((r) => `"${r.q}"`).join(", ")})`); process.exit(1); }
// The CI floor (--min): a pass rate under it fails the run.
if (MIN != null && rate < Number(MIN)) { console.log(`\nFAIL: ${rate.toFixed(1)}% is under the ${MIN}% minimum`); process.exit(1); }
process.exit(0);
