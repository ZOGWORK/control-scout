// People also ask and Related searches, checked (the search audit's M9): for a fixed sample of searches, each follow-up
// /api/search/follow offers (server/api/answers/followUps.ts keptFollowUps, the same reading the /search page draws) is
//   - on the subject: it names a team, an event or a place the search typed or its answer card is about
//     (scripts/lib/followUpTopic.ts); a search that names none is matched on its own words
//   - answered when tapped: searched again from cold, its answer is a card (a stat, a question's card or an events
//     list), never a sorry, a fallback, a weak guess or names only (failureOf in server/searchFailures.ts, the same
//     test the failure log files issues by)
// and both rates printed, with every offender. It measures only: nothing here changes what follow-ups are made.
// Runs in-process against the shipped snapshot (as npm run search:heldout does), no server, no network.
//
//   npm run search:followups                                  set C of the sign-off plus a few team/place/event searches
//   npm run search:followups -- --min-topic 0.99 --min-answer 0.99  fail under these rates (CI's are in GATE below)
//   npm run search:followups -- --queries "4215" "nj championship 2025-26"
//   npm run search:followups -- --out .data/followups.jsonl
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offTopic, type Subject } from "./lib/followUpTopic.js";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
// The floors CI holds. Set 2026-11-24 at that day's rates less a margin: other sessions are changing search code at
// the same time (answers, kinds, speed), and a follow-up appearing or going away moves a rate by a point or two
// without anything being wrong. Raise them as the rates settle; never lower one to make a change pass.
const GATE = { topic: 0.97, answer: 0.97 };
const MIN_TOPIC = Number(flag("min-topic") ?? GATE.topic), MIN_ANSWER = Number(flag("min-answer") ?? GATE.answer), OUT = flag("out");

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
const { parseQuery } = await import("../server/api/query/parse.js");
const { parseContext } = await import("../server/api/query/context.js");
const { forecasterFor } = await import("../server/predict/engine.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { refreshSearchSeason } = await import("../server/api/answers/season.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { keptFollowUps, pageAnswer } = await import("../server/api/answers/followUps.js");
const { failureOf, outcomeTrace } = await import("../server/searchFailures.js");
const { SEARCH_PAGE_LIMIT } = await import("../src/shared/search.js");
type SearchAnswer = import("../src/shared/api.js").SearchAnswer;

const season = await refreshSearchSeason();
await forecasterFor(CURRENT_SEASON);
await forecasterFor(season);

// The sample: the sign-off's set C (scripts/search-signoff/sets/C.json, 50 searches over every kind) and a few plain
// team, place and event searches, the kinds people type most and set C has few of.
const EXTRA = ["4215", "7149 record", "17670 awards", "top teams in new jersey", "teams in california", "nj championship 2025-26",
  "texas state championship 2025-26", "who won inspire at worlds 2024-25"];
const qi = argv.indexOf("--queries");
const queries = qi >= 0 ? argv.slice(qi + 1).filter((x) => !x.startsWith("--"))
  : [...(JSON.parse(readFileSync(join(import.meta.dirname, "search-signoff", "sets", "C.json"), "utf8")) as { q: string }[]).map((x) => x.q), ...EXTRA];

const TEAM_HREF = /\/teams\/(\d+)(?=[?#/"]|$)/g, EVENT_HREF = /\/events\/\d{4}\/([A-Za-z0-9]+)/g;

/** What `q` and its answer `a` are about: the teams, event and place it typed, and the ones its answer card names. */
async function subjectOf(q: string, a: SearchAnswer): Promise<Subject> {
  const p = await parseQuery(q, await parseContext());
  const teams: Subject["teams"] = p.teams.map((t) => ({ number: t.number, name: t.name }));
  for (const t of [a.stat?.team, ...(a.stat?.teams ?? []), a.card?.team]) if (t) teams.push(t);
  // The card's headline and first line link the team or event it leads with (a leaderboard's first, an award's winner).
  const lead = JSON.stringify([a.stat?.headline ?? null, a.card?.lines?.[0] ?? null]);
  for (const m of lead.matchAll(TEAM_HREF)) teams.push({ number: Number(m[1]) });
  const events = [p.event?.typed, p.event?.words, ...[...lead.matchAll(EVENT_HREF)].map((m) => m[1]), p.worlds ? "worlds" : undefined,
    p.states ? "state championship" : undefined, p.states ? "states" : undefined].filter((x): x is string => !!x);
  const places = [p.place?.name, p.place?.typed].filter((x): x is string => !!x);
  return { teams, events, places, words: q.split(/\s+/) };
}

/** Why tapping `q` gives no answer, or null when it answers: its answer searched again from cold. */
async function tapFails(q: string): Promise<string | null> {
  const a = await searchAnswer(q, { limit: SEARCH_PAGE_LIMIT, learn: false });
  if (a.sorry) return "sorry";
  const f = failureOf(q, a, outcomeTrace(a));
  if (f) return f.type;
  const card = !!a.stat || !!a.card || (a.understood?.kind === "events" && !a.understood.fallback);
  return card ? null : `no card (${a.understood?.kind ?? "nothing"})`;
}

type Row = { q: string; kind: "ask" | "related"; follow: string; topic: string | null; tap: string | null };
const rows: Row[] = [];
const bare: string[] = [];
const started = performance.now();
for (const q of queries) {
  const subject = await subjectOf(q, await pageAnswer(q, SEARCH_PAGE_LIMIT, new Set()));
  const f = await keptFollowUps(q);
  const offered = [...f.ask.map((x) => ({ kind: "ask" as const, q: x.q })), ...f.related.map((x) => ({ kind: "related" as const, q: x.q }))];
  if (!offered.length) bare.push(q);
  for (const o of offered) rows.push({ q, kind: o.kind, follow: o.q, topic: offTopic(o.q, subject), tap: await tapFails(o.q) });
}
const secs = (performance.now() - started) / 1000;

if (OUT) writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const pct = (n: number, of: number) => `${n}/${of} (${((100 * n) / Math.max(1, of)).toFixed(1)}%)`;
const onTopic = rows.filter((r) => !r.topic).length, answers = rows.filter((r) => !r.tap).length;
for (const kind of ["ask", "related"] as const) {
  const of = rows.filter((r) => r.kind === kind);
  console.log(`${kind === "ask" ? "People also ask" : "Related searches"}: ${of.length} · on the subject ${pct(of.filter((r) => !r.topic).length, of.length)} · answer when tapped ${pct(of.filter((r) => !r.tap).length, of.length)}`);
}
console.log(`all: ${rows.length} follow-ups for ${queries.length} searches (${bare.length} with none) · on the subject ${pct(onTopic, rows.length)} · answer when tapped ${pct(answers, rows.length)} · ${secs.toFixed(0)} s`);
const offTopicRows = rows.filter((r) => r.topic), deadRows = rows.filter((r) => r.tap);
if (offTopicRows.length) console.log(`\noff the subject: ${offTopicRows.length}`);
for (const r of offTopicRows) console.log(`  "${r.q}" → ${r.kind} "${r.follow}" · ${r.topic}`);
if (deadRows.length) console.log(`\nno answer when tapped: ${deadRows.length}`);
for (const r of deadRows) console.log(`  "${r.q}" → ${r.kind} "${r.follow}" · ${r.tap}`);
if (bare.length) console.log(`\nno follow-ups (reported, not failed): ${bare.map((q) => `"${q}"`).join(", ")}`);

const topicRate = onTopic / Math.max(1, rows.length), answerRate = answers / Math.max(1, rows.length);
const under = [topicRate < MIN_TOPIC ? `on the subject ${(100 * topicRate).toFixed(1)}% < ${100 * MIN_TOPIC}%` : null,
  answerRate < MIN_ANSWER ? `answer when tapped ${(100 * answerRate).toFixed(1)}% < ${100 * MIN_ANSWER}%` : null, rows.length ? null : "no follow-ups at all"].filter(Boolean);
if (under.length) console.log(`\nFAIL: ${under.join(" · ")}`);
process.exit(under.length ? 1 : 0);
