// Global search: teams, events and matches.
//
// Full-text (FTS5, prefix-indexed) over team numbers/names/schools/places and
// event codes/names/places; exact team numbers jump to the top; a query like
// "USNJQ1 Q12" or "2025 USNJQ1 M3" resolves straight to a match.
import { all, get } from "../db.js";
import { CURRENT_SEASON, isLegacy } from "../data/seasons.js";
import type { SearchHit } from "../../src/shared/api.js";
import { SEARCH_FILLER, SEARCH_TOPICS, TOPIC_LABEL, sectionFor, type SearchTopic } from "../../src/shared/search.js";
import { teamAtEvent, teamEvents, teamFacts, teamSeason } from "./searchFacts.js";
import { allowedEdits, charSet, editDistance, fuzzyScore, joinedWords, normalize, trigramQuery, wordScore, words } from "./fuzzy.js";
import { kvGet } from "../db.js";
import { isEnabled } from "../flags.js";
import { findRegions } from "../../src/shared/regions.js";
import { registerCache } from "../caches.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { searchTeamTitle, teamNameOf } from "../../src/shared/teamTitle.js";
import { nameWords, onlyCommonWords } from "../../src/shared/searchQuery.js";
import { placeHit } from "./searchEvents.js";
import { searchRead } from "./searchReads.js";

/** Turn free text into a safe FTS5 query: every word as a quoted prefix term. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().replace(/["*^():]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

const MATCH_RE = /^(?:(20\d\d)\s+)?([a-z0-9]{3,16})\s+(q|qual|m|match|f|final)\s*-?\s*(\d{1,3})(?:-(\d))?$/i;

/** The match a code and number name ("USNJCMPPKWY Q12", "2025 USNJCMP F1"). With no year, the newest season the code
 *  has matches in (a code's new season is listed before it's played). An event split in divisions has its
 *  qualification and division playoff matches on each division, and its finals on the event itself, so a match the
 *  code doesn't hold is looked for there: the event's own "Q12" is each division's, a division's "F1" the event's. */
async function matchHits(q: string): Promise<SearchHit[]> {
  const m = MATCH_RE.exec(q.trim());
  if (!m) return [];
  const code = m[2].toUpperCase();
  const season = m[1] ? Number(m[1])
    : Number((await get<{ s: number }>("SELECT MAX(season) s FROM matches WHERE code = ? OR code IN (SELECT d.code FROM events d JOIN events e ON e.season = d.season AND e.code = ? WHERE d.code LIKE e.code || '_%' AND d.name LIKE e.name || ' - %')", [code, code]))?.s
      ?? (await get<{ s: number }>("SELECT MAX(season) s FROM events WHERE code = ?", [code]))?.s ?? 0);
  if (!season) return [];
  const kind = m[3].toLowerCase()[0];
  const n = Number(m[4]);
  const find = (c: string) => kind === "q"
    ? get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'qual' AND number = ?", [season, c, n])
    : kind === "f"
      ? get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = 0 AND number = ?", [season, c, n])
      : get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = ? AND number = ?", [season, c, n, Number(m[5] ?? 1)]);
  const hit = async (c: string, row: any): Promise<SearchHit> => {
    const ev = await get<any>("SELECT name FROM events WHERE season = ? AND code = ?", [season, c]);
    return { kind: "match", ref: `${season}:${c}:${row.level}:${row.series}:${row.number}`, title: `${row.label} · ${ev?.name ?? c}`, subtitle: `${c} · ${season}`, season };
  };
  const own = await find(code);
  if (own) return [await hit(code, own)];
  // A division's finals are its event's ("USNJCMPPKWY F1": the New Jersey Championship's F1).
  const parent = await get<{ code: string }>("SELECT e.code FROM events e JOIN events d ON d.season = e.season AND d.code = ? WHERE e.season = ? AND d.code LIKE e.code || '_%' AND d.name LIKE e.name || ' - %'", [code, season]);
  const up = parent ? await find(parent.code) : null;
  if (parent && up) return [await hit(parent.code, up)];
  // An event's own code for a division's match ("USNJCMP Q1"): that match in each division.
  const divisions = await all<{ code: string }>("SELECT d.code FROM events d JOIN events e ON e.season = d.season AND e.code = ? WHERE d.season = ? AND d.code LIKE e.code || '_%' AND d.name LIKE e.name || ' - %' ORDER BY d.code", [code, season]);
  const out: SearchHit[] = [];
  for (const d of divisions) { const row = await find(d.code); if (row) out.push(await hit(d.code, row)); }
  return out;
}

/** A query that also asks about something ("hypnotic ranking points", "4215 awards"): the topic, its words as
 *  canonical ("ranking points"), and the words left to search for. Null when nothing would be left, or nothing dropped.
 *  `typos`: a topic word may be misspelled ("awrds", "ranking ponts"), within the name search's own edit allowance. */
export function searchIntent(q: string, typos = false): { topic: SearchTopic | null; phrase: string | null; rest: string } | null {
  // A question's punctuation and possessives go ("what are 4215's ranking points?" reads as "4215 ranking points").
  const ws = q.trim().replace(/[?!,]/g, " ").replace(/['’]s\b/gi, "").split(/\s+/).filter(Boolean);
  const lower = ws.map((w) => w.toLowerCase());
  let topic: SearchTopic | null = null, phrase: string | null = null, at = -1, len = 0;
  for (const [p, t] of SEARCH_TOPICS) {
    const pw = p.split(" ");
    const same = (a: string | undefined, w: string) => a === w || (typos && a != null && editDistance(a, w) <= allowedEdits(w.length));
    const i = lower.findIndex((_, j) => pw.every((w, k) => same(lower[j + k], w)));
    if (i >= 0) { topic = t; phrase = p; at = i; len = pw.length; break; }
  }
  const rest = ws.filter((w, i) => (i < at || i >= at + len) && !SEARCH_FILLER.has(w.toLowerCase()));
  if (rest.length === ws.length || !rest.length) return null;
  return { topic, phrase, rest: rest.join(" ") };
}

/** `prefer`: the visitor's own teams/events ("team:16321", "event:2025:AUBRQ2") —
 *  my team, tracked and shortlisted — rank above other matches of the same strength.
 *  `kinds`: only these kinds of hit (an events-only box), chosen before the limit so other kinds can't crowd them out.
 *  A query that also asks about something ("hypnotic awards", "4215 ranking points", "USNJCMP odds") finds what the
 *  rest names, each hit opening on that part of its page (SearchHit.section), and the top team carries the numbers
 *  asked about (SearchHit.facts). A team or event whose own name has the words ("Match Point") still comes first.
 *  Words like "team", and misspelled topic words ("hypnotic awrds"), count only when the whole query finds nothing. */
/** `season`: the season a query named ("last season", "2024-25"): a team's numbers and links are that season's. */
/** `asked`: the query as typed ended in "?" (a question: its own words name nothing, src/shared/searchQuery.ts). */
export async function search(q: string, limit = 12, prefer: ReadonlySet<string> = new Set(), kinds?: ReadonlySet<SearchHit["kind"]>, season?: number | null, asked = false): Promise<SearchHit[]> {
  const at = await teamAtEventAnswer(q, limit, prefer, kinds, season);
  if (at) return at;
  const full = await searchWords(q, limit, prefer, kinds, asked);
  // A match query ("USNJQ1 match 3") means that match, not the event's matches.
  if (MATCH_RE.test(q.trim())) return full;
  // The readings to try, in order: the words as typed, then (when the query found nothing) with a topic word's typo
  // forgiven ("hypnotic robotics ranking ponts": "ranking" alone leaves "ponts" unfound). The first that finds anything wins.
  const readings = [searchIntent(q), full.length ? null : searchIntent(q, true)];
  for (const intent of readings) {
    if (!intent || (!intent.topic && full.length)) continue;
    const { phrase } = intent;
    // Schedule difficulty switched off: its section shows nothing, so the query is read without that topic.
    const topic = intent.topic === "difficulty" && !(await isEnabled("scheduleDifficulty").catch(() => false)) ? null : intent.topic;
    const hits = await searchWords(intent.rest, limit, prefer, kinds, asked);
    if (!hits.length) continue;
    // The top team answers with its numbers ("Ranking score 3.40 at …"); the rest name the topic.
    const top = topic ? hits.find((h) => h.kind === "team") : undefined;
    const answer: Awaited<ReturnType<typeof teamFacts>> = top && topic ? await teamFacts(Number(top.ref), topic, season) : { facts: [], season: null };
    const found = hits.map((h): SearchHit => {
      // An event before predictions has no odds tab: nothing to open on, so no topic to name either.
      if (!topic || (topic === "odds" && h.kind === "event" && (h.season == null || isLegacy(h.season)))) return h;
      const section = sectionFor(h.kind, topic);
      // The answer's numbers, and its season in the link, so the page opens on what they describe.
      const withFacts = h === top && answer.facts.length > 0;
      return { ...h, ...(section ? { section } : {}), ...(withFacts ? { facts: answer.facts, linkSeason: answer.season!, ...(answer.events ? { events: answer.events } : {}) } : { subtitle: [TOPIC_LABEL[topic], h.subtitle].filter(Boolean).join(" · ") }) };
    });
    const named = phrase ? full.filter((h) => ` ${normalize(h.title)} `.includes(` ${normalize(phrase)} `)) : [];
    const seen = new Set<string>();
    return [...named, ...found, ...full].filter((h) => { const k = `${h.kind}:${h.ref}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }
  return full;
}

/**
 * "hypnotic OPR at New Jersey Championship": the team at that one of its events (event OPR, rank, ranking score),
 * linking to the event opened on the team. "… at this event", or an event none of the team's matches: the team with
 * its events and their OPRs, for the visitor to pick: never a guessed event. Null when the query isn't one of these.
 */
export async function teamAtEventAnswer(q: string, limit: number, prefer: ReadonlySet<string>, kinds?: ReadonlySet<SearchHit["kind"]>, asked?: number | null): Promise<SearchHit[] | null> {
  const m = /^(.+?)\s+at\s+(.+)$/i.exec(q.trim());
  if (!m || MATCH_RE.test(q.trim()) || (kinds?.size && !kinds.has("team"))) return null;
  const intent = searchIntent(m[1]) ?? searchIntent(m[1], true);
  // With no topic ("hypnotic at East Bergen") only an event of the team's that really matches counts: "battle at
  // the bay" stays an event name.
  const named = intent?.topic ? intent.rest : m[1].trim();
  const hits = await searchWords(named, limit, prefer, kinds);
  const team = hits.find((h) => h.kind === "team");
  if (!team) return null;
  const where = m[2].trim();
  const vague = /^(?:this|that|the|an?|my|our)?\s*(?:event|meet|tournament|competition|one|comp)?$/i.test(where);
  const found = vague ? null : await teamAtEvent(Number(team.ref), where, asked);
  const pick = found && "event" in found ? found : null;
  if (!intent?.topic && (!pick || (fuzzyScore(named, teamNameOf(team.title)) < 0.75 && !named.split(" ").includes(team.ref)))) return null;
  const others = hits.filter((h) => h !== team).slice(0, limit - 1);
  // The event's season on the hit too: an older event's facts and link never sit beside this season's badge.
  if (pick) return [{ ...team, atEvent: `${pick.event.season}:${pick.event.code}`, facts: pick.facts, season: pick.event.season, linkSeason: pick.event.season }, ...others];
  // Several events matched in an older season ("4215 at northern league meet" from last season): that season's events,
  // never this season's unrelated ones.
  const season = found && "ambiguous" in found ? found.season : (await teamSeason(Number(team.ref), asked)).season;
  const events = season == null ? [] : await teamEvents(Number(team.ref), season);
  // Several of its events match equally ("Northern League Meet"): the visitor picks; search never guesses one.
  const note = vague ? "Pick an event below" : found ? `Several of its events match "${where}": pick one below` : `None of its events matches "${where}": pick one below`;
  return [{ ...team, section: "history", ...(season != null ? { linkSeason: season } : {}), facts: [{ label: "Which event?", value: note }], ...(events.length ? { events } : {}) }, ...others];
}

async function searchWords(q: string, limit: number, prefer: ReadonlySet<string>, kinds?: ReadonlySet<SearchHit["kind"]>, asked = false): Promise<SearchHit[]> {
  // The words that can name something (src/shared/searchQuery.ts): plurals singular, no stopwords, time words or a
  // question's own words, so "meets in New Jersey" matches what "meet New Jersey" does and "upcoming" never names a team.
  const query = nameWords(q, asked);
  if (!query) return [];
  const allow = (k: SearchHit["kind"]) => !kinds?.size || kinds.has(k);
  // The same choice inside the index queries, so their row caps hold only wanted kinds.
  const indexed = kinds?.size ? [...kinds].filter((k) => k === "team" || k === "event") : null;
  const kindSql = indexed ? ` AND kind IN (${indexed.map(() => "?").join(",") || "NULL"})` : "";
  const kindArgs = indexed ?? [];
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => { const k = `${h.kind}:${h.ref}`; if (allow(h.kind) && !seen.has(k)) { seen.add(k); out.push(h); } };

  // 0. A state or province ("New Jersey", "NJ"): its events this season, as one link.
  // Counted as an event set's place link counts them (searchEvents.ts placeHit).
  if (allow("place") && !/\d/.test(query)) for (const r of findRegions(query)) {
    const h = await placeHit(r);
    if (h) push(h);
  }

  // 1. A specific match ("USNJQ1 Q12").
  if (allow("match")) for (const mh of await matchHits(query)) push(mh);

  // 2. Team numbers: exact first, then prefix matches as you type ("163" → 16321…).
  // (Team numbers never start with 0 — and a 0 prefix would never end the range loop.)
  if (allow("team") && /^[1-9]\d{0,5}$/.test(query)) {
    // Prefix "16" = numbers 16, 160–169, 1600–1699, … — integer ranges the primary key can serve.
    const p = Number(query);
    const preferred = [...prefer].map((k) => /^team:(\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number);
    const ranges: [number, number][] = [];
    for (let m = 1; p * m < 1_000_000; m *= 10) ranges.push([p * m, (p + 1) * m - 1]);
    const rows = await searchRead<any>(
      `SELECT t.number, t.name, t.city, t.state, t.country, cs.season last
       FROM teams t LEFT JOIN team_seasons cs ON cs.team = t.number AND cs.season = ?
       WHERE (${ranges.map(() => "t.number BETWEEN ? AND ?").join(" OR ")}) AND ${teamPageSql("t.number", "t.name")}
       ORDER BY t.number = ? DESC, t.number IN (${preferred.map(() => "?").join(",") || "NULL"}) DESC, cs.season IS NOT NULL DESC, t.number LIMIT ?`,
      [CURRENT_SEASON, ...ranges.flat(), p, ...preferred, query.length >= 4 ? Math.ceil(limit / 2) : limit],
    );
    for (const t of rows) push({ kind: "team", ref: String(t.number), title: searchTeamTitle(t.number, t.name), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.last == null ? null : Number(t.last) });
    if (out.length >= limit) return out.slice(0, limit);
  }
  // Other numbers: only 4+ digits (a year, digits of an event code) go on to the
  // word index; shorter ones would match every date ("16" → the 16th).
  if (/^\d+$/.test(query) && query.length < 4) return out;

  // 3. Text: word-prefix matches (exact words) + trigram candidates (typos),
  //    re-ranked together by how closely each query word matches.
  type Cand = SearchHit & { weight: number; name: string };
  const cands = new Map<string, Cand>();
  // Common words alone ("without", "team", "best") name no team (COMMON_WORDS): a team's name matches on a word of its
  // own, or when it's typed whole ("match point" is Match Point; both sides cleaned alike, so "the best" is The Best).
  const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
  const nameless = onlyCommonWords(query) ? plain(query) : null;
  const unnamed = (kind: string, title: string) => nameless != null && kind === "team" && plain(nameWords(teamNameOf(title))) !== nameless;
  const add = (r: any, name: string) => {
    if (unnamed(r.kind, r.title)) return;
    const k = `${r.kind}:${r.ref}`;
    if (!cands.has(k)) cands.set(k, { kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season == null ? null : Number(r.season), weight: Number(r.weight) || 1, name });
  };
  const fts = ftsQuery(query);
  if (fts) for (const r of await searchRead<any>(`SELECT kind, ref, season, weight, title, subtitle, terms FROM search WHERE search MATCH ?${kindSql} ORDER BY bm25(search, 0, 0, 0, 0, 10.0, 2.0, 1.0) LIMIT 60`, [fts, ...kindArgs])) add(r, `${r.title} ${r.subtitle} ${r.terms ?? ""}`);
  const tri = /[a-z]/i.test(query) ? trigramQuery(query) : null;
  if (tri) for (const r of await searchRead<any>(`SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy WHERE search_fuzzy MATCH ?${kindSql} ORDER BY bm25(search_fuzzy) LIMIT 150`, [tri, ...kindArgs])) add(r, `${r.title} ${r.name}`);
  const ranked = [...cands.values()]
    .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.name), fuzzyScore(query, `${c.title} ${c.subtitle}`) * 0.95) }))
    .filter((x) => x.s >= 0.6)
    // Your own teams/events win ties and near-ties, never beat a much better match.
    .map((x) => (prefer.has(`${x.c.kind}:${x.c.ref}`) ? { ...x, s: x.s + 0.1 } : x))
    .sort((a, b) => b.s - a.s || b.c.weight - a.c.weight || (b.c.season ?? 0) - (a.c.season ?? 0) || a.c.title.localeCompare(b.c.title));
  for (const { c } of ranked) push({ kind: c.kind, ref: c.ref, title: c.title, subtitle: c.subtitle, season: c.season });
  // Short typos can share no trigram with the right word ("dirve" vs "drive"):
  // when the index didn't find enough, scan the names in memory (bounded edit
  // distance, ~28k names, a few ms).
  if (!out.length && /\p{L}/u.test(query)) {
    const qs = words(query);
    // Cheap prefilter: a typo of a word still shares a 2-letter chunk with it, and every word typed must match
    // (scoreWords), so a name lacking any one word's chunks is out ("highest scoring games decode" scans the few
    // names with all four, not every name with "in" in it).
    const qb = qs.map((q) => bigrams(q)).filter((b) => b.size);
    const index = await fuzzyIndex();
    const scores = qs.map((q) => index.scorer(q));
    // scoreWords on every name, each name word's score read from the query word's scores; the 2-letter chunks are
    // then checked on the few names that score (both are filters, so the order doesn't change which pass).
    const passed: { r: FuzzyRow; s: number }[] = [];
    for (const r of index.rows) {
      if (!allow(r.kind) || unnamed(r.kind, r.title)) continue;
      const s = scoreIds(qs, scores, r);
      if (s >= 0.6) passed.push({ r, s });
    }
    const scanned = passed.filter(({ r }) => qb.every((b) => { for (const x of b) if (r.bigrams.has(x)) return true; return false; }))
      .map((x) => (prefer.has(`${x.r.kind}:${x.r.ref}`) ? { ...x, s: x.s + 0.1 } : x)) // same preference as the indexed path
      .sort((a, b) => b.s - a.s || b.r.weight - a.r.weight || (b.r.season ?? 0) - (a.r.season ?? 0));
    // Room for the older seasons newestSeasons drops.
    for (const { r } of scanned) { if (out.length >= limit * 4) break; push({ kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season }); }
  }
  return newestSeasons(out, query).slice(0, limit);
}

/** An event code comes back every season (USNJCMP 2023, 2024, …): keep its newest season unless a year was typed. */
function newestSeasons(hits: SearchHit[], query: string): SearchHit[] {
  if (/\b(19|20)\d\d\b/.test(query)) return hits;
  const newest = new Map<string, number>();
  for (const h of hits) if (h.kind === "event") { const [s, code] = h.ref.split(":"); newest.set(code, Math.max(newest.get(code) ?? 0, Number(s))); }
  return hits.filter((h) => { if (h.kind !== "event") return true; const [s, code] = h.ref.split(":"); return Number(s) >= (newest.get(code) ?? 0); });
}

/** A name of the typo index: its words, and each adjacent pair of them run together (joinedWords), as the index's
 *  word numbers (FuzzyIndex.words). */
interface FuzzyRow { kind: "team" | "event"; ref: string; season: number | null; weight: number; title: string; subtitle: string; words: Int32Array; joined: Int32Array; bigrams: Set<string> }

/** The typo index in memory: every name, and every distinct word in them, numbered (the names' own words first, then
 *  the pairs run together that no name has as a word). A name word scores the same against a query word in every
 *  name it's in, so each is scored once per query word (`scores`) instead of once per name: about a third as many. */
interface FuzzyIndex {
  rows: FuzzyRow[];
  words: string[];
  /** How many of `words` are names' own words (the rest are only pairs run together). */
  plain: number;
  /** A query word's scores against the words (Scorer). Kept for the last few query words, so the readings of one
   *  search, and the searches after it, share them. */
  scorer(q: string): Scorer;
}

/** A query word's score against each index word (wordScore), as a code into SCORE_VALUES (`codes`), worked out by
 *  `score` the first time the scan reads that word (UNSCORED until then). */
interface Scorer { codes: Uint8Array; score: (id: number) => number }

/** wordScore's values, by code (a code is a byte, so a query word's scores take one byte a word). */
const SCORE_VALUES: number[] = [0, 1, 0.95, 0.8, 0.65, 0.6];
const UNSCORED = 255;
const scoreCode = (s: number) => { let i = SCORE_VALUES.indexOf(s); if (i < 0) { i = SCORE_VALUES.length; SCORE_VALUES.push(s); } return i; };

/** scoreWords(qs, row's words, row's pairs), each word's score read from `scores` (one per query word, worked out
 *  where not yet): the same sum, in the same order, so the same number. */
export function scoreIds(qs: string[], scores: Scorer[], r: FuzzyRow): number {
  if (!qs.length || !r.words.length) return 0;
  let total = 0, lastIdx = -1, inOrder = 0;
  for (let k = 0; k < qs.length; k++) {
    const { codes, score } = scores[k];
    let best = 0, bestIdx = -1;
    for (let i = 0; i < r.words.length; i++) {
      const id = r.words[i], c = codes[id];
      const s = c === UNSCORED ? score(id) : SCORE_VALUES[c];
      if (s > best) { best = s; bestIdx = i; }
    }
    if (qs[k].length >= 5) for (let i = 0; i < r.joined.length; i++) {
      const id = r.joined[i], c = codes[id];
      const s = c === UNSCORED ? score(id) : SCORE_VALUES[c];
      if (s > best) { best = s; bestIdx = i; }
    }
    if (best === 0) return 0;
    total += best;
    if (bestIdx > lastIdx) inOrder++;
    lastIdx = bestIdx;
  }
  const avg = total / qs.length;
  return Math.min(1, avg + (qs.length > 1 && inOrder === qs.length ? 0.03 : 0));
}

/** A word's 2-letter chunks, each in letter order ("ea" and "ae" are one chunk), so a typo that swaps two letters
 *  ("gaer" for "gear") still shares one with the word. */
const bigrams = (s: string) => { const out = new Set<string>(); for (const w of s.split(" ")) for (let i = 0; i + 2 <= w.length; i++) out.add(w[i] < w[i + 1] ? w[i] + w[i + 1] : w[i + 1] + w[i]); return out; };

/** How many query words keep their scores (each a byte per index word, ~120 KB). */
const KEPT_SCORES = 48;

/** The typo index built from search_fuzzy's rows. */
export function buildFuzzyIndex(rs: { kind: "team" | "event"; ref: string; season: number | null; weight: number | null; title: string; subtitle: string; name: string }[]): FuzzyIndex {
  const ids = new Map<string, number>(), list: string[] = [];
  const id = (w: string) => { let n = ids.get(w); if (n === undefined) { n = list.length; ids.set(w, n); list.push(w); } return n; };
  const split = rs.map((r) => words(`${r.title} ${r.name}`));
  const own = split.map((ws) => Int32Array.from(ws, id));
  const plain = list.length;
  const rows = rs.map((r, i): FuzzyRow => ({
    kind: r.kind, ref: r.ref, season: r.season == null ? null : Number(r.season), weight: Number(r.weight) || 1, title: r.title, subtitle: r.subtitle,
    words: own[i], joined: Int32Array.from(joinedWords(split[i]), id),
    bigrams: bigrams(normalize(`${r.title} ${r.name}`)),
  }));
  const kept = new Map<string, Scorer>();
  const scorer = (q: string): Scorer => {
    const hit = kept.get(q);
    if (hit) { kept.delete(q); kept.set(q, hit); return hit; }
    // A query word under 5 letters is never scored against a pair run together (scoreWords), so it needs only the
    // names' own words.
    const codes = new Uint8Array(q.length >= 5 ? list.length : plain).fill(UNSCORED);
    const set = charSet(q);
    const score = (n: number) => { const s = wordScore(q, list[n], set); codes[n] = scoreCode(s); return s; };
    const made: Scorer = { codes, score };
    kept.set(q, made);
    if (kept.size > KEPT_SCORES) kept.delete(kept.keys().next().value!);
    return made;
  };
  return { rows, words: list, plain, scorer };
}

let indexCache: { version: string; index: Promise<FuzzyIndex> } | null = null;

/** The typo index in memory (reloaded when the search index is rebuilt). */
async function fuzzyIndex(): Promise<FuzzyIndex> {
  const version = (await kvGet<string>("search:version")) ?? "0";
  if (indexCache?.version === version) return indexCache.index;
  const index = all<any>("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy").then(buildFuzzyIndex);
  indexCache = { version, index };
  // A failed read (e.g. a brief database outage) must not stick: the next search retries.
  index.catch(() => { if (indexCache?.index === index) indexCache = null; });
  return index;
}
registerCache("Search typo index", () => { indexCache = null; });
/** Builds the typo index ahead of the first search that needs it (server start). */
export const warmTypoIndex = async (): Promise<void> => { await fuzzyIndex(); };

/** What the search index holds and how (server/stats/job.ts rebuildSearch): raised when that changes, so a server
 *  running the new code rebuilds the index once instead of waiting for the next stats run.
 *  2: team titles as "18061 | Simply Complex" (number and name each once). 3: events' venues are searchable words. */
export const SEARCH_INDEX_SCHEMA = 3;

/**
 * A database upgraded to migration 4 has an empty typo index until the next
 * stats run, and one built by older code holds the old shape (SEARCH_INDEX_SCHEMA): fill it now (once) so search
 * works straight away.
 */
let ensured: Promise<void> | null = null;
export function ensureSearchIndex(rebuild: () => Promise<void>): Promise<void> {
  ensured ??= (async () => {
    const [fz, ws, schema] = await Promise.all([get<{ n: number }>("SELECT COUNT(*) n FROM search_fuzzy"), get<{ n: number }>("SELECT COUNT(*) n FROM search"), kvGet<number>("search:schema")]);
    if (Number(ws?.n) && (!Number(fz?.n) || Number(schema ?? 0) < SEARCH_INDEX_SCHEMA)) await rebuild();
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}
