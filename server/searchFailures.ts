// Failed searches → GitHub issues, as a work queue to read (docs/failed-search-reporting.md).
//
// LOG ONLY. This files and updates issues; it never fixes, assigns, closes, marks in progress, opens a pull request
// or merges anything. The owner reads the list (label failed-search), directs the work, and closes an issue by hand
// after checking the query live. The automated GitHub actions, all of them: create an issue (with its labels),
// update its body (count, last seen, examples), reopen it with a comment when its query fails again after it was
// closed as fixed, and post a comment when the owner asks for a re-check.
//
// Never on the search path. /api/search answers first; noteSearch() is then given the answer and does only
// in-memory work, synchronously, with no I/O:
//   1. settle: a query waits SETTLE_MS for the same visitor's next one. The dropdown searches while typing, so
//      "4215 o" is superseded by "4215 opr" (each starts with the other), and a retry of the same query counts once.
//   2. a settled failure goes into a bounded buffer (BUFFER_MAX distinct queries; more are dropped and counted).
// Every FLUSH_MS (the metrics minute) the buffer is written to search_failures in one batch, and every SYNC_MS a
// background job brings at most SYNC_WRITES issues up to date on GitHub, backing off whenever GitHub rate-limits.
// With GitHub down or no token, failures are still counted in the table, and sync catches up later; search never
// waits on any of it. The visitor's IP is used only in memory (the settle map, the hourly limit) and never stored.
import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { all, db, get, run } from "./db.js";
import { env } from "./env.js";
import { isEnabled } from "./flags.js";
import { ownerOf } from "./owner.js";
import { GITHUB_REPO, GithubError, fenced, gh, refused, takeReportSlot } from "./errorReports.js";
import { searchKey, searchOutcome, traceOf, type OutcomeResult } from "./api/searchLayers.js";
import type { SearchAnswer } from "../src/shared/api.js";

// --- What counts as a failed search (brief §12.1) ---------------------------------------------------------------

export type FailureType = "no-match" | "team-fallback" | "weak" | "name-only" | "empty" | "ambiguous";

/** How search reached its answer: from the layered reader (Track A) when it reports one, else read from the
 *  answer itself (readTrace). Server-only, never sent to the browser. */
export interface SearchTrace {
  /** Layers attempted, in order ("0" … "6"); empty when not known. */
  layers: string[];
  /** The layer that answered; null: none (the Layer 6 fallback, or nothing). */
  won: string | null;
  /** The team as read ("4215", "hypnotic robotics"); null: none. */
  team: string | null;
  /** Intent keywords found ("opr", "where", "from"). */
  intents: string[];
  /** Scope tokens found (a place, season or year, event, award, division). */
  scope: string[];
  /** Filler dropped (brief §7). */
  filler: string[];
  /** Two or more intents matched equally well (brief §10): their names. */
  ambiguous?: string[];
  /** What the layered reader called the answer (SearchOutcome.result), when it reported one: it decides. */
  result?: OutcomeResult;
}

export interface Failure { type: FailureType; intent: string | null; trace: SearchTrace }

/** Intent keywords (brief §6 minimum sets), keyed by the intent label they get. A word is looked for as a whole word. */
export const INTENT_WORDS: Record<string, readonly string[]> = {
  location: ["from", "location", "located", "where", "based"],
  opr: ["opr"],
  rating: ["rating", "predicted", "prediction"],
  record: ["record", "wins", "losses", "win rate", "win percentage"],
  matches: ["matches", "schedule", "fixtures"],
  awards: ["awards", "award", "inspire", "think", "connect", "design", "innovate", "motivate", "control"],
  events: ["events", "event"],
  "next-last": ["next", "last", "most recent"],
  championships: ["worlds", "states", "championships", "championship", "appearances"],
  winners: ["won", "winner", "winners", "champions", "champion"],
  leaderboard: ["top", "best", "highest", "most", "leaders", "leaderboard"],
  phase: ["auto", "autonomous", "teleop", "endgame"],
  count: ["how many", "count", "number of"],
  meaning: ["what is", "what are", "how is", "how does", "define", "meaning", "rules", "rule"],
  versus: ["vs", "versus", "better than", "compare", "head to head", "who wins", "who would win"],
  school: ["school"],
};

/** Whole-word (or whole-phrase) match on a normalized query: " opr " in " 4215 opr rn ". */
const has = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/** The intents whose keywords appear in the (normalized) query, in INTENT_WORDS order. */
export const intentsIn = (q: string) => Object.entries(INTENT_WORDS).filter(([, ws]) => ws.some((w) => has(q, w))).map(([k]) => k);
const intentWordsIn = (q: string) => Object.values(INTENT_WORDS).flat().filter((w) => has(q, w));

/** The trace when search didn't report one: what the answer itself says about how the query was read. */
export function readTrace(q: string, a: SearchAnswer): SearchTrace {
  const n = normalizeQuery(q);
  const teamHit = a.card?.team ? String(a.card.team.number) : a.understood?.kind === "team" || a.understood?.kind === "question" ? a.hits.find((h) => h.kind === "team")?.ref ?? null : null;
  const number = /(?:^| )(\d{1,5})(?: |$)/.exec(n)?.[1] ?? null;
  const scope = [a.understood?.place?.name, a.understood?.where, a.understood?.season ? String(a.understood.season) : null, a.understood?.year ? String(a.understood.year) : null]
    .filter((x): x is string => !!x);
  return { layers: [], won: null, team: teamHit ?? number, intents: intentWordsIn(n), scope, filler: fillerIn(n) };
}

/** The trace of a top-level searchAnswer() answer, from the layered reader's own outcome (with its result), or null
 *  when it reported none. Read from the answer object searchAnswer returned, before it's copied. */
export function outcomeTrace(a: SearchAnswer): SearchTrace | null {
  const o = searchOutcome(a);
  const t = traceOf(o);
  return o && t ? { ...t, result: o.result } : null;
}

/** The layered reader's results as failure types (one rename: "name-search-only" is filed as "name-only"). */
export const RESULT_TYPE: Record<Exclude<OutcomeResult, "answered">, FailureType> = {
  "no-match": "no-match", "team-fallback": "team-fallback", weak: "weak", "name-search-only": "name-only", empty: "empty", ambiguous: "ambiguous",
};

/** A failed search, or null when the answer answered (brief §12.1). Only the outcome counts, never the phrasing. */
export function failureOf(q: string, a: SearchAnswer, given?: SearchTrace | null): Failure | null {
  const trace = given ?? readTrace(q, a);
  const n = normalizeQuery(q);
  if (!n) return null;
  if (trace.result) {
    // The layered reader said what the answer is: that decides, not a reading of the answer here.
    if (trace.result === "answered") return null;
    const type = trace.result === "weak" && a.hits.length === 0 ? "no-match" : RESULT_TYPE[trace.result];
    // A fallback or a weak answer is a failure only when a team and an intent were both asked for (§12.1).
    if ((type === "team-fallback" || type === "weak") && !(trace.team && trace.intents.length)) return null;
    return { type, intent: trace.ambiguous?.length ? trace.ambiguous.join(" / ") : trace.intents[0] ?? null, trace };
  }
  const intents = intentsIn(n);
  const intent = trace.ambiguous?.length ? trace.ambiguous.join(" / ") : intents[0] ?? null;
  const teamAndIntent = !!trace.team && trace.intents.length > 0;
  // A page named outright ("privacy", "records") is an answer: its links, no hits, and no recovery.
  const pageAnswer = a.hits.length === 0 && a.pages.length > 0 && a.step !== "recovery" && a.understood?.kind === "names";
  const answered = !!a.card || !!a.stat || pageAnswer;
  const label = a.understood?.label ?? "";
  const type: FailureType | null =
    trace.ambiguous && trace.ambiguous.length > 1 ? "ambiguous"
    : a.hits.length === 0 && !answered && (a.step === "recovery" || a.understood?.kind === "names") ? "no-match"
    : a.hits.length === 0 && !answered ? "empty"
    : !answered && /isn't answered directly yet/.test(label) && teamAndIntent ? "team-fallback"
    : !answered && a.understood?.kind === "names" && /(?:^| )\d{1,5}(?: |$)/.test(n) && trace.intents.length > 0 ? "name-only"
    : a.weak && !answered && teamAndIntent ? "weak"
    : null;
  return type ? { type, intent, trace } : null;
}

// --- Normalization and redaction (brief §12.2, §12.3) -----------------------------------------------------------

/** Layer 0: lowercase, punctuation that carries no meaning out, spaces collapsed, "#4215" → "4215". Square brackets
 *  stay: redaction's placeholders ("[email]") are in them. */
export function normalizeQuery(q: string): string {
  return String(q ?? "").normalize("NFKC").toLowerCase()
    .replace(/[!?,;"<>(){}|\\^*`~=+]/g, " ")
    .replace(/(^| )#(\d{1,5})(?= |$)/g, "$1$2")
    .replace(/\.+( |$)/g, "$1")
    .replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Filler (brief §7's allowlist): dropped from the aggregation key only, so "4215 opr rn" and "4215 opr right now"
 *  land on one issue. Longest phrases first. Never an intent, scope or identity word (§7's forbidden list). */
export const FILLER = [
  "at this moment", "at the moment", "right now", "tell me", "show me", "give me", "look up",
  "rn", "currently", "please", "pls", "just", "really", "basically", "actually", "quick", "kindly", "hey", "hi", "hello",
] as const;

const fillerIn = (n: string) => FILLER.filter((f) => has(n, f));

/** The aggregation key: Layer 0, then filler out (the query itself if that would leave nothing). */
export function reportKey(q: string): string {
  const n = normalizeQuery(q);
  let k = ` ${n} `;
  for (const f of FILLER) k = k.split(` ${f} `).join(" ");
  return k.replace(/\s+/g, " ").trim() || n;
}

/** The query as logged: as typed, trimmed and cut to 200 characters, personal data out (before it's normalized:
 *  lowercasing or splitting "+" could break a pattern). */
export const safeQuery = (q: string) => redact(String(q).trim().slice(0, 200));

/** The aggregation key for a query as /api/search files it: search's own key (searchKey: Layer 0, filler out, never
 *  inside a team's name) of the redacted query, punctuation and case folded first. reportKey when that fails. */
export async function keyFor(q: string): Promise<string> {
  const safe = safeQuery(q);
  try {
    return (await searchKey(normalizeQuery(safe))) || reportKey(safe);
  } catch {
    return reportKey(safe);
  }
}

/** Personal data and secrets out of anything logged (brief §12.2: the repository is public). */
export function redact(text: string): string {
  // Compatibility forms first ("＠" is "@", "５" is "5"): normalizing later must never turn a kept string into an
  // address. Case and "+" are kept, so the token and phone patterns below still see the text as typed.
  return text.normalize("NFKC")
    // Secrets and tokens first (they can contain @ or digit runs): GitHub, OpenAI-style, Slack, AWS, JWTs,
    // then any 24+ character run mixing letters and digits.
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|sk-[\w-]{16,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g, "[token]")
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{24,}\b/gi, "[token]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    // A phone number: "+" and 8 or more digits in groups ("+44 20 7946 0958"), 3-3-4 with separators ("201 555 0123",
    // "(201) 555-0123"), a trunk 0 and groups ("020 7946 0958"), or 10+ digits in a row. Team numbers (5 digits at
    // most, never a leading 0 or "+") are kept: "4215 9999 12345" stays.
    .replace(/\+\d[\d ().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m))
    .replace(/(?:\(\d{3}\)|\b\d{3})[ .-]?\d{3}[ .-]\d{4}\b/g, "[phone]")
    .replace(/\b0\d{1,4}[ .-]\d{3,4}[ .-]\d{3,4}\b/g, "[phone]")
    .replace(/\b\d{10,}\b/g, "[phone]");
}

/** Every string in a trace, redacted (a scope token can be words the visitor typed). */
const redactTrace = (t: SearchTrace): SearchTrace => ({
  ...t,
  team: t.team == null ? null : redact(t.team),
  intents: t.intents.map(redact), scope: t.scope.map(redact), filler: t.filler.map(redact), layers: t.layers.map(redact),
  won: t.won == null ? null : redact(t.won),
  ...(t.ambiguous ? { ambiguous: t.ambiguous.map(redact) } : {}),
});

/** Nothing left to log once personal data is out (only placeholders): the query is skipped and counted. */
const onlyRedacted = (t: string) => !t.replace(/\[(?:token|email|phone)\]/g, "").replace(/[^a-z0-9]/gi, "");

/** The key's id on GitHub (in the issue body), for finding its issue again if the table is lost. */
export const keyHash = (key: string) => createHash("sha256").update(`failed-search:${key}`).digest("hex").slice(0, 24);

// --- Settle and buffer (in memory, no I/O) ----------------------------------------------------------------------

export const SETTLE_MS = 8_000;
export const BUFFER_MAX = 500;
/** Failed searches logged per visitor (IP, in memory only) an hour. */
export const PER_IP_HOUR = 30;
const SETTLE_MAX = 5_000;

/** `legacy`: the key as it was made before 2.8.1 (reportKey), so a query already on record under it stays on its row. */
interface Pending { q: string; key: string; legacy: string; failure: Failure | null; label: string; at: number }
interface Buffered { key: string; legacy: string; count: number; first: number; last: number; examples: string[]; failure: Failure; label: string }

const pending = new Map<string, Pending>();
const buffer = new Map<string, Buffered>();
/** Counters for the log line and tests: dropped (buffer full), skipped (all personal data), limited (per-IP cap), unfiled (GitHub writes that failed). */
export const counters = { dropped: 0, skipped: 0, limited: 0, unfiled: 0 };

const related = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

/** Called by /api/search after it answered (every answer=1 search, failed or not). Synchronous, never throws.
 *  `key`: the aggregation key (keyFor), worked out by the caller; reportKey of the query when not given. */
export function noteSearch(q: string, a: SearchAnswer, client: string, trace?: SearchTrace | null, now = Date.now(), key?: string): void {
  try {
    settle(now);
    const safe = safeQuery(q);
    const n = normalizeQuery(safe);
    if (!n) return;
    const was = pending.get(client);
    // The same visitor's next query supersedes one it extends or trims (typing, a retry): only the last one counts.
    if (was && !related(normalizeQuery(was.q), n)) commit(client, was);
    if (pending.size >= SETTLE_MAX && !pending.has(client)) { counters.dropped++; return; }
    // Re-inserted, so the map stays oldest first and settle() stops at the first entry still waiting.
    pending.delete(client);
    const failure = failureOf(q, a, trace);
    const legacy = reportKey(safe);
    pending.set(client, { q: safe, key: key || legacy, legacy, failure: failure && { ...failure, trace: redactTrace(failure.trace) }, label: redact(a.understood?.label ?? ""), at: now });
  } catch {
    // Reporting never breaks search.
  }
}

/** Moves every query that waited SETTLE_MS into the buffer (failures only). */
export function settle(now = Date.now(), everything = false): void {
  for (const [client, p] of pending) {
    if (!everything && now - p.at < SETTLE_MS) break;
    commit(client, p);
  }
}

function commit(client: string, p: Pending) {
  pending.delete(client);
  if (!p.failure) return;
  const { q, key } = p;
  if (onlyRedacted(key)) { counters.skipped++; return; }
  if (!takeReportSlot(`fs:${client}`, PER_IP_HOUR, p.at).ok) { counters.limited++; return; }
  const b = buffer.get(key);
  if (b) {
    b.count++; b.last = Math.max(b.last, p.at); b.failure = p.failure; b.label = p.label;
    // The latest first, a repeat too: the Reproduce link opens examples[0], and the reading is this one's.
    b.examples = [q, ...b.examples.filter((e) => e !== q)].slice(0, EXAMPLES_MAX);
    return;
  }
  if (buffer.size >= BUFFER_MAX) { counters.dropped++; return; }
  buffer.set(key, { key, legacy: p.legacy, count: 1, first: p.at, last: p.at, examples: [q], failure: p.failure, label: p.label });
}

/** Tests: forget what's waiting and buffered. */
export function resetSearchFailures() { pending.clear(); buffer.clear(); Object.assign(counters, { dropped: 0, skipped: 0, limited: 0, unfiled: 0 }); pausedUntil = 0; opened = { day: "", n: 0 }; }

// --- Store --------------------------------------------------------------------------------------------------------

export const EXAMPLES_MAX = 5;

interface Row {
  key: string; hash: string; result_type: FailureType; intent: string | null; reading: string; label: string; examples: string;
  count: number; first_seen: string; last_seen: string;
  issue_number: number | null; issue_state: string | null; reported_count: number; filing_at: string | null;
  /** Reopened as a regression (the failure's last seen): its comment is still to be posted. */
  regression_seen: string | null;
}
const COLUMNS = "key, hash, result_type, intent, reading, label, examples, count, first_seen, last_seen, issue_number, issue_state, reported_count, filing_at, regression_seen";

/** Puts a batch that couldn't be written back in the buffer, merged with what arrived meanwhile (still bounded). */
function restore(items: Buffered[]) {
  for (const it of items) {
    const b = buffer.get(it.key);
    if (b) {
      b.count += it.count; b.first = Math.min(b.first, it.first);
      b.examples = [...b.examples, ...it.examples.filter((e) => !b.examples.includes(e))].slice(0, EXAMPLES_MAX);
    } else if (buffer.size < BUFFER_MAX) buffer.set(it.key, it);
    else counters.dropped += it.count;
  }
}

/** Writes the buffer to search_failures in one batch (every minute; and on shutdown, `everything` still settling too).
 *  A failed write keeps the batch for the next flush. */
export async function flushSearchFailures(now = Date.now(), everything = false): Promise<number> {
  settle(now, everything);
  const items = [...buffer.values()];
  buffer.clear();
  if (!items.length) return 0;
  try {
    await writeBatch(items);
  } catch (e) {
    restore(items);
    throw e;
  }
  return items.length;
}

/** The batch with each query on the row it belongs to: its own key, or the key it was filed under before 2.8.1
 *  (reportKey) when only that row exists, so its issue, count and dismissal carry over and no second issue is
 *  opened. Items that land on one row are merged, newest examples first. */
export function onRows(batch: Buffered[], onRecord: Set<string>): Buffered[] {
  const out = new Map<string, Buffered>();
  for (const it of batch) {
    const key = !onRecord.has(it.key) && it.legacy !== it.key && onRecord.has(it.legacy) ? it.legacy : it.key;
    const b = out.get(key);
    if (!b) { out.set(key, { ...it, key }); continue; }
    const newer = it.last >= b.last ? it : b, older = newer === it ? b : it;
    out.set(key, {
      ...newer, key, count: b.count + it.count, first: Math.min(b.first, it.first), last: newer.last,
      examples: [...newer.examples, ...older.examples.filter((e) => !newer.examples.includes(e))].slice(0, EXAMPLES_MAX),
    });
  }
  return [...out.values()];
}

async function writeBatch(batch: Buffered[]) {
  const asked = [...new Set(batch.flatMap((b) => [b.key, b.legacy]))];
  const rows = await all<{ key: string; examples: string }>(`SELECT key, examples FROM search_failures WHERE key IN (${asked.map(() => "?").join(",")})`, asked);
  const had = new Map(rows.map((r) => [r.key, JSON.parse(r.examples) as string[]]));
  const items = onRows(batch, new Set(had.keys()));
  await db().batch(items.map((b) => {
    const examples = [...b.examples, ...(had.get(b.key) ?? []).filter((e) => !b.examples.includes(e))].slice(0, EXAMPLES_MAX);
    const reading = JSON.stringify(b.failure.trace);
    return {
      sql: `INSERT INTO search_failures (key, hash, result_type, intent, reading, label, examples, count, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET count = count + excluded.count, last_seen = MAX(last_seen, excluded.last_seen),
              result_type = excluded.result_type, intent = excluded.intent, reading = excluded.reading, label = excluded.label, examples = excluded.examples`,
      args: [b.key, keyHash(b.key), b.failure.type, b.failure.intent, reading, b.label, JSON.stringify(examples), b.count, new Date(b.first).toISOString(), new Date(b.last).toISOString()],
    };
  }), "write");
}

// --- GitHub issues --------------------------------------------------------------------------------------------

export const SYNC_MS = 10 * 60_000;
/** GitHub writes per sync at most (an issue created, or a body updated, counts one; a reopen two). */
export const SYNC_WRITES = 20;
/** New issues a day at most (UTC day, this server): many visitors' junk can't flood the public list. The rest wait
 *  in the table, counted, the most-repeated first. */
export const NEW_PER_DAY = 40;
let opened = { day: "", n: 0 };
const capped = (at: string) => {
  if (opened.day !== at.slice(0, 10)) opened = { day: at.slice(0, 10), n: 0 };
  return opened.n >= NEW_PER_DAY;
};
const CLAIM_STALE_MS = 10 * 60_000;
export const LABEL = "failed-search";
export const TITLE_MAX = 80;
export const SITE = "https://controlscout.org";

/** Labels set when an issue is created: failed-search, the result type, the intent where known. */
export const labelsFor = (r: Pick<Row, "result_type" | "intent">) =>
  [LABEL, `result:${r.result_type}`, ...(r.intent && !r.intent.includes(" / ") ? [`intent:${r.intent}`] : [])];

/** Mentions and issue links can't run from a title (the body's query text sits in code fences). */
const inert = (t: string) => t.replace(/@/g, "@​").replace(/#(?=\d)/g, "#​");

export function failureTitle(key: string): string {
  return `Failed search: ${inert(key.length > TITLE_MAX ? `${key.slice(0, TITLE_MAX - 1)}…` : key)}`;
}

export const reproduceUrl = (q: string) => `${SITE}/search?q=${encodeURIComponent(q)}`;
/** The query to try again: the latest one as typed (redacted), never the key, which drops filler and may answer. */
const latestTyped = (r: Pick<Row, "examples" | "key">) => (JSON.parse(r.examples) as string[])[0] ?? r.key;

export function failureBody(r: Row): string {
  const t = JSON.parse(r.reading) as SearchTrace;
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  const examples = JSON.parse(r.examples) as string[];
  return [
    "Logged automatically by FTC One Search's failed-search reporting (`docs/failed-search-reporting.md`). This is an entry in a work list: nothing fixes, assigns or closes it automatically.",
    "",
    `**Result type:** ${r.result_type}`,
    `**Count:** ${r.count}`,
    `**First seen:** ${r.first_seen}`,
    `**Last seen:** ${r.last_seen}`,
    `**Reproduce:** ${reproduceUrl(examples[0] ?? r.key)}`,
    `**Re-check (owner):** ${SITE}/api/reports/search-failures/${r.issue_number ?? "ISSUE"}/recheck`,
    `**Key:** \`${r.hash}\``,
    "",
    `### Query as typed (latest ${EXAMPLES_MAX} variants at most)`,
    fenced(examples.join("\n")),
    "",
    "### Normalized query (aggregation key)",
    fenced(r.key),
    "",
    "### Interpreted reading",
    fenced([
      `Team:             ${t.team ?? "none"}`,
      `Intent keywords:  ${list(t.intents)}`,
      `Intent:           ${r.intent ?? "unknown"}`,
      `Scope tokens:     ${list(t.scope)}`,
      `Filler dropped:   ${list(t.filler)}`,
      `Layers attempted: ${t.layers.length ? t.layers.join(" → ") : "not reported"}`,
      `Layer that won:   ${t.won ?? "none"}`,
      ...(t.ambiguous?.length ? [`Candidates:       ${t.ambiguous.join(", ")}`] : []),
      `Search said:      ${r.label || "(nothing)"}`,
    ].join("\n")),
    "",
    "### Status",
    "Open means this query still fails: to be worked on, or in progress as the owner marks it. Close only after checking live, through the Reproduce link, that the query now returns a direct answer. Never close from a PR, a merge or a deploy note alone. Closed as not planned (or labelled `dismissed`) means not worth fixing: it stays closed.",
  ].join("\n");
}

type Issue = { number: number; state: string; state_reason?: string | null; closed_at?: string | null; labels?: (string | { name?: string })[] };

let pausedUntil = 0;
const pauseFor = (e: unknown) => { if (e instanceof GithubError && e.retryAt) pausedUntil = Math.max(pausedUntil, e.retryAt); };
/** Tests: GitHub is rate-limiting until this time (epoch ms; 0: not). */
export const githubPausedUntil = () => pausedUntil;

const dismissed = (i: Issue) => i.state === "closed" && (i.state_reason === "not_planned" || (i.labels ?? []).some((l) => (typeof l === "string" ? l : l.name) === "dismissed"));

/** The issue already on GitHub for this key, found by its hash (the table was lost, or a create's answer was). */
async function findIssue(token: string, hash: string): Promise<Issue | null> {
  const q = encodeURIComponent(`"${hash}" repo:${GITHUB_REPO} is:issue label:${LABEL} in:body`);
  const found = await gh<{ items?: (Issue & { body?: string | null })[] }>(token, "GET", `/search/issues?q=${q}&per_page=5`);
  return (found.items ?? []).find((i) => (i.body ?? "").includes(hash)) ?? null;
}

export type SyncOutcome = "no-token" | "paused" | "off" | "claimed-elsewhere" | "opened" | "capped" | "adopted" | "updated" | "reopened" | "closed" | "dismissed" | "up-to-date";

/** GitHub writes one sync may still send. Each write is charged before it's sent, so one that fails (or whose answer
 *  is lost) counts too. */
export interface Budget { left: number }

/** Brings one key's issue up to date: opens it, or updates its body (reopening it if it was closed as fixed and has
 *  failed since). `budget`: the sync's writes (one at most, by default). */
export async function syncOne(key: string, now = new Date(), budget: Budget = { left: 3 }): Promise<SyncOutcome> {
  const token = env.githubReportToken;
  if (!token) return "no-token";
  if (Date.now() < pausedUntil) return "paused";
  const at = now.toISOString();
  const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  if (!(await run("UPDATE search_failures SET filing_at = ? WHERE key = ? AND (filing_at IS NULL OR filing_at < ?)", [at, key, stale]))) return "claimed-elsewhere";
  const release = () => run("UPDATE search_failures SET filing_at = NULL WHERE key = ? AND filing_at = ?", [key, at]);
  let sent = 0;
  /** One GitHub write: charged to the budget, and counted as sent, before it goes. */
  const write = <T>(method: "POST" | "PATCH", path: string, body: unknown) => { budget.left--; sent++; return gh<T>(token, method, path, body); };
  try {
    const row = (await get<Row>(`SELECT ${COLUMNS} FROM search_failures WHERE key = ?`, [key]))!;
    const count = Number(row.count);
    /** A regression comment still owed from an earlier sync. */
    const owedBefore = row.regression_seen;
    // Over the day's cap: not even a search on GitHub until tomorrow.
    if (row.issue_number == null && capped(at)) { await release(); return "capped"; }
    let issue: Issue | null = null;
    if (row.issue_number != null) {
      try { issue = await gh<Issue>(token, "GET", `/issues/${row.issue_number}`); } catch (e) { if (!(e instanceof GithubError && (e.status === 404 || e.status === 410))) throw e; }
    }
    // Never a duplicate: no issue on record (the table lost, or an earlier create unanswered), so look on GitHub first.
    const adopted = !issue ? await findIssue(token, row.hash) : null;
    issue ??= adopted;
    if (!issue) {
      if (capped(at)) { await release(); return "capped"; }
      opened.n++;
      const made = await write<Issue>("POST", "/issues", { title: failureTitle(row.key), body: failureBody({ ...row, issue_number: null }), labels: labelsFor(row) });
      // The body's re-check link needs the number: one more write, only at creation.
      await write("PATCH", `/issues/${made.number}`, { body: failureBody({ ...row, issue_number: made.number }) });
      await run("UPDATE search_failures SET issue_number = ?, issue_state = 'open', reported_count = ?, filing_at = NULL WHERE key = ?", [made.number, count, key]);
      return "opened";
    }
    if (dismissed(issue)) {
      await run("UPDATE search_failures SET issue_number = ?, issue_state = 'dismissed', reported_count = ?, regression_seen = NULL, filing_at = NULL WHERE key = ?", [issue.number, count, key]);
      return "dismissed";
    }
    if (issue.state === "closed") {
      // Closed as fixed: a regression only if the query failed after the owner closed it. Failures from before (still
      // waiting to be sent when it was closed) are counted, and the issue is left as the owner left it.
      if (!(issue.closed_at && row.last_seen > issue.closed_at)) {
        await run("UPDATE search_failures SET issue_number = ?, issue_state = 'closed', reported_count = ?, filing_at = NULL WHERE key = ?", [issue.number, count, key]);
        return "closed";
      }
      await write("PATCH", `/issues/${issue.number}`, { body: failureBody({ ...row, issue_number: issue.number }), state: "open" });
      // Reopened: the comment saying why is owed until it's posted (a refused one is tried again next sync).
      await run("UPDATE search_failures SET issue_number = ?, issue_state = 'open', reported_count = ?, regression_seen = ? WHERE key = ?", [issue.number, count, row.last_seen, key]);
      row.regression_seen = row.last_seen;
    } else if (count > Number(row.reported_count) || adopted) {
      await write("PATCH", `/issues/${issue.number}`, { body: failureBody({ ...row, issue_number: issue.number }) });
    }
    const owed = row.regression_seen;
    if (owed) {
      // Owed from an earlier sync, the comment may be there already (its reply lost, or the row not saved after it):
      // look first, by the failure time it names. Owed from this sync: just reopened, so it can't be.
      const marker = `(last seen ${owed},`;
      const earlier = row.regression_seen === owedBefore
        && (await gh<{ body?: string | null }[]>(token, "GET", `/issues/${issue.number}/comments?since=${encodeURIComponent(owed)}&per_page=100`)).some((c) => (c.body ?? "").includes(marker));
      if (!earlier) {
        await write("POST", `/issues/${issue.number}/comments`, { body: `Regression: this query failed again after the issue was closed ${marker} result type ${row.result_type}, ${count} times in total). Reopened; nothing else changed.` });
      }
    }
    if (!sent && !owed) { await release(); return "up-to-date"; }
    await run("UPDATE search_failures SET issue_number = ?, issue_state = 'open', reported_count = ?, regression_seen = NULL, filing_at = NULL WHERE key = ?", [issue.number, count, key]);
    return owed ? "reopened" : adopted ? "adopted" : "updated";
  } catch (e) {
    pauseFor(e);
    // Refused, or nothing sent yet: free the claim. Sent with no answer (a timeout, a 5xx): keep it until it goes
    // stale, by when GitHub's search has any issue that was made, and the next try adopts it.
    if (refused(e) || sent === 0) await release();
    throw e;
  }
}

/** One background sync: every key whose issue is missing or behind, issues already filed first, then the
 *  most-repeated failures; SYNC_WRITES writes at most, failed ones included. Stops when the switch goes off. */
export async function syncSearchFailures(now = new Date()): Promise<{ synced: number; writes: number }> {
  if (!env.githubReportToken || Date.now() < pausedUntil || !(await reportingOn())) return { synced: 0, writes: 0 };
  const due = await all<{ key: string }>(
    `SELECT key FROM search_failures WHERE (issue_number IS NULL OR count > reported_count OR regression_seen IS NOT NULL)
      AND COALESCE(issue_state, '') <> 'dismissed' ORDER BY issue_number IS NULL, count DESC, last_seen LIMIT ?`,
    [SYNC_WRITES],
  );
  const budget: Budget = { left: SYNC_WRITES };
  let synced = 0;
  for (const { key } of due) {
    // A row can take 3 writes (reopen, comment; or create, number): never start one that could pass the cap.
    if (budget.left < 3 || !(await reportingOn())) break;
    try {
      const r = await syncOne(key, now, budget);
      if (r === "paused") break;
      if (r === "capped") continue;
      synced++;
    } catch (e) {
      counters.unfiled++;
      console.warn(`[search-failures] counted, not filed on GitHub: ${e instanceof GithubError ? e.message : (e as Error)?.name === "TimeoutError" ? "timeout" : "error"}`);
      if (Date.now() < pausedUntil) break;
    }
  }
  return { synced, writes: SYNC_WRITES - budget.left };
}

/** The background job: buffer to table every minute (with the metrics flush), table to GitHub every SYNC_MS. */
export function startSearchFailureJobs(log: (m: string) => void): void {
  setInterval(() => {
    syncSearchFailures().then((r) => { if (r.synced) log(`search-failures: ${r.synced} issues brought up to date (${r.writes} writes)`); }).catch((e) => log(`search-failures: ${(e as Error).message}`));
  }, SYNC_MS).unref();
}

// --- Re-check (owner) -------------------------------------------------------------------------------------------

/**
 * The owner asks for a re-check of one issue's query: it's searched again now. Answered: a comment says so, and the
 * issue stays open for the owner to close after checking live. Still failing: a comment says that, and the count
 * and last seen go up. Never closes the issue.
 */
export async function recheck(issueNumber: number, answer: (q: string) => Promise<SearchAnswer>, now = new Date()): Promise<{ answered: boolean; label: string } | null> {
  const row = await get<Row>(`SELECT ${COLUMNS} FROM search_failures WHERE issue_number = ?`, [issueNumber]);
  if (!row) return null;
  const q = (JSON.parse(row.examples) as string[])[0] ?? row.key;
  const a = await answer(q);
  const f = failureOf(q, a, outcomeTrace(a));
  const label = redact(a.understood?.label ?? "");
  const at = now.toISOString();
  if (f) await run("UPDATE search_failures SET count = count + 1, last_seen = ?, result_type = ? WHERE key = ?", [at, f.type, row.key]);
  const token = env.githubReportToken;
  if (token) {
    const body = f
      ? `Re-check ${at}: still fails (result type ${f.type}). Search said:\n\n${fenced(label || "(nothing)")}\n\nLeft open. Count and last seen updated.`
      : `Re-check ${at}: this query now returns a direct answer. Search said:\n\n${fenced(label || "(nothing)")}\n\nNot closed by this check: the owner closes it after checking live at ${reproduceUrl(latestTyped(row))}.`;
    try { await gh(token, "POST", `/issues/${issueNumber}/comments`, { body }); } catch (e) { pauseFor(e); throw e; }
  }
  return { answered: !f, label };
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="robots" content="noindex">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem}</style></head><body>${body}</body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** GET: a page with one button (the issue body links here); POST: the re-check. Owner only; 404 for anyone else. */
export function searchFailuresRouter(answer: (q: string) => Promise<SearchAnswer>): Router {
  const r = express.Router();
  const LITE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
  const number = (req: Request) => (/^\d{1,7}$/.test(String(req.params.n)) ? Number(req.params.n) : null);
  r.get("/:n/recheck", (req: Request, res: Response) => {
    (async () => {
      const n = number(req);
      if (n == null || !(await ownerOf(req))) { res.status(404).json({ error: "Not found" }); return; }
      res.setHeader("Content-Security-Policy", LITE_CSP);
      res.type("html").send(page("Re-check failed search", `<h1>Re-check issue #${n}</h1><p>Searches the query again now and posts the outcome as a comment on <a href="https://github.com/${GITHUB_REPO}/issues/${n}">the issue</a>. It never closes it.</p><form method="post"><button>Re-check now</button></form>`));
    })().catch(() => { if (!res.headersSent) res.status(503).json({ error: "Couldn't load right now." }); });
  });
  r.post("/:n/recheck", (req: Request, res: Response) => {
    (async () => {
      const n = number(req);
      if (n == null || !(await ownerOf(req))) { res.status(404).json({ error: "Not found" }); return; }
      if (!(await reportingOn())) { res.status(409).type("html").send(page("Re-check failed search", "<p>Failed-search reports are switched off (owner console, kill switches).</p>")); return; }
      // Same-site form posts only: the Origin a browser sends must be this site's.
      const origin = req.get("origin");
      if (!origin || new URL(origin).host !== req.get("host")) { res.status(403).json({ error: "Cross-site request" }); return; }
      const out = await recheck(n, answer);
      res.setHeader("Content-Security-Policy", LITE_CSP);
      if (!out) { res.status(404).type("html").send(page("Re-check failed search", `<p>No failed search is on record for issue #${n}.</p>`)); return; }
      res.type("html").send(page("Re-check failed search", `<h1>${out.answered ? "Now answers" : "Still fails"}</h1><p>${esc(out.label)}</p><p>A comment is on <a href="https://github.com/${GITHUB_REPO}/issues/${n}">issue #${n}</a>. ${out.answered ? "Close it yourself after checking live." : "It stays open."}</p>`));
    })().catch(() => { if (!res.headersSent) res.status(503).json({ error: "Couldn't re-check right now." }); });
  });
  return r;
}

/** Whether reporting is on (the owner's failedSearchReports kill switch). Read with the flags cache. */
export const reportingOn = () => isEnabled("failedSearchReports");
