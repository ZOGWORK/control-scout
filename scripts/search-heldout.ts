// The held-out sets (docs/search-pipeline.md, "Eval"): questions written by people, never used to build search, asked
// the way the box asks and sorted by what went wrong, as patterns, never one fix per question. Each answer is read for
//   - the question understood (an intent read, or a card answering it)
//   - every filter it typed (a place, a time) applied and stated on the card
//   - a card at all: a team card, a list of names or a fallback alone is a fail
// and the pass rate printed by pattern. The sets live in scripts/search-heldout.json ({ set, n, q }); the expected
// numbers are never in it, so the data decides.
//
//   npm run search:heldout                    the shipped snapshot, every set
//   npm run search:heldout -- --set q260 --out .data/heldout.jsonl
//   npm run search:heldout -- --only "closest"   the questions with these words only
//   DATABASE_URL=file:.data/scout.db npm run search:heldout
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const SET = flag("set"), OUT = flag("out"), ONLY = flag("only")?.toLowerCase();
if (!process.env.DATABASE_URL) {
  const dir = join(tmpdir(), "control-scout-search-eval");
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
const { fold } = await import("../server/api/query/names.js");
const { parseQuery } = await import("../server/api/query/parse.js");
const { parseContext } = await import("../server/api/query/context.js");
const { forecasterFor } = await import("../server/predict/engine.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { refreshSearchSeason } = await import("../server/api/answers/season.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { seasonLabel } = await import("../src/shared/format.js");
const { LEXICON } = await import("../server/api/query/lexicon.js");

const season = await refreshSearchSeason();
await forecasterFor(CURRENT_SEASON);
await forecasterFor(season);
const FILLER = new Set(LEXICON.filter((e) => e.syms.every((x) => x.k === "filler")).flatMap((e) => e.words));
const sets = (JSON.parse(readFileSync(join(import.meta.dirname, "search-heldout.json"), "utf8")) as { set: string; n: number; q: string }[])
  .filter((x) => (!SET || x.set === SET) && (!ONLY || x.q.toLowerCase().includes(ONLY)));

type Row = { set: string; n: number; q: string; ms: number; intent: string | null; filters: string[]; place: string | null; time: string | null; card: string; stated: boolean; pattern: string; unread: string[] };
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
  const leftOut = /isnt part of this answer/.test(text);
  const pattern = !answered ? (a.understood?.fallback || a.step === "recovery" || a.step === "closest" ? "fallback only"
      : a.understood?.kind === "team" ? "team card only" : a.understood?.kind === "events" ? "event list only" : "names only")
    : /isnt answered|not answered/.test(text) ? "not answered"
    : !placeStated ? "place not stated"
    : !timeStated ? "time not stated"
    : leftOut || (piped && unread.length) ? "words not read"
    : "pass";
  const card = s ? `${s.title} = ${s.headline?.value ?? s.none ?? "–"}` : a.card ? `${a.card.title}${a.card.none ? ` = ${a.card.none}` : ""}` : `(${a.understood?.kind ?? "none"}) ${a.understood?.label ?? ""}`;
  if (ONLY) console.log(JSON.stringify({ q: x.q, time: p.time, text, placeStated, timeStated }));
  rows.push({ ...x, ms: Math.round(ms), intent: p.intent ?? s?.intent ?? null, filters: [...(s?.scope ?? [])], place, time, card, stated: placeStated && timeStated, pattern, unread });
}

if (OUT) writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const by = new Map<string, Row[]>();
for (const r of rows) (by.get(r.pattern) ?? by.set(r.pattern, []).get(r.pattern)!).push(r);
const passed = by.get("pass")?.length ?? 0;
for (const set of [...new Set(rows.map((r) => r.set))]) {
  const of = rows.filter((r) => r.set === set);
  console.log(`${set}: ${of.filter((r) => r.pattern === "pass").length}/${of.length} pass`);
}
console.log(`all: ${passed}/${rows.length} pass (${((100 * passed) / Math.max(1, rows.length)).toFixed(1)}%) · season ${seasonLabel(season)}`);
for (const [k, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}: ${rs.length}`);
  if (k !== "pass") for (const r of rs) console.log(`  ${r.set}#${r.n} "${r.q}" → ${r.card}${r.unread.length ? ` · unread ${r.unread.join(" ")}` : ""}`);
}
const slowest = Math.max(0, ...rows.map((r) => r.ms));
console.log(`\nslowest answer ${slowest} ms`);
process.exit(0);
