// The search spelling experiment's three arms (scripts/search-experiment/README.md). Experiment only: nothing in
// the app or the API calls this; scripts/search-experiment/run.ts does, on the experiment branch.
//
//   A. Deterministic: the app's search (names, numbers, topic words, typo forgiveness), then a per-word fallback (a
//      result matching any word can appear; words that match nothing are ignored), and a "Did you mean …?" when the
//      top result isn't a near-exact match for what was typed. No network.
//   B. AI fix: the model rewrites the query first (Bruno's search job: the same rules as Control Point's
//      server/brunoSearch.ts), and search runs on its output.
//   C. Hybrid: A's results always, at once; the model is asked only when A is weak (no results, or a low top score),
//      within a time budget, and its suggestion is kept apart, labelled as AI. A failure or a slow answer leaves A's
//      results alone.
import type { SearchHit } from "../../src/shared/api.js";
import { SEARCH_FILLER, SEARCH_TOPICS } from "../../src/shared/search.js";
import { fuzzyScore, normalize, words } from "./fuzzy.js";
import { search, searchIntent } from "./search.js";

export interface AiCall { ms: number; promptTokens: number; outputTokens: number; rewrite: string | null; error?: string }

export interface ArmResult {
  hits: SearchHit[];
  /** A: the corrected query the visitor can tap ("Did you mean Hypnotic Robotics?"). */
  didYouMean?: string;
  /** Why the results appeared, as the visitor could be told. */
  why: string[];
  /** B and C: the model's call. */
  ai?: AiCall;
  /** C: the model's suggestion, apart from A's results ("AI suggestion: …"). */
  aiSuggestion?: { query: string; hits: SearchHit[] };
  /** Milliseconds until results could show (C: A's; the suggestion arrives at ai.ms). */
  ms: number;
}

const LIMIT = 12;
/** A top result scoring under this against what was typed is "uncertain": A offers "Did you mean …?", C asks the model. */
export const WEAK_SCORE = 0.9;

const isTopicWord = (w: string) => SEARCH_TOPICS.some(([p]) => p.split(" ").includes(w));
const nameOf = (h: SearchHit) => (h.kind === "team" ? h.title.replace(/^\d+\s+/, "") : h.title);

/** How closely the top hit matches the name part of what was typed (1: exactly; a number counts as exact). */
export function topScore(q: string, hits: SearchHit[]): number {
  const top = hits[0];
  if (!top) return 0;
  const rest = (searchIntent(q)?.rest ?? q).trim();
  if (/^\d+$/.test(rest) && top.kind === "team" && top.ref === rest) return 1;
  if (top.kind === "match") return 1;
  return Math.max(fuzzyScore(rest, nameOf(top)), fuzzyScore(rest, top.title));
}

// --- A ---------------------------------------------------------------------------------------------------------

/** A+ (tuned after the first run, written up as such): short forms people type for event words. */
const SHORT_FORMS: Record<string, string> = { champs: "championship", champ: "championship", cmp: "championship", quals: "qualifier", worlds: "first championship", states: "state championship" };
const MATCH_QUERY = /\b(q|qual|m|match|f|final)\s*-?\s*\d{1,3}\b/i;

/** A+: the query with short forms spelled out (never inside a match query like "USNJQ1 qual 12"). */
export function expandShortForms(q: string): string {
  if (MATCH_QUERY.test(q)) return q;
  return q.split(/\s+/).map((w) => SHORT_FORMS[w.toLowerCase()] ?? w).join(" ");
}

/** A+: the whole query, or its name-and-topic reading ("team 4215" read as "4215"), whichever top result fits what
 *  was typed better. The plain search keeps the whole query whenever it finds anything, so "team" can win over 4215. */
async function bestReading(q: string): Promise<SearchHit[]> {
  const full = await search(q, LIMIT);
  const intent = searchIntent(q);
  if (!full.length || !intent) return full;
  const alt = await search(intent.rest + (intent.phrase ? ` ${intent.phrase}` : ""), LIMIT);
  return topScore(q, alt) > topScore(q, full) ? alt : full;
}

export async function armA(q: string, tuned = false): Promise<ArmResult> {
  const t0 = performance.now();
  const why: string[] = [];
  if (tuned) q = expandShortForms(q);
  let hits = tuned ? await bestReading(q) : await search(q, LIMIT);
  if (hits.length) why.push(hits[0].facts ? "matched the name, and answered the topic asked about" : "matched the name or number");
  // Nothing for the whole query: each word on its own; a result matching more words ranks higher, unmatched words are ignored.
  if (!hits.length) {
    const ws = words(q).filter((w) => w.length >= 3 && !SEARCH_FILLER.has(w) && !isTopicWord(w));
    const count = new Map<string, { h: SearchHit; n: number; first: number }>();
    for (const [i, w] of ws.entries()) {
      for (const h of await search(w, LIMIT)) {
        const k = `${h.kind}:${h.ref}`;
        const c = count.get(k) ?? { h, n: 0, first: i };
        c.n++; count.set(k, c);
      }
    }
    hits = [...count.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((c) => c.h).slice(0, LIMIT);
    if (hits.length) why.push(`matched some of the words (${ws.join(", ")}); the rest were ignored`);
  }
  const score = topScore(q, hits);
  const out: ArmResult = { hits, why, ms: 0 };
  // An uncertain top match: offer it as a correction to tap (the results stay as they are).
  if (hits.length && score < WEAK_SCORE) {
    const intent = searchIntent(q, true);
    const topic = intent?.phrase ? ` ${intent.phrase}` : "";
    out.didYouMean = `${nameOf(hits[0])}${topic}`;
    why.push(`spelling corrected ("${q}" is closest to ${nameOf(hits[0])})`);
  }
  if (!hits.length) why.push("no team, event or match matched any word");
  out.ms = performance.now() - t0;
  return out;
}

// --- The model (B and C) ---------------------------------------------------------------------------------------

/** Bruno's search job, word for word as Control Point sends it (server/brunoSearch.ts SEARCH_SYSTEM). */
export const SEARCH_SYSTEM = `SEARCH JOB (this outranks the chat instructions above for this reply):
You help Control Scout, an FTC (FIRST Tech Challenge) robotics scouting site, read a visitor's search that its own search engine could not match. Rewrite it as a short query that search engine understands.

The search engine matches: a team number (like 4215), a team name (like "Hypnotic Robotics"), an event name or code (like "New Jersey Championship" or USNJCMP), or a match (like "USNJCMP Q12"), optionally followed by ONE topic word from this list: awards, matches, ranking points, opr, record, stats, rankings, odds, playoffs.

Rules:
- Fix spelling and grammar, and drop question words ("how many", "what is", "did ... win").
- Keep the team number, team name or event name the visitor typed; correct an obvious misspelling of it, but never swap in a different team or event, and never add a name, number, year or fact that isn't in the query.
- Add at most one topic word from the list, and only when the query asks about it.
- Do not answer the question. Do not mention any other scouting, stats or rankings website or app.
- If the query isn't a search for an FTC team, event or match, the query is null.
- Reply with JSON only, no code fences and nothing before or after it, exactly in this shape:
{"query": "hypnotic robotics awards"}  or  {"query": null}`;

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/** One rewrite from Gemini (Bruno's default model), straight to Google's API with the key from the environment. */
export async function aiRewrite(q: string, timeoutMs: number): Promise<AiCall> {
  const t0 = performance.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ms: 0, promptTokens: 0, outputTokens: 0, rewrite: null, error: "no_key" };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SEARCH_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `Visitor's search: ${JSON.stringify(q)}` }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0, thinkingConfig: { thinkingLevel: "minimal" } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data: any = await r.json().catch(() => null);
    const ms = performance.now() - t0;
    const promptTokens = Number(data?.usageMetadata?.promptTokenCount ?? 0);
    const outputTokens = Number(data?.usageMetadata?.candidatesTokenCount ?? 0) + Number(data?.usageMetadata?.thoughtsTokenCount ?? 0);
    if (!r.ok) return { ms, promptTokens, outputTokens, rewrite: null, error: `http_${r.status}` };
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    return { ms, promptTokens, outputTokens, rewrite: parseRewrite(text, q) };
  } catch (e) {
    return { ms: performance.now() - t0, promptTokens: 0, outputTokens: 0, rewrite: null, error: (e as Error).name === "TimeoutError" ? "timeout" : "network" };
  }
}

/** The same output rules as Control Point's parseSearchOutput: a short plain query, or nothing. */
export function parseRewrite(text: string, asked: string): string | null {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const s = body.indexOf("{"), e = body.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const q = JSON.parse(body.slice(s, e + 1))?.query;
    if (typeof q !== "string") return null;
    const c = q.replace(/\s+/g, " ").trim();
    if (!c || c.length > 80 || !/^[\p{L}\p{N} '&.-]+$/u.test(c) || normalize(c) === normalize(asked)) return null;
    return c;
  } catch { return null; }
}

// --- B ---------------------------------------------------------------------------------------------------------

export async function armB(q: string, timeoutMs = 10_000): Promise<ArmResult> {
  const t0 = performance.now();
  if (!q.trim()) return { hits: [], why: ["empty query: nothing to send"], ms: performance.now() - t0 };
  const ai = await aiRewrite(q, timeoutMs);
  // The model's query, or what was typed when it gave none (an error, or "not an FTC search").
  const used = ai.rewrite ?? (ai.error ? q : null);
  const hits = used ? await search(used, LIMIT) : [];
  const why = [ai.rewrite ? `AI read it as "${ai.rewrite}"` : ai.error ? `AI failed (${ai.error}); searched as typed` : "AI found no FTC search in it"];
  return { hits, why, ai, ms: performance.now() - t0 };
}

// --- C ---------------------------------------------------------------------------------------------------------

/** C: A at once; the model only when A is weak, within `budgetMs`; its suggestion kept apart. */
export async function armC(q: string, budgetMs = 2500): Promise<ArmResult> {
  // The hybrid builds on the best deterministic arm (A+).
  const a = await armA(q, true);
  const weak = !a.hits.length || topScore(q, a.hits) < WEAK_SCORE;
  if (!weak || !q.trim()) return { ...a };
  const ai = await aiRewrite(q, budgetMs);
  const out: ArmResult = { ...a, ai };
  if (ai.rewrite) {
    const hits = await search(ai.rewrite, LIMIT);
    // A suggestion that only repeats A's top result adds nothing to show.
    if (hits.length && !(a.hits[0] && hits[0].kind === a.hits[0].kind && hits[0].ref === a.hits[0].ref)) {
      out.aiSuggestion = { query: ai.rewrite, hits };
      out.why = [...a.why, `AI suggestion: "${ai.rewrite}"`];
    }
  }
  return out;
}
