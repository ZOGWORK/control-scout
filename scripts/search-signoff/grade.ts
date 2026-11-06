// How the sign-off grades one live answer (scripts/search-signoff/README.md). Pure: the runner fetches, this reads.
// The expected answer is a kind ("record", "event|worlds"), never a number: the numbers come from the live team API at
// test time (crosscheck.ts), so nothing here goes stale when the data moves.

/** The parts of a live /api/search?answer=1 response the grader reads. */
export type Live = {
  step?: string;
  understood?: { kind?: string; label?: string; fallback?: unknown } | null;
  intent?: { kind?: string; understood?: string[] } | null;
  stat?: { family?: string; intent?: string; title?: string; heading?: string; none?: string; scope?: string[]; source?: string;
    headline?: { value?: string; label?: string; sub?: string } | null; team?: { number?: number } | null; teams?: { number?: number }[] | null } | null;
  card?: { kind?: string; title?: string; none?: string; headline?: string } | null;
  didYouMean?: unknown;
  hits?: { kind: string; ref: string }[];
};

/** What each expected kind accepts, matched against "family:intent:card-kind:title" of the answer. */
export const KINDS: Record<string, RegExp> = {
  "match-find": /^superlative:(find-|season-top|highest|lowest|top-matches)/,
  "team-match": /^superlative:|^aggregate:(wins-by|losses-by|scores-over)|head-to-head|recent-match|first-match/,
  record: /^aggregate:(record|wins|losses|qual|playoff|longest-streak|win-percent|current-streak)|boolean|record|win-rate/,
  opr: /:opr|opr-|event-opr/,
  rating: /:rating|rating-/,
  rank: /rank|percentile|neighbo/,
  trend: /^trend:|rating-change|opr-history|-trend|by event/,
  compare: /^two-team:|compare|-vs\b|-set\b/,
  h2h: /head-to-head|h2h|shared-matches|versus|lost-to|most-played|beat|rival|matches-with/,
  predict: /predict|chance|advance|odds/,
  settings: /setting/,
  picks: /pick|partner/,
  partners: /partner/,
  penalties: /penalt/,
  awards: /award|inspire/,
  leaderboard: /^leaderboard:|filtered-list|city-|most-/,
  event: /^event:|worlds|results|state/,
  worlds: /worlds/,
  events: /events|event-list|next-event/,
  fact: /info|location|school|rookie|sponsor|fact|team-name|^team:/,
  location: /location|where-they|:info:/,
  school: /school|:info:/,
  margin: /margin|biggest-win|closest|biggest-loss|narrowest/,
  average: /average/,
  count: /count|total-|how-many/,
  explain: /meaning|rule|explain|method|definition/,
  "when-last": /recent-match|last-match|last-played/,
  "when-next": /next-(match|event)|upcoming/,
  "when-first": /first-match|first-event|debut/,
  when: /when|recent|first|last|award/,
  rookie: /rookie|founded|age/,
  ever: /ever|yes-no|worlds|award|head-to-head|event|results/,
  any: /./,
};

export const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[‐-―]/g, "-").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();

/** Every word of the answer a reader sees as its claim: titles, scope chips, headline, the none line, the reading. */
export const answerText = (r: Live) => fold([r.stat?.title, r.stat?.heading, ...(r.stat?.scope ?? []), r.stat?.none, r.stat?.headline?.value, r.stat?.headline?.label,
  r.stat?.headline?.sub, r.stat?.source, r.card?.title, r.card?.none, r.card?.headline, r.understood?.label].filter(Boolean).join(" · "));

export const signature = (r: Live) => [r.stat?.family ?? (r.card ? "card" : r.understood?.kind ?? ""), r.stat?.intent ?? "", r.card?.kind ?? "", r.stat?.title ?? r.card?.title ?? ""]
  .map((x) => fold(x).replace(/ /g, "-")).join(":");

// Places a question can name, as the grader's own list (not the parser's): the card must say the place back.
const PLACES: [RegExp, string[]][] = [
  [/\b(new jersey|nj)\b/i, ["new jersey", "nj"]], [/\bcalifornia\b/i, ["california"]], [/\btexas\b/i, ["texas"]], [/\bflorida\b/i, ["florida"]],
  [/\bohio\b/i, ["ohio"]], [/\bmichigan\b/i, ["michigan"]], [/\bnew york\b/i, ["new york"]], [/\bromania(n)?\b/i, ["romania"]],
  [/\bcluj/i, ["cluj"]], [/\boradell\b/i, ["oradell"]], [/\briver edge\b/i, ["river edge"]],
];

/** The season a question names ("2025-26", "in 2024"), as the labels a card may say it with. */
export function seasonsAsked(q: string): string[] | null {
  const m = q.match(/\b(20\d\d)\s*[-–]\s*(\d\d)\b/);
  if (m) return [`${m[1]}-${m[2]}`];
  const y = q.match(/\b(?:in|from|of|for)?\s*(20[12]\d)\b/);
  if (!y) return null;
  const n = +y[1];
  return [`${n - 1}-${String(n % 100).padStart(2, "0")}`, `${n}-${String((n + 1) % 100).padStart(2, "0")}`, String(n)];
}

const WINDOW = /\b(this|last|next) (week|weekend|month)\b|\byesterday\b|\btoday\b|\btomorrow\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = 86_400_000;

/** The days a window covers on `today`, generously (a week may start Sunday or Monday). */
export function windowDays(w: string, today: Date): [number, number] {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()), dow = today.getUTCDay();
  const mon = t - ((dow + 6) % 7) * DAY, month = (k: number) => [Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, 1), Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k + 1, 0)] as [number, number];
  const s = w.toLowerCase();
  if (s === "today") return [t, t];
  if (s === "yesterday") return [t - DAY, t - DAY];
  if (s === "tomorrow") return [t + DAY, t + DAY];
  const k = s.startsWith("last") ? -1 : s.startsWith("next") ? 1 : 0;
  if (s.endsWith("month")) return month(k);
  if (s.endsWith("weekend")) return [mon + (5 + 7 * k) * DAY, mon + (6 + 7 * k) * DAY];
  return [mon - DAY + 7 * k * DAY, mon + (6 + 7 * k) * DAY];
}

/** The dates a card names ("Nov 1 2026", "2026-11-01"), as UTC days. */
export function datesIn(text: string, today: Date): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?: (\d{4}))?\b/g))
    out.push(Date.UTC(m[3] ? +m[3] : today.getUTCFullYear(), MONTHS.indexOf(m[1]), +m[2]));
  for (const m of text.matchAll(/\b(\d{4})-(\d\d)-(\d\d)\b/g)) out.push(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return out;
}

export type Grade = { verdict: "pass" | "fail"; invalid: boolean; pattern: string; card: string; missing: string };

const DEBUG = /\bread as\b|isn t answered directly|isnt answered directly|not answered directly|say which|pattern key|missed words/;
const NONE_WORDS = /\bno\b|never|wasn t|isn t|hasn t|none|not at|no matches|0 matches/;

/**
 * One answer graded. `expect` is the kinds it may be ("event|worlds") or "invalid" (a question about something that
 * doesn't exist: passes only with a clear no-match card) or "sorry" (an intent not built yet: the sorry state).
 */
export function grade(q: string, expect: string, r: Live | null, err?: string, today = new Date()): Grade {
  if (!r) return { verdict: "fail", invalid: expect === "invalid", pattern: "request failed", card: err ?? "no response", missing: "a response" };
  const text = answerText(r), sig = signature(r);
  const answered = !!r.stat || !!r.card || (r.understood?.kind === "events" && !r.understood.fallback && r.step !== "recovery");
  const card = r.stat ? `${r.stat.title ?? r.stat.intent} = ${r.stat.headline?.value ?? r.stat.none ?? "-"}` : r.card ? `${r.card.kind}: ${r.card.title ?? ""}${r.card.none ? ` = ${r.card.none}` : ""}` : `(${r.understood?.kind ?? "none"}) ${r.understood?.label ?? ""}`;
  const fail = (pattern: string, missing: string): Grade => ({ verdict: "fail", invalid: expect === "invalid", pattern, card: card.slice(0, 220), missing });
  if (expect === "sorry") {
    return /sorry/.test(fold(r.understood?.label ?? "") + " " + text) ? { verdict: "pass", invalid: false, pattern: "pass", card, missing: "" }
      : fail("sorry state missing", "\"Sorry — I can't answer that yet\", what was understood, working questions");
  }
  if (!answered) {
    const k = r.understood?.kind;
    if (k === "team") return fail(DEBUG.test(text) ? "team card only (not answered yet)" : "team card only", "an answer card");
    if (k === "compare") return fail("compare card without numbers", "a side-by-side answer");
    if (k === "events") return fail("event list only", "an answer card");
    return fail(r.step === "recovery" || r.step === "closest" ? "fallback only" : "names only", "an answer card");
  }
  if (DEBUG.test(text)) return fail("debug or meta text", "plain words, no \"read as\"/\"say which\"");
  const none = !!(r.stat?.none || r.card?.none);
  if (expect === "invalid") {
    return none && NONE_WORDS.test(text) ? { verdict: "pass", invalid: true, pattern: "pass", card, missing: "" }
      : fail("invalid query got an invented answer", "a clear no-matches card saying what was checked");
  }
  const kinds = expect.split("|");
  if (!kinds.some((k) => (KINDS[k] ?? new RegExp(k)).test(sig))) return fail("wrong answer kind", `a ${expect} answer (got ${sig.slice(0, 80)})`);
  const said = seasonsAsked(q);
  if (said && !said.some((s) => text.includes(s))) return fail("season not stated", `season ${said[0]} on the card`);
  // A window ("this week", "yesterday") is a filter too: the card says it back, or its dates fall inside it.
  const w = q.match(WINDOW);
  if (w && !text.includes(fold(w[0]))) {
    const [a, b] = windowDays(w[0], today), ds = datesIn(text, today);
    if (!ds.length) return fail("time filter not stated", `"${w[0]}" on the card`);
    if (!ds.some((d) => d >= a && d <= b)) return fail("time filter missed", `a match from ${w[0]} (${new Date(a).toISOString().slice(0, 10)}–${new Date(b).toISOString().slice(0, 10)})`);
  }
  for (const [re, says] of PLACES) if (re.test(q) && !says.some((w) => new RegExp(`\\b${w}\\b`).test(text))) return fail("place not stated", `${says[0]} on the card`);
  return { verdict: "pass", invalid: false, pattern: "pass", card, missing: "" };
}

/** Two answers to one intent agree: the same kind of card, the same headline number. */
export function sameAnswer(a: Live | null, b: Live | null): boolean {
  if (!a || !b) return false;
  const k = (r: Live) => `${r.stat?.family ?? r.card?.kind ?? ""}:${r.stat?.intent ?? ""}`;
  const v = (r: Live) => r.stat?.headline?.value ?? r.stat?.none ?? r.card?.headline ?? r.card?.title ?? "";
  return k(a) === k(b) && v(a) === v(b);
}
