// Event sets: "upcoming meets in New Jersey at River Dell High School", "meets this weekend", "2024 Houston
// Championship Edison Division". Read by fixed rules (no model) into filters on the stored event data
// (server/api/searchEvents.ts). Pure: the app reads a query the same way for its live "we understood" line.
//
// The rules (docs in the FTC One Search PRs):
//   - A query is an event set when it names a kind of event (EVENT_TYPES: "meet", "championship", "events", …)
//     together with a place, a time or a year, or names a time with a place ("upcoming in NJ"). Never with a team
//     number, a versus or a match.
//   - Place: a region by full name or code ("New Jersey", "NJ"; a code that's also a word, like "in" or "me", only
//     in capitals), after "in"/"at"/"from"/… or bare. Other words after "in"/"at" are a city or a venue
//     ("in Oradell", "at River Dell High School").
//   - Time (src/shared/searchQuery.ts TIME_WORDS) is a date window (timeWindow).
//   - Year: "2024" means events held in calendar 2024 (a 2024 Houston championship belongs to the 2023–24 season);
//     "2023-24" means that season. No year: the current season, except championships (one a season): every season.
//   - A near-miss of a place's full name ("new jesey") is that place, said as read ("New Jersey (from "new jesey")").
//   - "states", "state champs" or "champs" with a place is its championship ("nj states").
import { findRegions, isRegionCode, nearRegion, regionLabel, type Region } from "./regions.js";
import { QUESTION_WORDS, STOPWORDS, isQuestionForm, singularize, timePhrase } from "./searchQuery.js";

/** Words that ask something of events rather than name them. */
const ASKS = new Set(["win", "wins", "won", "winner", "winners", "winning", "advance", "advances", "advancing", "beat", "predict", "prediction", "odds", "award", "awards", "inspire"]);
import { SEARCH_TOPICS } from "./search.js";

/** The event types (FIRST's, as stored in events.type) each event word means. An event word also matches an event
 *  whose own name has it ("… League Meet"). "event", "competition" and "comp" mean any type. */
export const EVENT_TYPES: Record<string, string[] | null> = {
  meet: ["LeagueMeet"], league: ["LeagueMeet", "LeagueTournament"], tournament: ["LeagueTournament"],
  championship: ["Championship", "FIRSTChampionship"], qualifier: ["Qualifier", "SuperQualifier"],
  scrimmage: ["Scrimmage", "PracticeDay"], kickoff: ["Kickoff"], premier: ["Premier"],
  champ: ["Championship", "FIRSTChampionship"], champs: ["Championship", "FIRSTChampionship"],
  event: null, competition: null, comp: null,
};

/** How an event word reads in a label ("League meets in New Jersey"). */
const EVENT_LABEL: Record<string, string> = {
  meet: "League meets", league: "League events", tournament: "League tournaments", championship: "Championships", champ: "Championships", champs: "Championships",
  qualifier: "Qualifiers", scrimmage: "Scrimmages", kickoff: "Kickoffs", premier: "Premier events",
  event: "Events", competition: "Events", comp: "Events",
};

export type SearchTime = "upcoming" | "past" | "this-weekend" | "next-weekend" | "this-week" | "next-week" | "this-month" | "next-month";
const TIME_OF: Record<string, SearchTime> = {
  upcoming: "upcoming", "coming up": "upcoming", past: "past", recent: "past", previous: "past", latest: "past",
  "this weekend": "this-weekend", "next weekend": "next-weekend", "this week": "this-week", "next week": "next-week",
  "this month": "this-month", "next month": "next-month",
};

/** Two-letter state codes that are also everyday words ("in", "or", "me"): a code only when typed in capitals. */
const WORD_CODES = new Set(["in", "or", "me", "hi", "ok", "oh", "la", "ma", "pa", "de", "al", "co", "id", "ga", "mo", "ne", "wa", "md", "nd", "sd", "ct", "va", "ms", "mt", "nm", "sc", "ar", "on", "ab", "pe", "ns"]);
/** Words that frame a request for events, never part of an event's name ("show me all meets in NJ"). */
const FRAME_WORDS = new Set(["next", "many", "much", "there", "all", "any", "list", "show", "me", "find", "get", "give", "see", "every", "some"]);
const PLACE_MARKERS = new Set(["in", "at", "near", "from", "around", "within", "across"]);

/** What an event-set query asks for (every part optional). */
export interface EventQuery {
  /** The event words typed, singular ("meet"). */
  kinds: string[];
  time: SearchTime | null;
  /** A calendar year ("2024": events held in 2024). */
  year: number | null;
  /** A season written as one ("2023-24": season 2023). */
  season: number | null;
  region: Region | null;
  /** Words after "at"/"in" that aren't a region: a city or a venue ("River dell high school"). */
  where: string | null;
  /** Other words: each must be in the event's name, city, venue or code ("Edison Division", "Houston"). */
  words: string[];
  /** The words typed for the region when they were a near miss of its name ("new jesey"). */
  regionTyped?: string;
  /** Every season, newest first: a championship asked for with no year, season or time. */
  allSeasons?: boolean;
}

/** The region `ws` (whole words) names exactly, if any. A two-letter code that's also a word counts only in capitals. */
export function regionOf(ws: string[]): Region | null {
  const text = ws.join(" ").trim();
  if (!text) return null;
  if (/^[a-z]{2}$/i.test(text) && !/^[A-Z]{2}$/.test(text) && WORD_CODES.has(text.toLowerCase())) return null;
  const f = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return findRegions(text).find((r) => r.name.toLowerCase() === f || (f.length === 2 && r.state.toLowerCase() === f && (r.country === "USA" || r.country === "Canada"))) ?? australianCode(text);
}

/** An Australian state's own three-letter code ("NSW", "QLD"): the ones no US or Canadian code shares. "VIC", "TAS"
 *  and "ACT" are words too, so only in capitals. (SA, WA and NT are US or Canadian codes as well: their names only.) */
function australianCode(text: string): Region | null {
  const code = /^(?:nsw|qld)$/i.test(text) ? text.toUpperCase() : /^(?:VIC|TAS|ACT)$/.test(text) ? text : null;
  if (!code) return null;
  const r = findRegions(regionLabel(`Australia:${code}`)).find((x) => x.key === `Australia:${code}`);
  return r ?? null;
}

/** The event set a query asks for, or null when it isn't one (the rules are at the top of this file). */
export function readEventQuery(raw: string): EventQuery | null {
  let q = singularize(raw.trim().replace(/[?!,;]/g, " ").replace(/\s+/g, " ").trim());
  if (!q || /\s(?:vs\.?|versus|v\.?|against)\s/i.test(` ${q} `)) return null;
  let time: SearchTime | null = null;
  const t = timePhrase(q);
  if (t) { time = TIME_OF[t.phrase] ?? null; q = t.rest; }
  let year: number | null = null, season: number | null = null;
  const y = /(?:^|\s)(20\d\d)(?:\s*[-–/]\s*(\d\d(?:\d\d)?))?(?=\s|$)/.exec(q);
  if (y) {
    // "2024-25" and "2024–2025" are the season that starts in 2024.
    if (y[2] && (y[2].length === 2 ? (Number(y[1]) + 1) % 100 : Number(y[1]) + 1) === Number(y[2])) season = Number(y[1]);
    else if (!y[2]) year = Number(y[1]);
    if (season != null || year != null) q = `${q.slice(0, y.index)} ${q.slice(y.index + y[0].length)}`.replace(/\s+/g, " ").trim();
  }
  // Any other number (a team, a match) isn't an event set.
  if (/\d/.test(q)) return null;
  // A page of an event ("New Jersey Championship rankings") or a season in words ("last season") is read elsewhere
  // (./search.ts SEARCH_TOPICS, server/api/searchIntents.ts): not a set of events.
  const lowerQ = ` ${q.toLowerCase()} `;
  if (SEARCH_TOPICS.some(([t]) => lowerQ.includes(` ${t} `)) || /\s(?:last|this|next|previous)\s+(?:season|year)\s/.test(lowerQ)) return null;
  const tokens = q.split(" ").filter(Boolean);
  const kinds: string[] = [], rest: string[] = [];
  for (const w of tokens) (Object.hasOwn(EVENT_TYPES, w.toLowerCase()) ? kinds : rest).push(w);
  // "states" with a place is its championship ("nj states", "states in new jesey"), read before the place so a near
  // miss of it is tried too; never corrected to "stats". Without a place it names nothing (dropped below).
  // Beside a generic event word too ("NJ states events").
  const statesOnly = kinds.every((k) => EVENT_TYPES[k.toLowerCase()] === null) && /(?:^|\s)states(?=\s|$)/i.test(raw) && !/united\s+states/i.test(raw);
  if (statesOnly) kinds.push("championship");
  let region: Region | null = null, regionTyped: string | undefined;
  const where: string[] = [], words: string[] = [];
  for (let i = 0; i < rest.length;) {
    if (PLACE_MARKERS.has(rest[i].toLowerCase()) && i + 1 < rest.length) {
      let j = i + 1;
      while (j < rest.length && !PLACE_MARKERS.has(rest[j].toLowerCase())) j++;
      // Leading little words go ("in the Northern Territory"); those inside a name stay ("District of Columbia").
      let k = i + 1;
      while (k < j && STOPWORDS.has(rest[k].toLowerCase()) && !isRegionCode(rest[k])) k++;
      const full = rest.slice(k, j);
      // The longest leading run of words that's a region, its own little words kept ("District of Columbia");
      // what's left of the segment, little words out, is a city or venue.
      let n = Math.min(full.length, 5), r: Region | null = null;
      for (; n >= 1; n--) if ((r = regionOf(full.slice(0, n)))) break;
      // A near miss of a place's full name ("meets in new jersy"), when the query names a kind of event.
      if (!r && !region && kinds.length) for (n = Math.min(full.length, 4); n >= 1; n--) if ((r = nearRegion(full.slice(0, n).join(" ")))) { regionTyped = full.slice(0, n).join(" ").toLowerCase(); break; }
      const tail = (k: number) => full.slice(k).filter((x) => !STOPWORDS.has(x.toLowerCase()));
      if (r && !region) { region = r; if (tail(n).length) where.push(tail(n).join(" ")); } else if (tail(0).length) where.push(tail(0).join(" "));
      i = j;
    } else words.push(rest[i++]);
  }
  // A region named bare ("NJ state championship", "New Jersey meets").
  for (let a = 0; !region && a < words.length; a++) for (let n = Math.min(5, words.length - a); n >= 1; n--) {
    const r = regionOf(words.slice(a, a + n));
    if (r) { region = r; words.splice(a, n); break; }
  }
  // A near miss of a place's full name ("new jesey states"), when the query names a kind of event.
  for (let a = 0; !region && kinds.length && a < words.length; a++) for (let n = Math.min(4, words.length - a); n >= 1; n--) {
    const r = nearRegion(words.slice(a, a + n).join(" "));
    if (r) { region = r; regionTyped = words.slice(a, a + n).join(" ").toLowerCase(); words.splice(a, n); break; }
  }
  // "state" beside a region says nothing more: "NJ state championship" is New Jersey's championship.
  // "next" before an event word means upcoming ("when is the next meet in NJ"); a question's own words name nothing.
  if (!time && kinds.length && words.some((w) => /^next$/i.test(w))) time = "upcoming";
  if (statesOnly && !region) kinds.pop();
  const named = words.filter((w) => { const l = w.toLowerCase(); return !STOPWORDS.has(l) && !QUESTION_WORDS.has(l) && !FRAME_WORDS.has(l) && !(region && /^(?:states?|champs?)$/i.test(w)); });
  // A question about the events ("who will win the NJ championship", "who won Inspire at …") or an action word
  // ("winner", "advance") asks something of them, read elsewhere: not the set of events itself.
  if (named.some((w) => ASKS.has(w.toLowerCase())) || (named.length && isQuestionForm(raw))) return null;
  const scoped = !!(time || year != null || season != null || region || where.length);
  if (!(kinds.length && scoped) && !(time && (region || where.length))) return null;
  const ks = [...new Set(kinds.map((k) => (/^champs?$/i.test(k) ? "championship" : k.toLowerCase())))];
  // Championships (one a season) by the types the words mean: "championship events in NJ" is still championships.
  const types = eventTypesOf(ks);
  const allSeasons = !!types && types.every((t) => t === "Championship" || t === "FIRSTChampionship") && !time && year == null && season == null;
  return { kinds: ks, time, year, season, region, where: where.join(" ") || null, words: named, ...(regionTyped ? { regionTyped } : {}), ...(allSeasons ? { allSeasons } : {}) };
}

const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, a: string, c: string) => a + c.toUpperCase());

const TIME_LABEL: Record<SearchTime, string> = {
  upcoming: "Upcoming", past: "Past", "this-weekend": "This weekend's", "next-weekend": "Next weekend's", "this-week": "This week's",
  "next-week": "Next week's", "this-month": "This month's", "next-month": "Next month's",
};

/** "Upcoming league meets in New Jersey at River Dell High School": the event set as understood, in words, never an
 *  event's name. `where`: the venue or city as the data spells it, when it matched (else the words typed).
 *  `drop`: parts left out (a fallback's label). */
export function eventSetLabel(e: EventQuery, opts: { where?: { text: string; city: boolean } | null; seasonLabel?: (s: number) => string; drop?: ("where" | "time")[] } = {}): string {
  const drop = new Set(opts.drop ?? []);
  const kind = e.kinds.length === 1 ? EVENT_LABEL[e.kinds[0]] : "Events";
  const time = e.time && !drop.has("time") ? TIME_LABEL[e.time] : null;
  const what = time ? `${time} ${kind.toLowerCase()}` : kind;
  const words = e.words.length ? ` matching "${e.words.join(" ")}"` : "";
  const place = e.region ? ` in ${e.region.name}${e.regionTyped ? ` (from "${e.regionTyped}")` : ""}` : "";
  const where = e.where && !drop.has("where") ? (opts.where ? ` ${opts.where.city ? "in" : "at"} ${opts.where.text}` : ` at ${titleCase(e.where)}`) : "";
  const when = e.season != null ? `, ${opts.seasonLabel ? opts.seasonLabel(e.season) : e.season}` : e.year != null ? ` held in ${e.year}` : e.allSeasons ? ", every season" : "";
  return `${what}${words}${place}${where}${when}`;
}

/**
 * The date window a time word means, from `today` (YYYY-MM-DD, the UTC date). Null bounds are open; an event is in
 * the window when any of its dates is.
 *   upcoming      today on (an event under way counts)          past        before today
 *   this-weekend  the coming Saturday and Sunday, Monday–Saturday; on a Sunday, the weekend under way (yesterday, today)
 *   next-weekend  the weekend after that                          this-week   this Monday to Sunday (weeks run Monday–Sunday)
 *   next-week     the next Monday to Sunday                       this-month  the whole calendar month
 *   next-month    the whole next calendar month
 */
export function timeWindow(time: SearchTime, today: string): { from: string | null; to: string | null } {
  const d = new Date(`${today}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  const add = (n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const toSat = day === 0 ? -1 : 6 - day, toSun = day === 0 ? 0 : 7 - day;
  const iso = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m, dd)).toISOString().slice(0, 10);
  switch (time) {
    case "upcoming": return { from: today, to: null };
    case "past": return { from: null, to: add(-1) };
    case "this-weekend": return { from: add(toSat), to: add(toSun) };
    case "next-weekend": return { from: add(toSat + 7), to: add(toSun + 7) };
    case "this-week": return { from: add(day === 0 ? -6 : 1 - day), to: add(toSun) };
    case "next-week": return { from: add(toSun + 1), to: add(toSun + 7) };
    case "this-month": return { from: iso(d.getUTCFullYear(), d.getUTCMonth(), 1), to: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) };
    case "next-month": return { from: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), to: iso(d.getUTCFullYear(), d.getUTCMonth() + 2, 0) };
  }
}

/** The FIRST types a query's event words allow, or null for any: a more specific word narrows a broader one ("league
 *  meet" is LeagueMeet, never LeagueTournament), and "event" or "competition" beside a kind adds nothing. */
export function eventTypesOf(kinds: string[]): string[] | null {
  const sets = kinds.map((k) => (Object.hasOwn(EVENT_TYPES, k) ? EVENT_TYPES[k] : null)).filter((t): t is string[] => !!t);
  if (!sets.length) return null;
  const both = sets.reduce((a, b) => a.filter((t) => b.includes(t)));
  return both.length ? both : [...new Set(sets.flat())];
}
