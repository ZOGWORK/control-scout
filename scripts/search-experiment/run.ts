// Runs the search spelling experiment: every arm on the same queries (queries.ts, expected answers fixed first),
// against the local database (.data/scout.db). Writes results.json and prints the table.
//
//   npx tsx scripts/search-experiment/run.ts [--out <dir>] [--runs-a 7] [--runs-ai 2] [--pace-ms 2500]
//
// Arms B and C call Gemini when GEMINI_API_KEY is set in the environment (never in a file in the repo); without
// it they run with the model absent, which is also their offline/failure behaviour.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, type Case } from "./queries.js";
import { MODEL, WEAK_SCORE, armA, armB, armC, topScore, type ArmResult } from "../../server/api/searchExperiment.js";
import type { SearchHit } from "../../src/shared/api.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", ".");
const RUNS_A = Number(arg("runs-a", "7"));
const RUNS_AI = Number(arg("runs-ai", "2"));
const PACE = Number(arg("pace-ms", "2500")); // between model calls: stay under the free tier's per-minute limit
const HAS_KEY = !!process.env.GEMINI_API_KEY;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const label = (h: SearchHit | undefined) => (h ? (h.kind === "team" ? `team ${h.ref}` : `${h.kind} ${h.ref}`) : "(none)");
function correct(c: Case, hits: SearchHit[]): boolean {
  const top = hits[0];
  const e = c.expect;
  if ("empty" in e) return hits.length === 0;
  if ("page" in e) return false; // search lists no pages (content only): see the note on "records" in queries.ts
  if (!top) return false;
  const ok = "team" in e ? top.kind === "team" && top.ref === String(e.team) : top.kind === "event" && top.ref === e.event;
  return ok && (!c.facts || !!top.facts?.length);
}
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

interface Row {
  q: string; kind: string; expect: string; arm: "A" | "A+" | "B" | "C";
  top: string; correct: boolean; facts: boolean; didYouMean?: string; aiSuggestion?: string; aiSuggestionCorrect?: boolean;
  why: string[]; ms: number[]; aiMs: number[]; promptTokens: number; outputTokens: number; aiCalled: boolean; aiError?: string;
}

const rows: Row[] = [];
const expectText = (c: Case) => ("team" in c.expect ? `team ${c.expect.team}` : "event" in c.expect ? `event ${c.expect.event}` : "empty" in c.expect ? "no results" : `page ${c.expect.page}`) + (c.facts ? " + answer line" : "");

async function measure(c: Case, arm: "A" | "A+" | "B" | "C", runs: number, fn: () => Promise<ArmResult>): Promise<void> {
  let last: ArmResult | null = null;
  const ms: number[] = [], aiMs: number[] = [];
  let pt = 0, ot = 0, calls = 0;
  for (let i = 0; i < runs; i++) {
    const r = await fn();
    last = r;
    ms.push(r.ms);
    if (r.ai) { if (r.ai.ms) aiMs.push(r.ai.ms); pt += r.ai.promptTokens; ot += r.ai.outputTokens; calls++; if (HAS_KEY) await sleep(PACE); }
  }
  const r = last!;
  rows.push({
    q: c.q, kind: c.kind, expect: expectText(c), arm, top: label(r.hits[0]), correct: correct(c, r.hits), facts: !!r.hits[0]?.facts?.length,
    didYouMean: r.didYouMean, aiSuggestion: r.aiSuggestion ? `${r.aiSuggestion.query} → ${label(r.aiSuggestion.hits[0])}` : undefined,
    aiSuggestionCorrect: r.aiSuggestion ? correct(c, r.aiSuggestion.hits) : undefined,
    why: r.why, ms, aiMs, promptTokens: calls ? pt / calls : 0, outputTokens: calls ? ot / calls : 0, aiCalled: !!r.ai, aiError: r.ai?.error,
  });
}

// Warm the search caches (the typo index loads on first use) so arm A's first query isn't timed cold.
await armA("warm up");
for (const c of CASES) {
  await measure(c, "A", RUNS_A, () => armA(c.q));
  await measure(c, "A+", RUNS_A, () => armA(c.q, true));
  await measure(c, "B", RUNS_AI, () => armB(c.q));
  await measure(c, "C", RUNS_AI, () => armC(c.q));
  process.stdout.write(".");
}
console.log();

// Offline: no network at all (fetch throws). A needs none; B loses its model; C keeps A's results.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => Promise.reject(new TypeError("fetch failed (offline)"))) as typeof fetch;
const offline = [] as { q: string; A: string; "A+": string; B: string; C: string }[];
for (const q of ["hipnotic", "hypnotic rankng pont", "bad wulf", "4215", "pensylvania champs"]) {
  const [a, ap, b, c] = [await armA(q), await armA(q, true), await armB(q), await armC(q)];
  offline.push({ q, A: label(a.hits[0]), "A+": label(ap.hits[0]), B: `${label(b.hits[0])} (${b.why[0]})`, C: `${label(c.hits[0])}${c.ai?.error ? ` (AI: ${c.ai.error})` : ""}` });
}
globalThis.fetch = realFetch;

// C's failure mode: the model times out (a 1 ms budget) on queries where it would be asked.
const failure = [] as { q: string; shown: string; didYouMean?: string; aiError?: string; suggestion: boolean }[];
for (const q of ["hipnotic", "asdfgh", "hypnotic rankng pont"]) {
  const c = await armC(q, 1);
  failure.push({ q, shown: label(c.hits[0]), didYouMean: c.didYouMean, aiError: c.ai?.error, suggestion: !!c.aiSuggestion });
}

const summary = (["A", "A+", "B", "C"] as const).map((arm) => {
  const rs = rows.filter((r) => r.arm === arm);
  const all = rs.flatMap((r) => r.ms);
  const ai = rs.flatMap((r) => r.aiMs);
  const called = rs.filter((r) => r.aiCalled);
  return {
    arm, correct: rs.filter((r) => r.correct).length, total: rs.length,
    // C: the right answer anywhere on screen (A's top result, or the AI suggestion's).
    correctWithSuggestion: arm === "C" ? rs.filter((r) => r.correct || r.aiSuggestionCorrect).length : undefined,
    p50: pct(all, 50), p95: pct(all, 95), aiP50: pct(ai, 50), aiP95: pct(ai, 95),
    aiCalls: called.length, promptTokens: called.length ? called.reduce((s, r) => s + r.promptTokens, 0) / called.length : 0,
    outputTokens: called.length ? called.reduce((s, r) => s + r.outputTokens, 0) / called.length : 0,
  };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "results.json"), JSON.stringify({ model: MODEL, hasKey: HAS_KEY, weakScore: WEAK_SCORE, runsA: RUNS_A, runsAi: RUNS_AI, at: new Date().toISOString(), rows, summary, offline, failure }, null, 2));
for (const r of rows) console.log(`${r.arm} ${r.correct ? "✓" : "✗"} ${JSON.stringify(r.q).padEnd(46)} ${r.top.padEnd(22)} p50 ${pct(r.ms, 50).toFixed(0)}ms${r.didYouMean ? ` · did you mean "${r.didYouMean}"` : ""}${r.aiSuggestion ? ` · AI: ${r.aiSuggestion}` : ""}${r.aiError ? ` · AI ${r.aiError}` : ""}`);
console.log(JSON.stringify({ summary, offline, failure }, null, 2));
void topScore;
process.exit(0);
