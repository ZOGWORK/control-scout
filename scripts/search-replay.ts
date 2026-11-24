// The replay (docs/failed-search-reporting.md, "Replay"): every query of a closed `failed-search` issue
// (scripts/search-replay.json, written by scripts/search-replay-build.ts) asked again of the shipped snapshot, in
// process, the way the box asks. A closed issue says the query answers now, so each one passes when failureOf (the
// failed-search log's own test, server/searchFailures.ts) finds no failure. It fails below the floor (MIN), for every
// query and for visitors' queries alone (the set's eval questions, our own test traffic, aside), and prints each
// query that fails. A query answered with another kind than recorded is printed too, never failed on.
//
//   npm run search:replay                         the shipped snapshot
//   npm run search:replay -- --write              record what each query gets today into the set
//   npm run search:replay -- --only "worlds"      the queries with these words only (no floor)
//   DATABASE_URL=file:.data/scout.db npm run search:replay
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rate, sameQuery, serialize, type ReplaySet } from "./lib/searchReplay.js";

// The floor, in percent: the rate measured when it was set (2026-11-24: 601/624 = 96.3% in all, 366/389 = 94.1% for
// visitors), less a margin of about two points, since search changes under it every day. Raise it as search gets
// better; never lower it to pass.
const MIN = { all: 94, visitor: 92 };

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const WRITE = process.argv.includes("--write"), ONLY = flag("only")?.toLowerCase();
if (!process.env.DATABASE_URL) {
  const dir = join(tmpdir(), "control-scout-search-eval");
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "scout.db").replace(/\\/g, "/")}`;
}
const started = performance.now();
const { restoreSnapshotIfEmpty } = await import("../server/data/snapshot.js");
console.log(`data: ${await restoreSnapshotIfEmpty()}`);
const { migrate } = await import("../server/db.js");
await migrate();
const { ensureSearchIndex } = await import("../server/api/search.js");
const { rebuildSearch } = await import("../server/stats/job.js");
await ensureSearchIndex(rebuildSearch);
const { forecasterFor } = await import("../server/predict/engine.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { refreshSearchSeason } = await import("../server/api/answers/season.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { failureOf, outcomeTrace } = await import("../server/searchFailures.js");
const { seasonLabel } = await import("../src/shared/format.js");
type Answer = Awaited<ReturnType<typeof searchAnswer>>;

const season = await refreshSearchSeason();
await forecasterFor(CURRENT_SEASON);
await forecasterFor(season);

const FILE = join(import.meta.dirname, "search-replay.json");
const set = JSON.parse(readFileSync(FILE, "utf8")) as ReplaySet;
const rows = set.rows.filter((r) => !ONLY || r.q.toLowerCase().includes(ONLY));

/** What an answer is, in a word: the stat's family and intent, the card's kind, a verdict, else how it was read. */
const kindOf = (a: Answer) =>
  a.stat ? `stat:${a.stat.family}/${a.stat.intent}` : a.card ? `card:${a.card.kind}` : a.verdict ? "verdict" : a.sorry ? "sorry" : a.understood?.kind ?? "none";

type Result = { issue: number; q: string; source: string; ok: boolean; kind: string; was: string | null; label: string; ms: number };
const results: Result[] = [];
const warm = performance.now();
for (const r of rows) {
  const t = performance.now();
  const a = await searchAnswer(r.q, { learn: false, limit: 12, full: true });
  const f = failureOf(r.q, a, outcomeTrace(a));
  results.push({ issue: r.issue, q: r.q, source: r.source, ok: !f, kind: f ? `fail:${f.type}` : kindOf(a), was: r.kind, label: a.understood?.label ?? "", ms: performance.now() - t });
}
const asked = performance.now() - warm;

if (WRITE) {
  const now = new Map(results.map((x) => [sameQuery(x.q), x.kind]));
  writeFileSync(FILE, serialize({ ...set, rows: set.rows.map((r) => ({ ...r, kind: now.get(sameQuery(r.q)) ?? r.kind })) }));
  console.log(`recorded ${now.size} kinds → ${FILE}`);
}

const line = (x: Result) => `  #${x.issue}${x.source === "eval" ? " (eval)" : ""} "${x.q}" → ${x.kind}${x.label ? ` · ${x.label}` : ""}`;
const failing = results.filter((x) => !x.ok);
const moved = results.filter((x) => x.ok && x.was && !x.was.startsWith("fail:") && x.was !== x.kind);
const visitors = results.filter((x) => x.source === "visitor");
const all = { passed: results.length - failing.length, of: results.length };
const vis = { passed: visitors.filter((x) => x.ok).length, of: visitors.length };
const pct = (n: number) => `${n.toFixed(1)}%`;

if (failing.length) console.log(`\nfails today: ${failing.length}\n${failing.map(line).join("\n")}`);
if (moved.length) console.log(`\nanswered with another kind than recorded (not a failure): ${moved.length}\n${moved.map((x) => `${line(x)} (was ${x.was})`).join("\n")}`);
console.log(`\n${set.closed} closed issues (${set.notPlanned} not planned, ${set.dismissed} dismissed, left out), set built ${set.built} · season ${seasonLabel(season)}`);
console.log(`all:      ${all.passed}/${all.of} answered (${pct(rate(all.passed, all.of))}), floor ${MIN.all}%`);
console.log(`visitors: ${vis.passed}/${vis.of} answered (${pct(rate(vis.passed, vis.of))}), floor ${MIN.visitor}%`);
console.log(`eval:     ${all.passed - vis.passed}/${all.of - vis.of} answered`);
const slowest = [...results].sort((x, y) => y.ms - x.ms).slice(0, 5).map((x) => `"${x.q}" ${Math.round(x.ms)} ms`).join(", ");
console.log(`${Math.round(asked / 1000)} s asking, ${Math.round((performance.now() - started) / 1000)} s in all · slowest ${slowest}`);

const below = !ONLY && (rate(all.passed, all.of) < MIN.all || rate(vis.passed, vis.of) < MIN.visitor);
if (below) console.log("\nBelow the floor: a query a closed issue says answers fails again. Each one is listed above.");
process.exit(below ? 1 : 0);
