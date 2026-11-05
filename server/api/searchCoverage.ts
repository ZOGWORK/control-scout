// Phrasings people type that the other readers miss, so a search never ends on an empty page when the words say
// clearly what they want (docs/search.md). Fixed rules, no model; every number is from the stored data.
//   rewrites   "compare 12345 and 67890", "is 12345 better than 67890", "12345 67890"   → "12345 vs 67890" (Compare)
//              "who would win 12345 or 67890"                                       → "12345 vs 67890 who wins" (Predict)
//              "is 67890 good"                                                     → "how good is 67890"
//              "predict 12345 next games"                                          → "will 12345 win their next match"
//              "teams near Hackettstown"                                          → "teams in Hackettstown"
//              "north jersey", "south jersey", "central jersey"                   → New Jersey (said so in the label)
//              "top ranked team", "best team in ftc"                              → the world leaderboard
//   explains   "what is OPR", "how is OPR calculated", "what is DECODE", "game manual" → the page that explains it
//   counts     "how many teams in NJ", "how many events this season"            → the count, from the stored data
//   Worlds     "where is worlds", "worlds 2026", "worlds divisions"             → the FIRST Championship's events
//   an event's page  "nj states rankings", "match 12 at nj states"             → that event's tab or match
//   a team, kept     "12345 alliance partners", "bad wolf robotics"             → the team, never "no results"
import type { SearchAnswer, SearchCardFact, SearchCardLine, SearchHit, SearchSection } from "../../src/shared/api.js";
import type { TeamTable } from "../../src/shared/teamTable.js";
import { PHASE_COLS, tableOf, tableRow } from "./teamTableRows.js";
import { SEARCH_BROWSE, pagesFor } from "../../src/shared/search.js";
import { readEventQuery, regionOf, regionPartOf, type EventQuery } from "../../src/shared/searchEventQuery.js";
import { num, seasonLabel } from "../../src/shared/format.js";
import { stateName } from "../../src/shared/regions.js";
import { teamNameOf } from "../../src/shared/teamTitle.js";
import { CURRENT_SEASON, SEASONS } from "../data/seasons.js";
import { all, get } from "../db.js";
import { RANKED_MIN_MATCHES } from "../../src/shared/rankings.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { searchSeason } from "./answers/season.js";
import { RECORD_TYPES } from "./searchHighScores.js";
import { allowedEdits, editDistance, normalize } from "./fuzzy.js";
import { search } from "./search.js";
import { names } from "./query/names.js";
import { parseContext } from "./query/context.js";
import { seasonStats } from "./teams.js";
import { REGION_RULESETS, pointsSystem } from "../data/roadmapRules.js";
import { FORECAST_RUNS } from "../../src/shared/projections.js";
import { FITTED_MODEL } from "@control-scout/predict-engine";
import { eventHit, eventSetAnswer } from "./searchEvents.js";
import { BOARD_STATS, teamsHref } from "./answers/families/leaderboard.js";
import { countryOf } from "../../src/shared/countries.js";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const TEAM = String.raw`(\d{1,6}|[a-z0-9][\w'’&.-]*(?:\s+[\w'’&.-]+){0,4})`;
/** A leaderboard's stat, as readLeaderboard (answers/read.ts) reads it after "teams by". */
const BOARD = String.raw`(opr|auto opr|auto|teleop opr|teleop|endgame opr|endgame|win rate|prediction rating|rating)`;
/** A season said at the end of a query. */
const SEASON_WORDS = String.raw`(last season|last year|previous season|this season|this year|20\d\d\s*[-–/]\s*\d\d)`;
/** Words that name a kind of event ("new jersey championship", "nj states"). */
const EVENT_WORDS = /\b(?:championships?|champs|qualifiers?|quals|meets?|league|premier|states|tournaments?|scrimmages?|division|invitational|worlds)\b/;
/** A bare kind of thing with no place ("teams", "events"), as search singularizes it. */
const BARE_KIND = /^(?:(?:upcoming|ftc|all|the)\s+)*(teams?|events?|meets?|competitions?|tournaments?|qualifiers?|scrimmages?)$/;

/** A game's name ("decode", "into the deep", any spacing) or a season written as one ("2025-26") in `t`: the season
 *  as search reads one ("2025-26"), and `t` without it. `game` when it was a game's name. */
function seasonWord(t: string, typos = false): { season: string; rest: string; game: boolean } | null {
  const cut = (g: RegExpExecArray) => squash(t.slice(0, g.index) + " " + t.slice(g.index + g[0].length));
  const label = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  for (const s of SEASONS) {
    const g = new RegExp(`(?:^|\\s)(?:in\\s+|during\\s+)?(?:the\\s+)?${[...s.game.toLowerCase().replace(/\s+/g, "")].join("\\s*")}(?:\\s+season)?(?=\\s|$)`).exec(t);
    if (g) return { season: label(s.season), rest: cut(g), game: true };
  }
  // A one-word game's name misspelled ("dcode"), within search's own edit allowance: only where the caller has said
  // the query names an event.
  if (typos) for (const s of SEASONS) {
    const game = s.game.toLowerCase();
    if (/\s/.test(game)) continue;
    // By word position, never as a pattern: the typed word may hold "$" or "(".
    const ws = t.split(" ");
    const i = ws.findIndex((x) => x.length >= 5 && x !== game && /^[a-z]+$/.test(x) && editDistance(x, game) <= allowedEdits(game.length));
    if (i >= 0) {
      const from = i > 0 && /^(?:in|during)$/.test(ws[i - 1]) ? i - 1 : i;
      return { season: label(s.season), rest: squash([...ws.slice(0, from), ...ws.slice(i + 1)].join(" ")), game: true };
    }
  }
  const y = /(?:^|\s)(?:in\s+)?(20\d\d)\s*[-–/]\s*(\d\d)(?=\s|$)/.exec(t);
  return y && (Number(y[1]) + 1) % 100 === Number(y[2]) ? { season: `${y[1]}-${y[2]}`, rest: cut(y), game: false } : null;
}

/** A query said another way that the readers already answer, and why; or null. `q` is cleaned, any case. `pre`: tried
 *  before the stat answers, whose readers would take the original the wrong way ("have 12345 and 67890 played each other"
 *  read "67890 played each other" as a team's name). */
/** The direction-and-region words in `q` that name something stored ("East Brunswick", a town; "North Texas
 *  Championship", an event): rewriteQuery keeps them as typed. Nothing to look up unless a direction word is there. */
export async function namedParts(q: string): Promise<Set<string>> {
  const ws = squash(q.toLowerCase()).split(" "), out = new Set<string>();
  if (!ws.some((w) => regionPartOf([w, "jersey"]))) return out;
  const [idx, ctx] = await Promise.all([names(), parseContext()]);
  for (let i = 0; i + 1 < ws.length; i++) {
    for (const len of [3, 2]) {
      const part = ws.slice(i, i + len);
      if (part.length < len || !regionPartOf(part)) continue;
      let named = idx.place(part.join(" "))?.kind === "city";
      // The part and the words after it, as far as an event's name could run.
      for (let k = i + len; !named && k <= Math.min(ws.length, i + len + 3); k++) named = await ctx.isEvent(ws.slice(i, k).join(" "));
      if (named) out.add(part.join(" "));
    }
  }
  return out;
}

export function rewriteQuery(q: string, named: ReadonlySet<string> = new Set()): { q: string; note?: string; pre?: true } | null {
  const t = squash(q.toLowerCase());
  let m: RegExpExecArray | null;
  // Whether two teams have met: their head-to-head (every match they played on opposite alliances).
  if ((m = new RegExp(`^(?:have|has|did)\\s+${TEAM}\\s+(?:and|&)\\s+${TEAM}\\s+(?:ever\\s+)?(?:played|faced|met|play|face|meet)(?:\\s+(?:each other|one another|before|against each other))?$`).exec(t))
    || (m = new RegExp(`^(?:have|has|did)\\s+${TEAM}\\s+(?:ever\\s+)?(?:played|faced|met|play|face|meet)\\s+(?:against\\s+)?${TEAM}$`).exec(t))) return { q: `${m[1]} vs ${m[2]} head to head`, pre: true };
  // A team at a state championship by its short name ("12345 record at nj states", "12345 match 12 at nj states"):
  // that state's championship among the team's events.
  if ((m = /^(\d{1,6}(?:\s+vs\.?\s+\d{1,6})?)\s+(.*?)\s*\b(?:at|in)\s+(?:the\s+)?(.+?)\s+(?:states|state championships?|state champs|championship)$/.exec(t)) && regionOf(m[3].split(" "))) {
    const r = regionOf(m[3].split(" "))!;
    return { q: squash(`${m[1]} ${m[2]} at ${r.name} championship`), pre: true };
  }
  // A leaderboard of a season named ("top opr last season", "best auto opr in nj 2024-25", "best auto in decode"): the
  // leaderboard's own phrasing, so "top" and "best" are never read as a team's name (Top Shelf BGS, We are the best).
  {
    const g = seasonWord(t);
    const rel = g ? null : new RegExp(`\\s+(?:in\\s+|for\\s+|during\\s+)?${SEASON_WORDS}$`).exec(t);
    const bt = g ? g.rest : rel ? t.slice(0, rel.index) : null;
    const when = g ? g.season : rel?.[1];
    if (bt != null && (m = new RegExp(`^(?:the\\s+)?(?:top|best|highest|strongest)(?:\\s+(\\d{1,2}))?\\s+(?:scoring\\s+)?${BOARD}(?:\\s+teams?)?(?:\\s+(?:in\\s+|from\\s+)?(.+?))?(?:\\s+(?:in|for|during))?$`).exec(bt))) {
      const place = m[3] ? regionOf(m[3].split(" ")) : null;
      if (!m[3] || place) return { q: squash(`top ${m[1] ?? 10} teams by ${m[2]}${place ? ` in ${place.name}` : ""} ${when}`), pre: true };
    }
  }
  // A place's events with the season said in words ("events this season in New Jersey", "meets last season in nj"):
  // the season written as one, which the event readers read. "This season" is the default season (the latest
  // completed one, ./answers/season.ts), "last season" the one before it. Never a team's (a number) or a place-less set.
  const rel = /(?:^|\s)(?:in\s+|during\s+|for\s+)?(?:the\s+)?(this|current|last|previous|past)\s+season(?=\s|$)/.exec(t);
  if (rel && !/\d/.test(t)) {
    const s = searchSeason() - (/^(?:last|previous|past)$/.test(rel[1]) ? 1 : 0);
    const out = squash(`${t.slice(0, rel.index)} ${t.slice(rel.index + rel[0].length)} ${s}-${String((s + 1) % 100).padStart(2, "0")}`);
    const e = readEventQuery(out);
    if (e && (e.region || e.where)) return { q: out, pre: true };
  }
  // An event's best score, "at" or not ("highest score new jersey championship", "nj states highest score"). A
  // place's "states" is its championship, never another event with the place in its name (a workshop).
  // A season or game named with it ("nj states highest score decode") stays, said as a season.
  const sw = seasonWord(t), ht = sw ? sw.rest : t;
  if (((m = /^(?:the\s+)?(?:highest|best|top|record|max(?:imum)?)\s+(?:match\s+)?scores?\s+(?!(?:of|for|this|last)\s)(?:(?:at|in)\s+)?(?:the\s+)?(.+)$/.exec(ht))
    || (m = /^(.+?)\s+(?:highest|best|top|record)\s+(?:match\s+)?scores?$/.exec(ht))) && EVENT_WORDS.test(m[1]) && !/^\d/.test(m[1])) {
    const st = /^(.+?)\s+(?:states|state championships?|state champs)$/.exec(m[1]);
    const r = st ? regionOf(st[1].split(" ")) : null;
    // "Worlds" is the FIRST Championship (never a "Pre Worlds" scrimmage).
    const at = r ? `${r.name.toLowerCase()} championship` : /^(?:worlds|world championships?)$/.test(m[1]) ? "first championship" : m[1];
    const out = `highest score at ${at}${sw ? ` ${sw.season}` : ""}`;
    if (out !== t) return { q: out, pre: true };
  }
  // An event named with a game's name ("nj states decode", "worlds edison division centerstage"): that game's season,
  // written as one ("nj states 2025-26"), which the event readers already read. Never for a team's number (the rule
  // further down) or a game named alone ("what is decode").
  const swt = sw ?? (EVENT_WORDS.test(t) && !/^\d{1,6}\b/.test(t) ? seasonWord(t, true) : null);
  if (swt && swt.game && !/^\d{1,6}\b/.test(t) && EVENT_WORDS.test(swt.rest)) return { q: `${swt.rest} ${swt.season}`, pre: true };
  // "events", "events this season", "events ths": the season's events, never teams named "Event Horizon".
  if ((m = /^(?:all\s+)?(?:the\s+)?(?:ftc\s+)?(events?|meets?|competitions?|tournaments?)(?:\s+(?:this|ths|tis|thsi|current)(?:\s+(?:season|year))?)?$/.exec(t))) {
    return { q: `${m[1].replace(/s?$/, "s")} in ${seasonLabel(CURRENT_SEASON).replace("–", "-")}`, pre: true };
  }
  // A question opened with filler ("so like what was 12345 last game"): the question.
  if ((m = /^(?:(?:so|like|um+|uh+|ok|okay|hey|yo|bro)\s+)+((?:what|who|when|where|how|which|is|are|did|does|has|have)\b.+|\d{1,6}\b.+)$/.exec(t))) return { q: m[1], pre: true };
  // A team's matches "in" an event, said as "at" ("12345 matches in worlds").
  if ((m = /^(\d{1,6})\s+(matches|match|games?|record)\s+in\s+(worlds|first championship|world championships?)$/.exec(t))) return { q: `${m[1]} ${m[2]} at worlds`, pre: true };
  // "When did hypnotic last play", "when did 12345 play last", "when did they last compete": the team's most recent match.
  if ((m = new RegExp(`^when\\s+(?:did|was|were)\\s+${TEAM}\\s+(?:last\\s+(?:play|played|compete|competed|playing|competing)|(?:play|compete)\\s+last)$`).exec(t))) return { q: `${m[1]} last match`, pre: true };
  // No-shows and disqualifications are counted in the team's reliability.
  if ((m = /^(\d{1,6})\s+(?:no[\s-]?shows?|dqs?|disqualifications?|disqualified)$/.exec(t))) return { q: `${m[1]} reliability`, note: "no-shows and disqualifications are counted in reliability", pre: true };
  // A team's penalties, said the short way: the points it gave away, event by event.
  if ((m = /^(\d{1,6})\s+(?:penalties|penalty|penalty points|fouls|fouls given|penalties given)$/.exec(t))) return { q: `${m[1]} penalty points given`, pre: true };
  // "Best match" and "worst match" by their score; "best event" by where it finished.
  if ((m = /^(\d{1,6})\s+(best|top|greatest)\s+(?:match|game)(?:es)?$/.exec(t))) return { q: `${m[1]} highest score`, note: "the best match is read as the highest-scoring one", pre: true };
  if ((m = /^(\d{1,6})\s+(?:worst)\s+(?:match|game)(?:es)?$/.exec(t))) return { q: `${m[1]} lowest score`, note: "the worst match is read as the lowest-scoring one", pre: true };
  if ((m = /^(\d{1,6})\s+(?:best|top|greatest)\s+(?:event|competition|tournament)s?$/.exec(t))) return { q: `${m[1]} best finish`, note: "the best event is read as the best finish", pre: true };
  // A team's partners and opponents: who it played with (or against) most often, every one counted.
  if ((m = /^(\d{1,6})\s+(?:alliance\s+)?(?:partners?|teammates?)$/.exec(t))) return { q: `${m[1]} most frequent partner`, pre: true };
  if ((m = /^(\d{1,6})\s+(?:opponents?|rivals?)$/.exec(t))) return { q: `${m[1]} most played opponent`, pre: true };
  // "This season" for a team's events is the default season, the latest completed one (./answers/season.ts).
  if ((m = /^(\d{1,6})\s+(?:events?|competitions?|tournaments?)\s+(?:this|current)\s+(?:season|year)$/.exec(t))) return { q: `${m[1]} events in ${seasonLabel(searchSeason()).replace("–", "-")}`, pre: true };
  // A team's world rank: by OPR, as on Rankings.
  if ((m = /^(\d{1,6})\s+(?:world|global|worldwide|overall)\s+(?:rank|ranking|standing)$/.exec(t))) return { q: `${m[1]} opr`, note: "the world rank by OPR; the prediction rating has its own (\"" + m[1] + " prediction rating\")", pre: true };
  // A team's rank in a place, said with the place first ("12345 nj rank").
  if ((m = /^(\d{1,6})\s+(.+?)\s+(?:rank|ranking|standing)$/.exec(t)) && regionOf(m[2].split(" "))) return { q: `${m[1]} rank in ${regionOf(m[2].split(" "))!.name}` };
  // A team's next match, asked as a win chance.
  if ((m = /^(\d{1,6})\s+(?:win\s+(?:probability|chance|odds)|chance of winning|odds)\s+(?:in\s+|for\s+)?(?:the\s+|their\s+)?next\s+(?:match|game)$/.exec(t))) return { q: `will ${m[1]} win their next match` };
  // An award at an event, asked without "who won": "connect award nj states", "design award winners at nj states".
  if ((m = /^(?:who won\s+)?(?:the\s+)?(inspire|think|innovate|design|motivate|connect|control|reach|sustain|compass|promote|judges)(?:\s+award)?(?:\s+winners?)?\s+(?:at\s+|in\s+)?(.+)$/.exec(t)) && !/^who won (?:the )?\w+ at /.test(t)) {
    if (readEventQuery(squash(m[2])) || /\b(?:states|championship|qualifier|meet|league|premier|division)\b/.test(m[2])) return { q: `who won ${m[1]} at ${m[2]}` };
  }
  // A team number with its home state after it ("67890 texas"): one team, the place adds nothing.
  if ((m = /^(\d{1,6})\s+(.+)$/.exec(t)) && regionOf(m[2].split(" ")) && regionOf(m[2].split(" "))!.name.toLowerCase() === m[2]) return { q: m[1], note: `a team number names one team, so "${titleCase(m[2])}" is left out` };
  // Three or four team numbers side by side ("compare 12345 67890 16461", "compare 12345, 67890 and 16461"); Compare holds
  // four. Numbers only: a name may hold "and" ("Nuts and Bolts"), so names are compared with "vs", and two teams with a
  // word between them are the rule below's.
  if ((m = /^(?:compare|comparing|comparison of|compare teams?)\s+(\d{1,6}(?:(?:\s*,\s*|\s+)(?:(?:and|with|&|vs\.?|versus)\s+)?\d{1,6})+)$/.exec(t))) {
    const list = m[1].split(/[^\d]+/).filter(Boolean);
    // Bare numbers with only spaces may hold a year ("compare 12345 2024" is 12345's 2024 season); a list joined by
    // "and" or "vs" names teams.
    const bare = !/[^\d\s]/.test(m[1]);
    if ((list.length > 2 || bare) && list.length <= 4 && new Set(list).size === list.length && !(bare && list.some((n) => /^(?:19|20)\d\d$/.test(n)))) return { q: list.join(" vs ") };
  }
  // Two teams side by side, however it's asked.
  if ((m = new RegExp(`^(?:compare|comparing|comparison of|compare teams?)\\s+${TEAM}\\s+(?:and|with|to|&|vs\\.?|versus)\\s+${TEAM}$`).exec(t))) return { q: `${m[1]} vs ${m[2]}` };
  if ((m = new RegExp(`^(?:is|are)\\s+${TEAM}\\s+(?:better|stronger|worse|weaker)\\s+than\\s+${TEAM}$`).exec(t))) return { q: `${m[1]} vs ${m[2]}` };
  if ((m = new RegExp(`^(?:who|which(?: team)?)\\s+(?:is|s|'s)\\s+(?:better|stronger)\\s*:?\\s+${TEAM}\\s+(?:or|and|vs\\.?)\\s+${TEAM}$`).exec(t))) return { q: `${m[1]} vs ${m[2]}` };
  if ((m = new RegExp(`^who\\s+(?:would|will|is going to|wins)\\s*(?:win)?\\s+(?:between\\s+)?${TEAM}\\s+(?:or|and)\\s+${TEAM}$`).exec(t))) return { q: `${m[1]} vs ${m[2]} who wins` };
  if ((m = new RegExp(`^${TEAM}\\s+(?:or|and)\\s+${TEAM}\\s+(?:who wins|who would win|who will win|which is better|who is better)$`).exec(t))) return { q: `${m[1]} vs ${m[2]}${/win/.test(t) ? " who wins" : ""}` };
  // Two numbers are two teams, unless one is a year ("12345 2024" and "2024 12345" are 12345's 2024 season).
  const year = (n: string) => /^(?:19|20)\d\d$/.test(n);
  if ((m = /^(\d{1,6})(?:\s*[,&]\s*|\s+(?:and\s+|or\s+)?)(\d{1,6})$/.exec(t)) && m[1] !== m[2] && year(m[1]) === year(m[2])) return { q: `${m[1]} vs ${m[2]}` };
  // A team's quality, asked the short way.
  if ((m = /^(?:is|are)\s+(.+?)\s+(?:any\s+|really\s+|actually\s+)?(?:good|strong|decent|competitive|any good)$/.exec(t))) return { q: `how good is ${m[1]}` };
  // A team's next match, asked as a prediction.
  if ((m = /^(?:predict(?:ion for|ions for)?|forecast)\s+(.+?)(?:'s|s)?\s+next\s+(?:match|matches|game|games)$/.exec(t))) return { q: `will ${m[1]} win their next match` };
  // The world leaderboard, asked other ways.
  if (/^(?:the\s+)?(?:top|highest)[\s-]+ranked\s+(?:team|teams|robot|robots)(?:\s+in\s+(?:ftc|the world))?$/.test(t)) return { q: "top teams" };
  // A leader asked "in the world", "in FTC", "this season": the scope says nothing more (the season is the current one).
  if ((m = /^(.*\b(?:best|top|strongest|highest|most)\b.*?)\s+(?:in\s+(?:ftc|first tech challenge|the world)|worldwide|globally|overall|this season|this year|right now|currently)$/.exec(t))) return { q: m[1] };
  // "Near" a town is in it: there's no distance on record.
  if ((m = /^(.*\bteams?)\s+(?:near|around|close to|by)\s+(?!(?:me|us)$)(.+)$/.exec(t))) return { q: `${m[1]} in ${m[2]}`, note: `Teams in ${titleCase(m[2])} (no distances are on record, so "near" reads as "in")` };
  // Who won Worlds, asked by a year said in words, by the season's game, or as "worlds winners".
  // "This year" and "last year" are the stat answer's own (answers/families/winners.ts, the owner's rule): the current
  // season, and the latest championship that has finished.
  // A bare year is the Worlds held that year ("who won worlds 2025": April 2025, the 2024–25 season's).
  if ((m = /^(?:who won (?:the )?(?:worlds|first championship|world championships?)|(?:worlds|world) (?:winners?|champions?)) (20\d\d)$/.exec(t))) {
    const held = Number(m[1]);
    return { q: `who won worlds ${held - 1}-${String(held % 100).padStart(2, "0")}` };
  }
  if ((m = /^(?:(.+?)\s+)?(?:world |worlds |first championship )?(?:champions?|winners?|world champions?)$/.exec(t)) && m[1] && gameSeason(m[1])) {
    const s = gameSeason(m[1])!;
    return { q: `who won worlds ${s.label.replace("–", "-")}`, note: `${s.game} is ${s.label}: its FIRST Championship` };
  }
  if ((m = /^(?:worlds|first championship|world championships?) (?:winners?|champions?)(?:\s+(20\d\d(?:\s*-\s*\d\d)?))?$/.exec(t))) return { q: `who won worlds${m[1] ? ` ${m[1]}` : ""}` };
  if ((m = /^(.+?\s+division)\s+(?:winners?|champions?)$/.exec(t))) return { q: `who won ${m[1]}` };
  if ((m = /^(.+?\s+(?:states|state championship|championship|regional))\s+(?:winners?|champions?)$/.exec(t))) return { q: `who won ${m[1]}` };
  // A place's Inspire Award winners: its state championship's, the one with the place in it.
  if ((m = /^(?:the\s+)?inspire(?: award)? (?:winners?|winner list)(?: (?:in|from|at))? (.+)$/.exec(t)) && regionOf(m[1].split(" "))) {
    return { q: `who won inspire at ${m[1]} states`, note: `the Inspire Award at the ${regionOf(m[1].split(" "))!.name} championship` };
  }
  // A team's Worlds or states history, asked with no verb: "12345 worlds", "bad wolf states history".
  if ((m = /^(.+?)\s+(worlds|states|state championships?|first championship)(?:\s+(?:history|appearances|record|results))?$/.exec(t)) && !regionOf(m[1].split(" ")) && !readEventQuery(squash(q))?.region
    && !/\b(?:meets?|events?|teams?|top|best|who|when|where|q|quals?|qualification|match(?:es)?|finals?|semis?|playoffs?|rankings?|awards?|will|did|does|do|can|has|have|advance|qualify|go|went|make|to|at|in|for)\b|\bq\d/.test(m[1])
    // "all state championships" lists them; "the bad wolf worlds" is still Bad Wolf's.
    && !/^(?:all|every|list|show)(?:\s|$)/.test(m[1]) && !/^(?:the|a|an)$/.test(m[1])) {
    return { q: `when did ${m[1]} go to ${/^worlds|first/.test(m[2]) ? "worlds" : "states"}` };
  }
  // A team's wins and awards: "has 12345 won an event" (its event wins and awards), "did 12345 win inspire", "12345 inspire".
  if ((m = /^(?:has|have|did)\s+(.+?)\s+(?:ever\s+)?(?:won|win)\s+(?:an?\s+|any\s+)?(?:event|events|tournament|competition|anything)$/.exec(t))) return { q: `has ${m[1]} won anything` };
  if ((m = /^(?:did|has)\s+(.+?)\s+(?:ever\s+)?(?:win|won|get|got)\s+(?:the\s+|an?\s+)?(inspire|think|innovate|design|motivate|connect|control|reach|sustain|compass)(?:\s+award)?$/.exec(t)) || (m = /^(\d{1,6})\s+(inspire|think|innovate|design|motivate|connect|control|reach|sustain|compass)(?:\s+awards?)?$/.exec(t))) return { q: `${m[1]} awards`, note: `the ${titleCase(m[2])} Award among their awards` };
  if ((m = /^(.+?)\s+(?:event wins|events won|tournament wins)$/.exec(t))) return { q: `has ${m[1]} won anything` };
  // A team's record, matches and seasons said other ways.
  if ((m = /^(\d{1,6})\s+(?:losses|career record|all[\s-]time record|overall record|win[\s-]loss(?: record)?|w[\s-]?l(?:[\s-]?t)?)$/.exec(t))) return { q: `${m[1]} record` };
  if ((m = /^(\d{1,6})\s+(?:total matches|match count|matches played|games played|all matches)$/.exec(t))) return { q: `${m[1]} matches` };
  if ((m = /^(\d{1,6})\s+(?:seasons(?: played)?|years(?: active)?|past seasons)$/.exec(t))) return { q: `${m[1]} history` };
  // A game's name after a team ("12345 decode", "12345 awards into the deep") is that season.
  for (const s of SEASONS) {
    const g = new RegExp(`^(\\d{1,6}|.+?)\\s+(?!in\\s)(.*?)\\b(${s.game.toLowerCase().split(" ").join("\\s*")})(?:\\s+season)?$`).exec(t);
    if (g && !/\b(?:in|during|the)\s*$/.test(`${g[1]} ${g[2]}`.trim()) && /^\d{1,6}$/.test(g[1])) return { q: squash(`${g[1]} ${g[2]} in ${s.game}`) };
  }
  // "My state", "near me": nothing on record says where the visitor is.
  // A bare "teams near me" or "events near me" is nearMeAnswer's: "teams" alone would match names ("Event Horizon").
  // A rookie list said without "in" ("rookie teams new jersey", "nj rookie teams").
  if (((m = /^rookies?(?:\s+teams?)?\s+(?!in\s|from\s)(.+)$/.exec(t)) || (m = /^(.+?)\s+rookies?(?:\s+teams?)?$/.exec(t))) && regionOf(m[1].split(" "))) return { q: `rookie teams in ${regionOf(m[1].split(" "))!.name.toLowerCase()}` };
  if ((m = /^(.+?)\s+(?:in my (?:state|area|region|city|town)|near me|around me|close to me|nearby)$/.exec(t)) && !BARE_KIND.test(m[1])) return { q: m[1], note: `where you are isn't known, so this is everyone's: add a place ("${m[1]} in NJ")` };
  // A part of a region ("north jersey", "northern california") names no region of its own: the whole region, said so.
  const ws = t.split(" ");
  for (let i = 0; i + 1 < ws.length; i++) {
    for (const len of [3, 2]) {
      // Never words of a whole region ("south wales" in New South Wales) or of a stored town or event.
      const whole = [1, 2].some((b) => i - b >= 0 && regionOf(ws.slice(i - b, i + len)));
      const part = i + len <= ws.length && !whole && !named.has(ws.slice(i, i + len).join(" ")) ? regionPartOf(ws.slice(i, i + len)) : null;
      if (part) return { q: [...ws.slice(0, i), part.region.name.toLowerCase(), ...ws.slice(i + len)].join(" "), note: `${titleCase(part.part)} isn't a separate region: all of ${part.region.name}` };
    }
  }
  return null;
}

const nameOf = (h: SearchHit) => `${teamNameOf(h.title)} (${h.ref})`;
const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, a: string, c: string) => a + c.toUpperCase());

const answer = (q: string, a: Omit<SearchAnswer, "q" | "step" | "weak"> & { step?: SearchAnswer["step"] }): SearchAnswer =>
  ({ q, step: "deterministic", weak: false, ...a });

type Explainer = { words: RegExp; label: string; lines: SearchCardLine[]; pages: { title: string; href: string }[] };

/** FIRST's own pages for the rules: lines link straight to them (the page's links and the box open a full URL as is). */
const OFFICIAL = { manual: "https://ftc-resources.firstinspires.org/ftc/game/manual", events: "https://ftc-events.firstinspires.org" };

/** How teams reach the FIRST Championship: only what the season's curated rules hold (server/data/roadmapRules.ts,
 *  read from FIRST's Competition Manual), and where to check the rest. A season with none encoded says so. */
const WORLDS_EXPLAINER: Explainer = (() => {
  const words = /^(?:how (?:does|do|is|are)\s+)?(?:the\s+)?(?:worlds|first championship|world championships?)\s+(?:qualification|qualifying|advancement|slots?)(?:\s+(?:work|works|decided|calculated|done))?$|^how (?:do|does|can) (?:teams?|you|a team|i|we) (?:qualify|advance|get|go|make it) (?:for|to|into) (?:the\s+)?(?:worlds|first championship|world championships?)$|^(?:how to )?qualify(?:ing)? (?:for|to) (?:the\s+)?(?:worlds|first championship|world championships?)$/;
  const ps = pointsSystem(CURRENT_SEASON);
  const S = seasonLabel(CURRENT_SEASON);
  const pages = [{ title: "How advancement works", href: "/methodology#advancement" }, { title: "Events", href: "/events" }];
  if (!ps) {
    return { words, label: "Worlds qualification", pages, lines: [
      { text: `Control Scout hasn't checked the ${S} advancement rules yet`, detail: "FIRST's Competition Manual (Section 4, Advancement) has the official rules", href: OFFICIAL.manual },
      { text: "Each event's advancement list is on FTC Events", detail: "FIRST's own results site", href: OFFICIAL.events },
    ] };
  }
  const regions = REGION_RULESETS.filter((r) => r.season === CURRENT_SEASON).map((r) => r.name);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
  return {
    words, label: `Worlds qualification: how teams reach the FIRST Championship (${S} rules)`, pages,
    lines: [
      { text: "Teams advance step by step: qualifiers or league tournaments, then a state or regional championship, then the FIRST Championship", detail: regions.length ? `A region's championship sends teams to the FIRST Championship or a Premier event. Control Scout has checked the path for ${list(regions)}` : "Each region sets its own path to its championship", href: "/methodology#advancement" },
      { text: "At each advancing event, slots go to teams in order of their advancement points", detail: `Inspire ${ps.inspire.join("/")}, other judged awards ${ps.otherAwards.join("/")}, playoff finish ${ps.playoff.first}/${ps.playoff.second}/${ps.playoff.third}/${ps.playoff.fourth}, qualification rank ${ps.qualMax} down to ${ps.qualMin}, plus alliance selection`, href: "/methodology#advancement" },
      { text: `A team can advance only from its first ${ps.entryEvents} qualifiers or league tournaments`, detail: `League tournament rankings add each team's best ${ps.leagueMeetMatches} league meet matches`, href: "/methodology#advancement" },
      { text: "How many slots each event has is set by FIRST and differs by region", detail: `Source: ${ps.source.label}, ${ps.where}`, href: ps.source.url },
      { text: "Each event's advancement list is on FTC Events", detail: "FIRST's own results site: who took each slot", href: OFFICIAL.events },
    ],
  };
})();

/** What a word means on Control Scout, and where it's explained. Only what the site's own pages say. */
const EXPLAINS: Explainer[] = [
  {
    words: /^(?:what(?:'s| is| does)?|how (?:is|do you|does)|explain|define|meaning of)?\s*(?:an?\s+)?opr\s*(?:mean|means|calculated|computed|worked out|work|stand for|meaning|definition)?$/,
    label: "OPR: what it is and how it's worked out",
    lines: [
      { text: "OPR estimates each robot's average contribution to its alliance's score", detail: "Solved from an event's qualification matches (plain least squares), with auto, TeleOp and endgame parts", href: "/methodology#opr" },
      { text: "Control Scout's OPR counts non-penalty points only", detail: "A team's season OPR is its best event OPR. Predictions use the rating instead", href: "/methodology#opr" },
    ],
    pages: [{ title: "How OPR is calculated", href: "/methodology#opr" }, { title: "Rankings", href: "/rankings" }],
  },
  {
    words: /^(?:what(?:'s| is| are| does)?|how (?:is|are|does))?\s*(?:the\s+)?(?:prediction\s+)?rating\s*(?:mean|calculated|work|worked out)?$/,
    label: "The prediction rating: how it's worked out",
    // As the methodology page says it (src/pages/MethodologyPage.tsx #rating, #rating-assumption), with the engine's own settings.
    lines: [
      { text: "A rating is the points a robot is expected to add to its alliance's score", detail: "In real game points, split into auto, TeleOp, endgame and the penalty points it gives away", href: "/methodology#rating" },
      { text: "It learns from alliance scores: after every match, the miss is split between the two robots", detail: "Each rating moves by a share of the miss (the gain), which starts high and shrinks as matches build up", href: "/methodology#rating" },
      { text: `Qualification matches count in full; a playoff match moves a rating ${Math.round(FITTED_MODEL.rating.playoffWeight * 100)}% as much`, detail: "Playoff partners stay the same every match, so their shares can't be told apart", href: "/methodology#rating-assumption" },
      { text: "The ± is the rating's uncertainty, and the rating drives every prediction", detail: "It shrinks with each match; last season's rank carries over a little", href: "/methodology#rating" },
    ],
    pages: [{ title: "How the rating works", href: "/methodology#rating" }],
  },
  {
    words: /^(?:what(?:'s| is)?|how (?:is|does))?\s*(?:an?\s+|the\s+)?reliability(?: index| score)?\s*(?:mean|calculated|work)?$/,
    label: "The reliability index: how it's worked out",
    // As the methodology page says it (#reliability).
    lines: [
      { text: "A 0–100 estimate of how dependable a robot has been, from qualification matches only", detail: "Higher is more dependable. Every team page shows its parts beside it", href: "/methodology#reliability" },
      { text: "It starts at 100 and loses points for each problem", detail: "No-shows, disqualifications, near-zero matches, swing, and penalties and misses against the season average", href: "/methodology#reliability" },
      { text: "Every part is pulled toward the season average, so a few matches can't make a team look perfect or broken", detail: "The weights are a stated rule, not fitted. A near-zero match is a hint, not proof of a dead robot", href: "/methodology#reliability" },
    ],
    pages: [{ title: "How reliability is worked out", href: "/methodology#reliability" }],
  },
  {
    words: /^(?:how (?:are|is|do you|does (?:control scout|the engine|it))\s+(?:the\s+)?(?:match\s+)?predictions?\s+(?:made|calculated|worked out|work|done)|how (?:does|do) (?:the\s+)?(?:predictions?|prediction engine|predictor) work|how (?:are|is) (?:the\s+)?(?:win\s+)?(?:odds|win (?:chances?|probabilit(?:y|ies))) (?:made|calculated|worked out))$/,
    label: "Predictions: how they're made",
    // As the methodology page says it (#overview, #matches, #advancement).
    lines: [
      { text: "The engine rates every robot from the matches it has played", detail: "Each rating is the points a robot adds to its alliance, updated after every match", href: "/methodology#rating" },
      { text: "A match's expected score is each alliance's robots added up, plus the penalties the other side tends to give away", detail: "Every expected score has a spread from game noise and how sure the ratings are", href: "/methodology#matches" },
      { text: "The win chance is how often one alliance's score lands above the other's", detail: "A learned correction (Prediction Engine 2.0) and a calibration step then make 70% mean 70%", href: "/methodology#matches" },
      { text: `Advancement odds come from playing the whole event ${FORECAST_RUNS.toLocaleString("en-US")} times`, detail: "Rankings, alliance selection, the bracket and the awards, under the season's real rules", href: "/methodology#advancement" },
      { text: "Every call is logged before the match, and replayed seasons are kept apart from live ones", detail: "The track record shows how often each engine version picked the winner", href: "/methodology#matches" },
    ],
    pages: [{ title: "How predictions are calculated", href: "/methodology" }, { title: "Prediction accuracy", href: "/methodology#matches" }],
  },
  {
    words: /^(?:how (?:does|do|is|are)\s+)?(?:the\s+)?(?:ftc\s+)?one\s+search(?:\s+(?:work|works|answer|answers|search))?$|^how (?:does|do|is) (?:this |the |control scout(?:'s)? )?search(?: engine| bar| box)? (?:work|works|answer(?: questions)?)$/,
    label: "How FTC One Search works",
    // As its own page says it (src/pages/SearchDocsPage.tsx, src/components/howitworks/searchDocs.ts).
    lines: [
      { text: "Fixed rules written in code, tried in a fixed order: the first that fits answers", detail: "Tidy the words, reword common phrasings, answer the question, find the events, find the team, event or match, and say so when nothing fits", href: "/how-it-works/search" },
      { text: "Answers come from Control Scout's stored FTC data, so the same query gives the same answer every time", detail: "Each answer states its season and what its number means. Search is not a machine-learning model", href: "/how-it-works/search" },
      { text: "When nothing fits, it says so and lists the closest matches, labelled", detail: "A closest match is never shown as if it were the answer", href: "/how-it-works/search" },
    ],
    pages: [{ title: "FTC One Search: how it works", href: "/how-it-works/search" }, { title: "FAQ", href: "/faq" }],
  },
  WORLDS_EXPLAINER,
  {
    words: /^(?:what(?:'s| is| are| does)?|how (?:are|do|does))?\s*(?:an?\s+|the\s+)?(?:rp|rps|ranking points?|ranking score)\s*(?:mean|calculated|work|worked out)?$/,
    label: "Ranking points: how they work",
    lines: [{ text: "Ranking points follow each season's real rules", detail: "2025–26 gives 3 for a win and 1 for a tie, plus bonus RPs; the tiebreaker is average non-penalty score", href: "/methodology#advancement" }],
    pages: [{ title: "How ranking points and advancement work", href: "/methodology#advancement" }, { title: "Rankings", href: "/rankings" }],
  },
  {
    words: /^(?:how (?:does|do|is)|what is)\s+(?:the\s+)?(?:advancement|teams? advance|advancing|qualifying|teams? qualify)(?:\s+(?:work|decided|calculated))?(?:\s+to\s+(?:states?|worlds|the championship))?$/,
    label: "Advancement: how teams move on, and the odds",
    lines: [{ text: "Advancing depends on rank, alliance selection, the bracket and the awards", detail: "The engine simulates the event thousands of times to give each team's odds", href: "/methodology#advancement" }],
    pages: [{ title: "How advancement works", href: "/methodology#advancement" }],
  },
  {
    words: /^(?:how (?:accurate|good|reliable|right) (?:are|is)(?: the)?|what is the accuracy of(?: the)?|track record of(?: the)?)\s+(?:predictions?|the predictions?|prediction engine|odds|forecasts?)$|^(?:prediction )?(?:accuracy|track record)$/,
    label: "How accurate the predictions are: the track record",
    lines: [{ text: "Each engine version is replayed on past matches it never trained on", detail: "The methodology page gives how often it picked the winner, and each version's change", href: "/methodology#matches" }],
    pages: [{ title: "Prediction accuracy", href: "/methodology#matches" }, { title: "Engine versions", href: "/methodology#versions" }],
  },
  {
    words: /^(?:what(?:'s| is)|whats)\s+(?:ftc|first tech challenge|the first tech challenge)$/,
    label: "FIRST Tech Challenge (FTC)",
    lines: [{ text: "FIRST Tech Challenge is FIRST's robotics competition for teams of students", detail: "Each season has a new game: teams play league meets, qualifiers and championships, up to the FIRST Championship", href: "/events" }],
    pages: [{ title: "Events", href: "/events" }, { title: "Rankings", href: "/rankings" }, { title: "FAQ", href: "/faq" }],
  },
  {
    words: /^(?:what(?:'s| is| are)|whats)\s+(?:an?\s+|the\s+)?(?:alliances?|alliance selection|alliance partners?)(?:\s+in\s+ftc)?$/,
    label: "Alliances: the two sides of every match",
    lines: [
      { text: "Every match is red against blue: two alliances of two teams each", detail: "In qualification matches the alliances are drawn by the schedule", href: "/events" },
      { text: "For the playoffs, the top-ranked teams pick their alliance partners", detail: "That's alliance selection: an event's Playoffs tab shows who picked whom", href: "/events" },
    ],
    pages: [{ title: "Events", href: "/events" }, { title: "Rules", href: "/rules" }],
  },
  {
    words: /^(?:what(?:'s| is| are)|whats)\s+(?:an?\s+|the\s+)?(?:league meets?|leagues?|league tournaments?)(?:\s+in\s+ftc)?$/,
    label: "League meets: a league's matches across the season",
    lines: [{ text: "In regions that play in leagues, teams meet several times over the season", detail: "Each meet's matches count toward the league's rankings, which lead to its league tournament", href: "/events" }],
    pages: [{ title: "Events", href: "/events" }],
  },
  {
    words: /^(?:what(?:'s| is| are)|whats)\s+(?:an?\s+|the\s+)?(?:qualifiers?|qualifying tournaments?|regionals?)(?:\s+in\s+ftc)?$/,
    label: "Qualifiers: the events teams advance from",
    lines: [{ text: "A qualifier is a tournament where teams compete to advance to their region's championship", detail: "Advancement comes from awards and playoff results", href: "/methodology#advancement" }],
    pages: [{ title: "Events", href: "/events" }, { title: "How advancement works", href: "/methodology#advancement" }],
  },
  {
    words: /^(?:what(?:'s| is| are)|whats)\s+(?:an?\s+|the\s+)?(?:inspire(?: award)?|ftc awards?|awards? in ftc|judged awards?)$/,
    label: "The Inspire Award and FTC's awards",
    lines: [
      { text: "The Inspire Award is FTC's top award, for the team judged the best all-round example of the program", detail: "Judges weigh the robot, the engineering portfolio and the team together", href: "/events" },
      { text: "Every event's Awards tab lists who won each award", detail: "Try \"who won inspire at nj states\"", href: "/events" },
    ],
    pages: [{ title: "Events", href: "/events" }],
  },
  {
    // "help", "how do I search": what the box answers, each kind with a query to try.
    words: /^(?:help|search help|how (?:do i|to|can i) (?:search|use (?:this|search|the search))|what can i (?:search|ask|type)(?: for)?|what can (?:you|this|search) (?:do|answer)|examples?)$/,
    label: "What you can search",
    lines: [
      { text: "A team, by number or name", detail: "\"4215\", \"bad wolf\", \"4215 awards\", \"4215 record\"", href: "/search?q=4215%20awards" },
      { text: "Two teams side by side", detail: "\"4215 vs 6980\", \"compare hypnotic and bad wolf\"", href: "/search?q=4215%20vs%206980" },
      { text: "Events by place and time", detail: "\"nj states\", \"meets this weekend\", \"events in january\"", href: "/search?q=meets%20this%20weekend" },
      { text: "Leaders and records", detail: "\"top teams in texas\", \"highest score\", \"most improved teams\"", href: "/search?q=top%20teams%20in%20texas" },
      { text: "Who won", detail: "\"who won nj states\", \"who won worlds last year\"", href: "/search?q=who%20won%20nj%20states" },
      { text: "What a word means", detail: "\"what is opr\", \"what is decode\", \"ftc rules\"", href: "/search?q=what%20is%20opr" },
    ],
    pages: [{ title: "FAQ", href: "/faq" }],
  },
];

/** The season a game's name means ("DECODE" → 2025–26), from the season list. */
const gameSeason = (t: string) => SEASONS.find((s) => normalize(s.game).replace(/\s+/g, "") === t.replace(/\s+/g, ""));

/** "what is OPR", "what is DECODE", "game manual": what it means, and the page that has the rest; or null. */
export function explainAnswer(q: string): SearchAnswer | null {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  for (const e of EXPLAINS) if (e.words.test(t)) {
    return answer(q, { hits: [], pages: [...e.pages, ...pagesFor(q).filter((p) => !e.pages.some((x) => x.href === p.href))], card: { kind: "info", title: e.label, lines: e.lines }, understood: { kind: "question", label: e.label } });
  }
  // A season's game: "what is decode", "decode game", "what was into the deep".
  let m = /^(?:what(?:'s| is| was)|whats|which)\s+(?:the\s+)?(?:ftc\s+)?(?:game\s+)?(.+?)(?:\s+game)?$/.exec(t) ?? /^(.+?)\s+(?:game|season)$/.exec(t) ?? /^(?:ftc\s+)?(.+)$/.exec(t);
  const s = m ? gameSeason(normalize(m[1])) ?? gameSeason(normalize(m[1].replace(/\b(?:ftc|the|game|season)\b/g, ""))) : undefined;
  if (s) {
    const label = `${s.game}: the ${seasonLabel(s.season)} FTC game`;
    const current = s.season === CURRENT_SEASON;
    const lines: SearchCardLine[] = [
      { text: `${s.game} is FIRST Tech Challenge's game for the ${seasonLabel(s.season)} season`, detail: current ? "This season" : s.season > CURRENT_SEASON ? "A coming season" : "A past season", href: `/events?season=${s.season}` },
      ...(current ? [{ text: "Its rules, summed up", detail: "The Rules quick reference links the official game manual", href: "/rules" }] : []),
      { text: `${seasonLabel(s.season)} rankings`, href: `/rankings?season=${s.season}` },
    ];
    return answer(q, { hits: [], pages: [{ title: `${seasonLabel(s.season)} events`, href: `/events?season=${s.season}` }, { title: "Rules", href: "/rules" }], card: { kind: "info", title: label, lines }, understood: { kind: "question", label } });
  }
  // The rules: "ftc rules", "game manual", "decode game manual", "competition manual".
  m = /^(?:(?:the|ftc|first tech challenge|official)\s+)*(?:(.+?)\s+)?(?:game manual|competition manual|manual|rules|rule book|rulebook)$/.exec(t);
  if (m && (!m[1] || gameSeason(normalize(m[1])) || /^(?:ftc|game|official|this season'?s?)$/.test(m[1]))) {
    const label = "The game's rules: the Rules quick reference and the official manual";
    return answer(q, { hits: [], pages: [{ title: "Rules", href: "/rules" }, ...pagesFor(q).filter((p) => p.href !== "/rules")], card: { kind: "info", title: label, lines: [{ text: "Rules quick reference", detail: "Each rule summed up, with a link to the official game manual", href: "/rules" }] }, understood: { kind: "question", label } });
  }
  return null;
}

/** "how many teams in NJ", "how many teams are there", "how many events this season": a count; or null. */
export async function countAnswer(q: string): Promise<SearchAnswer | null> {
  let t = squash(q.toLowerCase().replace(/[?]/g, ""));
  // A season at the end ("how many teams 2023", "… in 2024-25", "… last season"): that season's count. A bare year is
  // the season it starts for teams (they register by season), and the calendar year for events, as event searches
  // read it ("events in 2024": held in 2024, from two seasons).
  let season = CURRENT_SEASON, year: number | null = null;
  const sm = /\s+(?:in\s+|during\s+|for\s+)?(?:the\s+)?(?:(last|previous) (?:season|year)|(20\d\d)(?:\s*[-–/]\s*(\d\d))?(\s+season)?)$/.exec(t);
  if (sm && /^how many\s/.test(t)) {
    if (sm[2] && sm[3] && (Number(sm[2]) + 1) % 100 !== Number(sm[3])) return null;
    season = sm[1] ? CURRENT_SEASON - 1 : Number(sm[2]);
    if (sm[2] && !sm[3] && !sm[4]) year = Number(sm[2]);
    t = t.slice(0, sm.index);
  }
  const m =/^how many\s+(?:ftc\s+)?(?:league\s+)?(teams?|events?|meets?|competitions?)\s*(?:are there|is there|exist|are|there are)?\s*(?:(?:in|from)\s+(.+?))?\s*(?:this season|this year|right now|now|in ftc|total)?\s*(?:are there|exist)?$/.exec(t);
  if (!m) return null;
  const teams = m[1].startsWith("team");
  // No season after the current one; a calendar year of events may be ("events in 2027": the current season's spring).
  if (season > CURRENT_SEASON && (teams || year == null)) return null;
  const place = m[2] ? await placeOf(cased(q, m[2])) : null;
  if (m[2] && !place) return null;
  const where = teams ? placeSql(place) : placeSql(place).replace(/\bt\./g, "e.");
  const meets = /^meet/.test(m[1]) || /\bleague\b/.test(t);
  const inYear = !teams && year != null;
  const row = teams
    ? await get<{ n: number }>(`SELECT COUNT(*) n FROM team_seasons s JOIN teams t ON t.number = s.team WHERE s.season = ?${where}`, [season, ...placeArgs(place)])
    : await get<{ n: number }>(`SELECT COUNT(*) n FROM events e WHERE ${inYear ? "substr(e.start, 1, 4) = ?" : "e.season = ?"}${meets ? " AND e.type = 'LeagueMeet'" : ""}${where}`, [inYear ? String(year) : season, ...placeArgs(place)]);
  const n = Number(row?.n ?? 0);
  const what = teams ? "teams registered" : meets ? "league meets" : "events";
  const inPlace = place ? ` in ${place.name}` : "";
  const when = inYear ? String(year) : seasonLabel(season);
  const label = `How many ${teams ? "teams" : meets ? "league meets" : "events"}${inPlace} · ${when}`;
  // The teams counted, as Teams filters them: its country (an alpha-2 code) and home state.
  const cc = place ? countryOf(place.country)?.code : null;
  const teamsWhere = cc ? `&country=${cc}${place?.state ? `&state=${encodeURIComponent(place.state)}` : ""}` : "";
  // A calendar year spans two seasons: its events are the event search's ("events in 2024"), not one season's list.
  // That search reads states and provinces, not countries, so a country's year opens the full event list instead.
  const href = teams ? `/teams?season=${season}&view=listed${teamsWhere}`
    : inYear && place && !place.state ? "/events"
    : inYear ? `/search?q=${encodeURIComponent(`${meets ? "meets" : "events"}${inPlace} in ${year}`)}`
    : `/events?season=${season}${place?.state ? `&region=${encodeURIComponent(place.key)}` : ""}`;
  return answer(q, {
    hits: [], pages: [{ title: teams ? "Browse the teams" : "Browse the events", href }],
    card: { kind: "info", title: label, lines: [{ text: `${n.toLocaleString("en-US")} ${what}${inPlace} in ${when}`, detail: teams ? "Registrations for the season, played or not" : inYear ? `Every event on FIRST's schedule held in ${year}, from either season` : "Every event on FIRST's schedule for the season", href }] },
    understood: { kind: "question", label },
  });
}

/** "teams near me", "events nearby": nothing on record says where the visitor is, so it says that and asks for a place,
 *  never a list of names that happen to contain "team" or "event"; or null. */
export function nearMeAnswer(q: string): SearchAnswer | null {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  const m = /^(.+?)\s+(?:in my (?:state|area|region|city|town)|near me|near us|around me|close to me|nearby)$/.exec(t);
  const kind = m ? BARE_KIND.exec(m[1]) : null;
  if (!kind) return null;
  const teams = /^team/.test(kind[1]);
  const what = teams ? "teams" : "events";
  const label = `Where you are isn't known: add a place to see ${what} near you`;
  const href = teams ? "/teams" : "/events";
  return answer(q, {
    hits: [], pages: [{ title: teams ? "Browse the teams" : "Browse the events", href }],
    card: { kind: "info", title: label, lines: [
      { text: `${titleCase(what)} in a state or country`, detail: `"${what} in NJ", "${what} in Texas"`, href: `/search?q=${encodeURIComponent(`${what} in NJ`)}` },
      { text: `${titleCase(what)} in a town`, detail: `"${what} in Edison"`, href: `/search?q=${encodeURIComponent(`${what} in Edison`)}` },
    ] },
    understood: { kind: "question", label },
  });
}

/** "lowest opr in nj", "worst teams": search ranks teams from the top only. It says so and links every ranked team in
 *  the stat asked, lowest first (the Teams page's season table); a stat that table can't sort by links Rankings, which
 *  is by prediction rating and says so. Never a team whose name has "worst" in it; or null. */
export async function bottomAnswer(q: string): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  const m = new RegExp(`^(?:the\\s+)?(?:lowest|worst|weakest|bottom)(?:\\s+\\d{1,2})?\\s+(?:${BOARD}(?:\\s+teams?)?|teams?|robots?)(?:\\s+by\\s+${BOARD})?(?:\\s+(?:in\\s+|from\\s+)?(.+))?$`).exec(t);
  if (!m) return null;
  const region = m[3] ? regionOf(m[3].split(" ")) : null;
  if (m[3] && !region) return null;
  // The stat asked ("lowest opr", "worst teams by auto opr"); "worst teams" alone is the prediction rating's, as "top
  // teams" is.
  const word = m[2] ?? m[1] ?? "rating";
  const stat = BOARD_STATS[/rating/.test(word) ? "rating" : word === "win rate" ? "win-rate" : word.replace(/\s+opr$/, "")];
  const season = searchSeason();
  const sorted = stat?.teamsSort ? teamsHref(season, stat, region) : null;
  const where = region ? ` in ${region.name}` : "";
  const href = sorted ? `${sorted}&dir=asc` : `/rankings?season=${season}${region ? `&region=${encodeURIComponent(region.key)}` : ""}`;
  const line = sorted
    ? { text: `Every ranked team${where} by ${stat.label}, lowest first`, detail: `The Teams page's ${seasonLabel(season)} table, sorted from the bottom`, href }
    : { text: `Every ranked team${where}, by prediction rating`, detail: `Rankings lists them all in ${seasonLabel(season)}, so the end of the list is the lowest`, href };
  const label = "Search lists teams from the top, not the bottom";
  return answer(q, {
    hits: [], pages: [{ title: sorted ? `Teams by ${stat.label}` : region ? `${region.name} rankings` : "Rankings", href }],
    card: { kind: "info", title: label, lines: [line] },
    understood: { kind: "question", label },
  });
}

/** "where is worlds", "when is worlds", "worlds 2026", "worlds divisions", "first championship": the FIRST
 *  Championship's events (newest season first, or the season or year named). Null when it isn't that. */
export async function worldsAnswer(q: string, now?: number): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  const worlds = /^(?:(?:where|when)(?:'s| is| are| was| were| will)?\s+(?:the\s+)?(?:next\s+)?|(?:list|show)\s+(?:me\s+)?(?:the\s+)?)?(?:ftc\s+)?(?:worlds|world championships?|first championships?|ftc championships?|first world championships?)(?:\s+(?:divisions?|(20\d\d)(?:\s*[-–/]\s*(\d\d))?|(this|last|next) (year|season)))*(?:\s+be)?$/.exec(t);
  // "State championships", "all state championships", "championships this season": every championship of the season.
  // "state championship" too, as search singularizes it. Said with "state", a state's own (never Worlds).
  const states = /^(?:all\s+(?:the\s+)?)?(state\s+|regional\s+)?(?:championships?|champs)(?:\s+(this|last|next) (?:year|season))?$/.exec(t);
  if (!worlds && !states) return null;
  let year: number | null = null, season: number | null = null;
  if (worlds?.[1]) { if (worlds[2] && (Number(worlds[1]) + 1) % 100 === Number(worlds[2])) season = Number(worlds[1]); else if (!worlds[2]) year = Number(worlds[1]); }
  const rel = worlds ? worlds[3] : states![2];
  const shift = rel === "last" ? -1 : rel === "next" ? 1 : 0;
  // Worlds is held in the spring, so "worlds this year" is the one held this calendar year; "this season" is the season's.
  if (rel && worlds?.[4] === "year") year = new Date(now ?? Date.now()).getUTCFullYear() + shift;
  else if (rel) season = CURRENT_SEASON + shift;
  const kinds = worlds ? ["worlds"] : states![1] ? ["states"] : ["championship"];
  // State championships alone: this season's, never the FIRST Championship as one of them.
  const e: EventQuery = { kinds, time: null, year, season: states && season == null ? CURRENT_SEASON : season, region: null, where: null, words: [], ...(worlds && year == null && season == null ? { allSeasons: true } : {}) };
  return eventSetAnswer(q, e, { now });
}

const SECTION_WORDS: [RegExp, SearchSection | "match"][] = [
  [/\b(?:rankings?|standings|ranks?)\b/, "rankings"], [/\b(?:playoffs?|brackets?|elims|eliminations|finals?|alliances?|alliance selection)\b/, "playoffs"],
  [/\b(?:match(?:es)?|match list|schedule|results?)\b/, "matches"], [/\bawards?\b/, "awards"], [/\b(?:odds|predictions?)\b/, "odds"],
  [/\b(?:teams?|roster|field|who is going|who's going)\b/, "teams"],
];

/** "nj states rankings", "match 12 at nj states", "qual 5 nj states": an event read from a place, its tab or match. */
/** "USNJNEM6 event", "event FTCCMP1": an event's code with the word "event" (or "meet") is that event, its newest
 *  season, as the event record has it (dates, venue, place, status). A code is letters then a digit (a team's number
 *  is digits only); one no event has is left to search. */
export async function eventCodeAnswer(q: string, now?: number): Promise<SearchAnswer | null> {
  const m = /^(?:(?:the\s+)?(?:event|meet)\s+)?([a-z]{3,}\d[a-z0-9]*)(?:\s+(?:event|meet)(?:\s+page)?)?$/i.exec(squash(q));
  if (!m || m[1] === squash(q)) return null;
  const row = await get<any>("SELECT season, code, name, type, venue, city, state, country, start, end, timezone FROM events WHERE upper(code) = ? ORDER BY season DESC LIMIT 1", [m[1].toUpperCase()]);
  if (!row) return null;
  const hit = eventHit(row, now);
  return answer(q, { hits: [hit], pages: pagesFor(q), understood: { kind: "names", label: `Event ${row.code} · ${row.name} (${seasonLabel(Number(row.season))})` } });
}

export async function eventPageAnswer(q: string, prefer: ReadonlySet<string>, now?: number): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  // "q12", "qual 12", "match 12": a qualification match; "m3", as match codes say it, is playoff match 3.
  const mm = /\b(q|qual|qualification|match|m)\s*-?\s*(\d{1,3})\b/.exec(t);
  const kind = mm?.[1] === "m" ? { code: "M", word: "Playoff match" } : { code: "Q", word: "Qualification match" };
  const section = SECTION_WORDS.find(([w]) => w.test(t));
  if (!mm && !section) return null;
  let rest = t;
  if (mm) rest = rest.replace(mm[0], " ");
  if (section) rest = rest.replace(section[0], " ");
  rest = squash(rest.replace(/\b(?:at|in|of|for|the|from)\b\s*$/, "").replace(/^\s*(?:at|in|of|for|the)\b/, ""));
  // "finals at worlds": the FIRST Championship, which needs no place or year to be one event set.
  // "divison", "divsion": the word events use.
  rest = rest.replace(/\bdiv(?:i?si?|is)on\b/g, "division");
  const worlds = /^(?:the\s+)?(?:worlds|first championship|world championships?)$/.test(rest);
  const ev: EventQuery | null = worlds ? { kinds: ["worlds"], time: null, year: null, season: null, region: null, where: null, words: [], allSeasons: true } : readEventQuery(rest);
  const set = ev ? await eventSetAnswer(rest, ev, { now }) : null;
  const today = new Date(now ?? Date.now()).toISOString().slice(0, 10);
  // An event by its own name ("jackson division q12", "worlds jackson division q12"), when the words name a kind of
  // event and the event readers found none: search's events by name.
  const read = set ? set.hits.filter((h) => h.kind === "event") : [];
  // A season named with it ("edison division q1 2025-26", "… decode") is that season's event, and not part of the name.
  const named = seasonWord(rest);
  const nameWords = named ? named.rest : rest;
  const inSeason = named ? Number(named.season.slice(0, 4)) : null;
  const byName = !read.length && !!mm && EVENT_WORDS.test(nameWords) && !/\d/.test(nameWords);
  // Search lists each code once, from its newest season, undated; each is dated here by the season named, else the
  // newest season it has matches in (a code's next season is listed before it's played), so an unplayed season never
  // hides a played one.
  const events: SearchHit[] = byName ? [] : read;
  if (byName) for (const h of (await search(nameWords.replace(/^(?:the\s+)?worlds\s+/, ""), 10, prefer, new Set(["event"]))).filter((x) => x.kind === "event")) {
    const c = h.ref.split(":")[1];
    const r = await get<{ season: number; start: string | null }>(`SELECT e.season, e.start FROM events e WHERE e.code = ?${inSeason != null ? " AND e.season = ?" : " AND EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code)"} ORDER BY e.season DESC LIMIT 1`, inSeason != null ? [c, inSeason] : [c]);
    if (!r && inSeason != null) continue;
    events.push(r ? { ...h, ref: `${r.season}:${c}`, season: Number(r.season), event: { ...(h.event ?? {}), start: r.start ?? "" } as SearchHit["event"] } : h);
  }
  if (!events.length && !set) return null;
  // The event asked about: the latest that has started (its pages have something), else the next one.
  const startOf = (h: SearchHit) => h.event?.start ?? "";
  const started = events.filter((h) => h.event?.status !== "upcoming" && startOf(h) <= today).sort((a, b) => startOf(b).localeCompare(startOf(a)));
  const target = started[0] ?? events[0];
  if (!target) return null;
  const [s, code] = target.ref.split(":");
  if (mm) {
    // An event split into divisions plays its qualification matches in each division (USNJCMPPKWY, USNJCMPTRPK):
    // that match number in every one of them.
    const codes = [code, ...(await all<{ code: string }>("SELECT code FROM events WHERE season = ? AND code LIKE ? AND code <> ? ORDER BY code", [Number(s), `${code}%`, code])).map((r) => r.code)];
    const found: SearchHit[] = [];
    // The event's own code finds its divisions' matches too: each match once.
    for (const c of codes) for (const h of (await search(`${s} ${c} ${kind.code}${mm[2]}`, 5, prefer, new Set(["match"]), Number(s))).filter((x) => x.kind === "match").slice(0, 1)) if (!found.some((f) => f.ref === h.ref)) found.push(h);
    if (found.length) return answer(q, { hits: [...found, { ...target, section: "matches" }], pages: pagesFor(q), understood: { kind: "names", label: `${kind.word} ${mm[2]} at ${target.title} (${seasonLabel(Number(s))})${found.length > 1 ? `, in each of its ${found.length} divisions` : ""}` } });
    return answer(q, { hits: [{ ...target, section: "matches" }], pages: pagesFor(q), understood: { kind: "names", label: `${target.title} (${seasonLabel(Number(s))}): no ${kind.word.toLowerCase()} ${mm[2]} on record, here are its matches` } });
  }
  const sec = section![1] as SearchSection;
  const tab = sec === "rankings" ? "Rankings" : sec === "playoffs" ? "Playoffs" : sec === "matches" ? "Matches" : sec === "awards" ? "Awards" : sec === "teams" ? "Teams" : "Odds";
  const others = events.filter((h) => h.ref !== target.ref).slice(0, 8);
  return answer(q, { hits: [{ ...target, section: sec }, ...others], pages: pagesFor(q), understood: { kind: "names", label: `${tab} · ${target.title} (${seasonLabel(Number(s))})` } });
}

/** Two or three questions search answers about a team, each from what its records hold (a Worlds trip, an award, a
 *  season of matches), the ones nearest what was asked first: a fallback's way on, never a dead end. */
export async function teamSuggestions(team: number, asked: string): Promise<string[]> {
  const played = await all<{ season: number }>("SELECT season FROM team_season_stats WHERE team = ? AND matches > 0 ORDER BY season DESC", [team]);
  if (!played.length) return [];
  const def = searchSeason();
  const season = played.some((r) => r.season === def) ? def : played[0].season;
  const worlds = !!(await get("SELECT 1 FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code WHERE s.team = ? AND e.type = 'FIRSTChampionship' AND s.matches > 0 LIMIT 1", [team]));
  const awards = !!(await get("SELECT 1 FROM awards WHERE team = ? LIMIT 1", [team]));
  const S = seasonLabel(season);
  const options = [
    { q: `${team} worlds appearances`, near: /\b(?:worlds?|championships?|cmp|houston)\b/, has: worlds },
    { q: `${team} awards`, near: /\b(?:awards?|inspire|won|win)\b/, has: awards },
    { q: `${team} highest score ever`, near: /\b(?:scores?|points?|best|highest|match(?:es)?)\b/, has: true },
    { q: `${team} best alliance partner`, near: /\b(?:partners?|alliances?|with|teammates?|opponents?|against)\b/, has: true },
    { q: `${team} record ${S}`, near: /\b(?:record|wins?|loss(?:es)?|did|do)\b/, has: true },
    { q: `${team} opr ${S}`, near: /\b(?:opr|good|strong|rating|rank)\b/, has: true },
  ].filter((x) => x.has);
  const near = options.filter((x) => x.near.test(asked));
  // The asked-about ones first, then the season's record and OPR, then the rest.
  const order = [...near, ...options.filter((x) => /record|opr/.test(x.q)), ...options];
  return [...new Set(order.map((x) => x.q))].slice(0, 3);
}

/** Words that may trail a team's name without being part of it ("bad wolf robotics", "ultraviolet team nj"). */
const NAME_TAIL = new Set(["robotics", "robot", "robots", "team", "teams", "ftc", "club", "the", "first", "tech", "challenge"]);

/** The last stop before "no results": a team number in the query that's a real team, or a team's name with
 *  trailing words that aren't part of it. The team, and what wasn't read, said plainly. Null when neither. */
export async function teamFallback(q: string, prefer: ReadonlySet<string>): Promise<SearchAnswer | null> {
  // "12345's": the team's number.
  const ws = squash(q).split(" ").map((w) => w.replace(/^(\d{1,6})['’]s$/, "$1"));
  // A number that's a team.
  const nums = [...new Set(ws.filter((w) => /^\d{1,6}$/.test(w)))];
  const found: SearchHit[] = [];
  for (const n of nums) {
    const hit = (await search(String(Number(n)), 5, prefer, new Set(["team"]))).find((h) => h.kind === "team" && h.ref === String(Number(n)));
    if (hit) found.push(hit);
  }
  if (found.length === 1) {
    const hit = found[0];
    const left = ws.filter((w) => w !== hit.ref).join(" ");
    const section: SearchSection | undefined = /\b(?:partners?|alliances?|pick|picks|opponents?|played with|played against)\b/i.test(left) ? "matches"
      : /\bevents?\b/i.test(left) ? "history" : /\b(?:matches|match|games?|scores?)\b/i.test(left) ? "matches" : undefined;
    // Never the query echoed back (cleaning has already changed its words): what search can show instead, plainly.
    const label = `${nameOf(hit)} · This isn't answered directly yet${section ? `: their ${section === "history" ? "events" : "matches"} are on their page` : ""}`;
    const suggest = await teamSuggestions(Number(hit.ref), left);
    return answer(q, { hits: [{ ...hit, ...(section ? { section } : {}), match: "exact" }], pages: pagesFor(q), understood: { kind: "team", label }, ...(suggest.length ? { suggest } : {}) });
  }
  if (found.length > 1 || nums.length) return null;
  // A name with trailing words: the words dropped from the end (a state or region too) until a team's whole name is left.
  const lower = ws.map((w) => w.toLowerCase());
  let end = lower.length, region = null as ReturnType<typeof regionOf>;
  while (end > 1) {
    const last = lower[end - 1];
    const r = regionOf([ws[end - 1]]) ?? (last.length > 2 ? regionOf([last]) : null);
    if (NAME_TAIL.has(last)) end--;
    else if (r && !region) { region = r; end--; }
    else break;
  }
  if (end === lower.length || end < 1) return null;
  const name = ws.slice(0, end).join(" ");
  const teams = (await search(name, 25, prefer, new Set(["team"]))).filter((h) => h.kind === "team");
  const exact = teams.filter((h) => normalize(teamNameOf(h.title)) === normalize(name));
  const inRegion = region ? exact.filter((h) => new RegExp(`\\b${region!.state}\\b`).test(h.subtitle ?? "")) : exact;
  // A state named and no team of that name there: none, never another state's team said to be in it.
  const pick = inRegion;
  if (!pick.length) return null;
  const label = pick.length === 1 ? `${nameOf(pick[0])}${region ? ` (${region.name})` : ""}` : `Teams named "${titleCase(name)}"${region ? ` in ${region.name}` : ""}`;
  return answer(q, { hits: pick.map((h) => ({ ...h, match: "exact" as const })), pages: pagesFor(q), understood: { kind: pick.length === 1 ? "team" : "names", label } });
}

/** A place a team list can be filtered to: a state or province ("NJ"), or a country by its stored name ("Canada"). */
type Place = { name: string; country: string; state: string | null; key: string };
/** The words as typed, found again in the query: a state code keeps its capitals ("OR" is Oregon, "or" is a word). */
function cased(q: string, part: string): string {
  const typed = squash(q), i = typed.toLowerCase().indexOf(part);
  return i >= 0 ? typed.slice(i, i + part.length) : part;
}

async function placeOf(words: string): Promise<Place | null> {
  const w = squash(words.replace(/^(?:the\s+)?(?:state of\s+)?/i, ""));
  if (!w) return null;
  const r = regionOf(w.split(" "));
  if (r) return { name: r.name, country: r.country, state: r.state, key: r.key };
  const alias: Record<string, string> = { us: "USA", usa: "USA", "united states": "USA", america: "USA", uk: "United Kingdom", britain: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom" };
  const row = await get<{ country: string }>("SELECT country FROM teams WHERE LOWER(country) = LOWER(?) LIMIT 1", [alias[w.toLowerCase()] ?? w]);
  return row ? { name: row.country, country: row.country, state: null, key: row.country } : null;
}
const placeSql = (p: Place | null) => (p ? (p.state ? " AND t.country = ? AND t.state = ?" : " AND t.country = ?") : "");
const placeArgs = (p: Place | null) => (p ? (p.state ? [p.country, p.state] : [p.country]) : []);
const fmt1 = (x: number | null) => (x == null ? "–" : (Math.round(Number(x) * 10) / 10).toFixed(1));
/** A team's line; `season` when its numbers are one season's, so the link opens that season. */
const lineOf = (r: any, results: string[], season?: number | null): SearchCardLine => ({
  text: `${r.team ?? r.number} ${(r.name ?? "").trim()}`.trim(), detail: [r.city, r.state, r.country === "USA" ? null : r.country].filter(Boolean).join(", "), results,
  href: `/teams/${r.team ?? r.number}${season != null ? `?season=${season}` : ""}`,
});

/** Team lists the leaderboards don't cover: a country's best, undefeated teams, rookies, the oldest and newest teams,
 *  an average OPR, a place's teams at Worlds, and counties (not on record, said so). Null when it isn't one. */
export async function teamListAnswer(q: string): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, "").replace(/^(?:what|who|which)(?: is| are|s)?\s+(?:the\s+)?/, "").replace(/^(?:show|list|find)\s+(?:me\s+)?(?:the\s+|all\s+)?/, "").replace(/\s+in\s+(?:ftc|the world)$/, ""));
  let m: RegExpExecArray | null;
  const card = (title: string, lines: SearchCardLine[], none: string, pages: { title: string; href: string }[], label = title, table?: TeamTable): SearchAnswer =>
    answer(q, { hits: [], pages, card: { kind: "leaderboard", title, lines, ...(lines.length ? {} : { none }), ...(table?.rows.length ? { table } : {}) }, understood: { kind: "question", label } });
  const ranked = `s.season = ? AND s.matches >= ${RANKED_MIN_MATCHES} AND ${teamPageSql("s.team", "t.name")}`;

  // Counties aren't stored: said plainly, with the way to a town's or state's teams.
  if ((m = /^(?:teams?|events?|meets?)\s+(?:in|from|near)\s+(.+?)\s+county$/.exec(t))) {
    const label = `${titleCase(m[1])} County: counties aren't on record`;
    return answer(q, { hits: [], pages: SEARCH_BROWSE, card: { kind: "info", title: label, lines: [{ text: "Teams and events are stored by town, state and country", detail: `Try a town in ${titleCase(m[1])} County ("teams in Oradell") or the state ("teams in NJ")`, href: "/teams" }] }, understood: { kind: "question", label } });
  }
  // Nothing below is asked: never a database read for an ordinary search.
  if (!/\b(?:best|top|strongest|highest|biggest|max(?:imum)?|undefeated|unbeaten|perfect|no losses|without a loss|win(?:ning|rate)?|improved|rookies?|oldest|newest|youngest|first[\s-]year|veteran|average|mean|avg|worlds|first championship|world championship)\b/.test(t)) return null;
  const season = searchSeason();
  // A country's best: "best teams in canada", "top teams in romania" (a state's are the leaderboards').
  if ((m = /^(?:the\s+)?(?:best|top|strongest|highest[\s-]ranked)(?:\s+(\d+))?\s+(?:teams?|robots?)\s+(?:in|from|of)\s+(.+)$/.exec(t))) {
    const p = await placeOf(cased(q, m[2]));
    if (p && !p.state) {
      // "top 3 teams in canada": that many (1 to 50); else 10.
      const n = m[1] ? Math.min(50, Math.max(1, Number(m[1]))) : 10;
      const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked}${placeSql(p)} ORDER BY s.opr_np DESC, s.team LIMIT ${n}`, [season, ...placeArgs(p)]);
      const lines = rows.map((r, i) => lineOf(r, [`#${i + 1} in ${p.name}`, `OPR ${fmt1(r.opr_np)}`, `${r.wins}-${r.losses}-${r.ties}`], season));
      const title = `Top teams in ${p.name} · ${seasonLabel(season)}`;
      return card(title, lines, `No ranked teams in ${p.name} for ${seasonLabel(season)} yet.`, [{ title: `${p.name} rankings`, href: `/rankings?season=${season}&region=${encodeURIComponent(p.key)}` }], `${title}, by OPR without penalties`, tableOf(rows, season));
    }
  }
  // A place's best match scores: "top scores in NJ", "highest score in texas". As the season records are kept
  // (./searchHighScores.ts): an alliance's score without penalties, official events only, one season (the latest with
  // played matches there), never different games' scores side by side.
  if ((m = /^(?:the\s+)?(?:top|highest|best|biggest|max(?:imum)?)\s+(?:match\s+)?(?:scores?|scoring matches|scoring games)\s+(?:in|from|at)\s+(.+?)$/.exec(t))) {
    const p = await placeOf(cased(q, m[1]));
    if (!p) return null;
    const where = p.state ? "e.country = ? AND e.state = ?" : "e.country = ?";
    const types = RECORD_TYPES.map(() => "?").join(", ");
    const latest = await get<{ s: number | null }>(`SELECT MAX(m.season) s FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.played = 1 AND ${where} AND e.type IN (${types})`, [...placeArgs(p), ...RECORD_TYPES]);
    const s = latest?.s != null ? Number(latest.s) : null;
    const side = (c: "red" | "blue") => `SELECT m.season, m.code, m.level, m.series, m.number, m.label, e.name, e.start, e.city, e.state, '${c}' side, COALESCE(m.${c}_np, m.${c}_total) np
      FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
      WHERE m.season = ? AND m.played = 1 AND COALESCE(m.${c}_np, m.${c}_total) IS NOT NULL AND ${where} AND e.type IN (${types})`;
    const rows = s == null ? [] : await all<any>(`${side("red")} UNION ALL ${side("blue")} ORDER BY np DESC LIMIT 10`, [s, ...placeArgs(p), ...RECORD_TYPES, s, ...placeArgs(p), ...RECORD_TYPES]);
    const lines: SearchCardLine[] = rows.map((r) => ({
      text: `${Number(r.np)} points · ${r.label ?? `Match ${r.number}`}`, detail: `${r.name} · ${r.start ?? ""} · ${[r.city, r.state].filter(Boolean).join(", ")}`,
      results: [`${String(r.side) === "red" ? "Red" : "Blue"} alliance`], href: `/events/${r.season}/${r.code}?match=${r.level}:${r.series}:${r.number}`,
    }));
    const title = `Highest scores in ${p.name}${s != null ? ` · ${seasonLabel(s)}` : ""}`;
    return answer(q, { hits: [], pages: [{ title: "Match records", href: "/matches" }], card: { kind: "high-scores", title, lines, ...(lines.length ? {} : { none: `No official matches played in ${p.name} on record yet.` }) }, understood: { kind: "question", label: `${title}: alliance scores without penalties, official events only` } });
  }
  // Undefeated teams: no losses, with enough matches to be ranked.
  if ((m = /^(?:most\s+)?(?:undefeated|unbeaten|perfect[\s-]record)\s+teams?(?:\s+(?:in|from)\s+(.+?))?(?:\s+this season)?$/.exec(t)) || (m = /^teams?\s+(?:with\s+)?(?:no losses|a perfect record|without a loss)(?:\s+(?:in|from)\s+(.+?))?$/.exec(t))) {
    const p = m[1] ? await placeOf(cased(q, m[1])) : null;
    if (m[1] && !p) return null;
    const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} AND s.losses = 0${placeSql(p)} ORDER BY s.wins DESC, s.opr_np DESC, s.team LIMIT 10`, [season, ...placeArgs(p)]);
    const n = await get<{ n: number }>(`SELECT COUNT(*) n FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} AND s.losses = 0${placeSql(p)}`, [season, ...placeArgs(p)]);
    const title = `Undefeated teams${p ? ` in ${p.name}` : ""} · ${seasonLabel(season)}`;
    const lines = rows.map((r) => lineOf(r, [`${r.wins}-${r.losses}-${r.ties}`, `OPR ${fmt1(r.opr_np)}`], season));
    return card(title, lines, `No team${p ? ` in ${p.name}` : ""} with ${RANKED_MIN_MATCHES}+ matches is undefeated in ${seasonLabel(season)}.`, [{ title: "Rankings", href: `/rankings?season=${season}` }], `${title}: ${Number(n?.n ?? 0)} with no losses (${RANKED_MIN_MATCHES}+ matches), most wins first`, tableOf(rows, season, "rank"));
  }
  // The best win rate: wins over matches played, ranked teams only, ties counting half.
  if ((m = /^(?:teams?\s+with\s+(?:the\s+)?)?(?:highest|best|top)\s+(?:win(?:ning)?\s+(?:rate|percentage|%)|winrate)(?:\s+teams?)?(?:\s+(?:in|from)\s+(.+?))?$/.exec(t))) {
    const p = m[1] ? await placeOf(cased(q, m[1])) : null;
    if (m[1] && !p) return null;
    const rate = "(s.wins + 0.5 * s.ties) * 1.0 / (s.wins + s.losses + s.ties)";
    const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties, ${rate} rate FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} AND s.wins + s.losses + s.ties > 0${placeSql(p)} ORDER BY rate DESC, s.wins DESC, s.opr_np DESC, s.team LIMIT 10`, [season, ...placeArgs(p)]);
    const title = `Highest win rate${p ? ` in ${p.name}` : ""} · ${seasonLabel(season)}`;
    const lines = rows.map((r, i) => lineOf(r, [`#${i + 1}`, `${Math.round(Number(r.rate) * 100)}% wins`, `${r.wins}-${r.losses}-${r.ties}`, `OPR ${fmt1(r.opr_np)}`], season));
    return card(title, lines, `No team${p ? ` in ${p.name}` : ""} has ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.`, [{ title: "Rankings", href: `/rankings?season=${season}` }], `${title}: wins over matches played (a tie counts half), ${RANKED_MIN_MATCHES}+ matches`,
      tableOf(rows.map((r, i) => tableRow(r, i + 1, season, { value: Number(r.rate), display: `${Math.round(Number(r.rate) * 100)}%` })), season, "rank", { label: "Win rate" }, true));
  }
  // Most improved: the biggest rise in OPR standing (rank among the season's ranked teams, as a share) from the season
  // before, never raw OPR across seasons (each game scores on its own scale).
  if ((m = /^(?:the\s+)?most\s+improved(?:\s+teams?)?(?:\s+(?:in|from)\s+(.+?))?(?:\s+this season)?$/.exec(t))) {
    const p = m[1] ? await placeOf(cased(q, m[1])) : null;
    if (m[1] && !p) return null;
    const standing = async (s: number) => {
      const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} ORDER BY s.opr_np DESC, s.team`, [s]);
      return new Map(rows.map((r, i) => [Number(r.team), { ...r, rank: i + 1, share: (i + 1) / rows.length }]));
    };
    const [now, before] = [await standing(season), await standing(season - 1)];
    const inPlace = (r: any) => !p || (p.state ? r.state === p.state && r.country === p.country : r.country === p.country);
    const pct = (share: number) => `top ${Math.max(1, Math.round(share * 100))}%`;
    const rows = [...now.values()].filter((r) => before.has(Number(r.team)) && inPlace(r))
      .map((r) => ({ ...r, was: before.get(Number(r.team))!, gain: before.get(Number(r.team))!.share - r.share }))
      .filter((r) => r.gain > 0).sort((a, b) => b.gain - a.gain || a.rank - b.rank).slice(0, 10);
    const title = `Most improved${p ? ` in ${p.name}` : ""} · ${seasonLabel(season - 1)} → ${seasonLabel(season)}`;
    const lines = rows.map((r, i) => lineOf(r, [`#${i + 1}`, `${pct(r.was.share)} → ${pct(r.share)}`, `OPR rank ${r.was.rank} → ${r.rank}`, `${r.wins}-${r.losses}-${r.ties}`], season));
    return card(title, lines, `No team${p ? ` in ${p.name}` : ""} ranked in both ${seasonLabel(season - 1)} and ${seasonLabel(season)}.`, [{ title: "Rankings", href: `/rankings?season=${season}` }], `${title}: the biggest rise in OPR standing (rank among each season's ranked teams), never raw OPR across seasons`,
      tableOf(rows.map((r, i) => tableRow(r, i + 1, season, { value: r.gain, display: `${pct(r.was.share)} → ${pct(r.share)}` })), season, "rank", { label: "OPR standing" }, true));
  }
  // The best rookies: this season's rookie teams by OPR.
  if ((m = /^(?:the\s+)?(?:best|top|strongest)(?:\s+\d+)?\s+rookies?(?:\s+teams?)?(?:\s+(?:in|from)\s+(.+?))?$/.exec(t))) {
    const p = m[1] ? await placeOf(cased(q, m[1])) : null;
    if (m[1] && !p) return null;
    const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} AND t.rookie_year = s.season${placeSql(p)} ORDER BY s.opr_np DESC, s.team LIMIT 10`, [season, ...placeArgs(p)]);
    const title = `Best rookie teams${p ? ` in ${p.name}` : ""} · ${seasonLabel(season)}`;
    const lines = rows.map((r, i) => lineOf(r, [`#${i + 1}`, `OPR ${fmt1(r.opr_np)}`, `${r.wins}-${r.losses}-${r.ties}`], season));
    return card(title, lines, `No rookie team${p ? ` in ${p.name}` : ""} has ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.`, [{ title: "Rankings", href: `/rankings?season=${season}` }], `${title}: teams in their rookie season, by OPR without penalties`, tableOf(rows, season));
  }
  // Rookies, the oldest and the newest teams, by FIRST's rookie year (a season's start year).
  if ((m = /^(rookie|oldest|newest|youngest|first[\s-]year|veteran)\s+teams?(?:\s+(?:in|from)\s+(.+?))?(?:\s+this season)?$/.exec(t))) {
    const p = m[2] ? await placeOf(cased(q, m[2])) : null;
    if (m[2] && !p) return null;
    const kind = m[1].replace(/[\s-]/g, "");
    const rookie = kind === "rookie" || kind === "firstyear";
    const oldest = kind === "oldest" || kind === "veteran";
    const rows = await all<any>(`SELECT t.number, t.name, t.city, t.state, t.country, t.rookie_year FROM teams t JOIN team_seasons ts ON ts.team = t.number AND ts.season = ? WHERE t.rookie_year IS NOT NULL AND ${teamPageSql("t.number", "t.name")}${rookie ? " AND t.rookie_year = ?" : ""}${placeSql(p)} ORDER BY ${oldest ? "t.rookie_year ASC, t.number ASC" : "t.rookie_year DESC, t.number DESC"} LIMIT 10`, [CURRENT_SEASON, ...(rookie ? [CURRENT_SEASON] : []), ...placeArgs(p)]);
    const word = rookie ? "Rookie teams" : oldest ? "Oldest teams" : "Newest teams";
    const title = `${word}${p ? ` in ${p.name}` : ""} · registered for ${seasonLabel(CURRENT_SEASON)}`;
    const lines = rows.map((r) => lineOf(r, [`Rookie year ${seasonLabel(Number(r.rookie_year))}`]));
    return card(title, lines, `No ${word.toLowerCase()}${p ? ` in ${p.name}` : ""} found.`, [{ title: "Browse the teams", href: "/teams" }], `${title}, by FIRST's rookie year`);
  }
  // An average OPR: "average opr in nj".
  if ((m = /^(?:the\s+)?(?:average|mean|avg)\s+opr(?:\s+(?:in|of|for)\s+(.+?))?(?:\s+this season)?$/.exec(t))) {
    const p = m[1] ? await placeOf(cased(q, m[1])) : null;
    if (m[1] && !p) return null;
    const row = await get<any>(`SELECT AVG(s.opr_np) a, COUNT(*) n, MAX(s.opr_np) hi FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE ${ranked} AND s.opr_np IS NOT NULL${placeSql(p)}`, [season, ...placeArgs(p)]);
    const title = `Average OPR${p ? ` in ${p.name}` : ""} · ${seasonLabel(season)}`;
    const n = Number(row?.n ?? 0);
    const lines: SearchCardLine[] = n ? [{ text: `${fmt1(row.a)} average OPR`, detail: `Over ${n.toLocaleString("en-US")} teams with ${RANKED_MIN_MATCHES}+ matches; highest ${fmt1(row.hi)}. Season OPR without penalties`, href: `/rankings?season=${season}${p ? `&region=${encodeURIComponent(p.key)}` : ""}` }] : [];
    return answer(q, { hits: [], pages: [{ title: "Rankings", href: `/rankings?season=${season}` }], card: { kind: "info", title, lines, ...(n ? {} : { none: `No ranked teams${p ? ` in ${p.name}` : ""} for ${seasonLabel(season)} yet.` }) }, understood: { kind: "question", label: title } });
  }
  // A place's teams at Worlds: "nj teams at worlds", "teams from new jersey at worlds".
  if ((m = /^(.+?)\s+teams?\s+(?:at|in|to|who went to|that went to)\s+(?:the\s+)?(?:worlds|first championship|world championship)(?:\s+(20\d\d))?$/.exec(t)) || (m = /^teams?\s+from\s+(.+?)\s+(?:at|in|to)\s+(?:the\s+)?(?:worlds|first championship|world championship)(?:\s+(20\d\d))?$/.exec(t))) {
    const p = await placeOf(cased(q, m[1].replace(/^(?:which|what)\s+/, "")));
    if (!p) return null;
    // "worlds 2025" is the championship held in 2025: the 2024–25 season's.
    const rows = await all<any>(`SELECT x.season, x.team, t.name, t.city, t.state, t.country, x.wins, x.losses, x.ties, x.opr_np, e.name event
      FROM team_event_stats x JOIN events e ON e.season = x.season AND e.code = x.code JOIN teams t ON t.number = x.team
      WHERE e.type = 'FIRSTChampionship' AND x.matches > 0${placeSql(p)}${m[2] ? " AND x.season = ?" : ""}
      ORDER BY x.season DESC, x.opr_np DESC LIMIT 40`, [...placeArgs(p), ...(m[2] ? [Number(m[2]) - 1] : [])]);
    const lines = rows.map((r) => ({ ...lineOf(r, [seasonLabel(Number(r.season)), `${r.wins}-${r.losses}-${r.ties}`, `OPR ${fmt1(r.opr_np)}`], Number(r.season)), detail: `${String(r.event).replace(/^FIRST Championship\s*-\s*(?:FIRST Tech Challenge\s*-\s*)?/, "")} · ${[r.city, r.state].filter(Boolean).join(", ")}` }));
    const title = `${p.name} teams at the FIRST Championship (Worlds)${m[2] ? ` ${m[2]}` : ""}`;
    return card(title, lines, `No ${p.name} team has played at the FIRST Championship in the recorded seasons.`, [{ title: "Events", href: "/events" }], `${title}, newest season first`);
  }
  return null;
}

type Fact = "school" | "place" | "rookie" | "website" | "sponsors" | "name" | "region" | "summary";

const FACT_WORDS: [RegExp, Fact][] = [
  [/^(?:school|schools|organization|organisation|org|high school|(?:school|organization|organisation|org) name)$/, "school"],
  [/^(?:location|city|town|hometown|from|located|based|city (?:and|&) state|city state)$/, "place"],
  [/^(?:rookie year|rookie season|founded|year founded|start|started)$/, "rookie"],
  [/^(?:website|site|homepage)$/, "website"],
  [/^(?:sponsors?)$/, "sponsors"],
  [/^(?:name|team name|called)$/, "name"],
  [/^(?:region|home region|first region|state)$/, "region"],
  [/^(?:(?:team |scouting )?profile(?: summary)?|(?:team )?page summary|(?:team )?summary|(?:team )?overview|at a glance)$/, "summary"],
];

/** The words that ask for one of a team's listing facts, as the end of a query (longest first). */
const FACT_PHRASES = [
  "team profile summary|scouting profile summary|profile summary|team profile|scouting profile|profile|team page summary|page summary|team summary|summary|team overview|overview|at a glance",
  "high school|school name|organization name|organisation name|org name|schools|school|organization|organisation|org",
  "city and state|city & state|city state|location|city|town|hometown|rookie year|rookie season|year founded|founded|website|site|homepage|sponsors?",
  "team name|name|home region|first region|region|state",
].join("|");

/** The season a team card's numbers are from when the query names none: the latest completed one (its FIRST
 *  Championship played), so a season that has only just started never stands in for the team's last full one. */
async function completedSeason(): Promise<number> {
  const r = await get<{ s: number | null }>("SELECT MAX(e.season) s FROM events e WHERE e.type = 'FIRSTChampionship' AND e.season <= ? AND EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1)", [CURRENT_SEASON]);
  return r?.s != null ? Number(r.s) : CURRENT_SEASON - 1;
}

/** A team's FIRST home region, named: "USNJ" for a New Jersey team is "New Jersey"; a region of its own ("USTXHO")
 *  keeps its code beside the state's name. None stored: unknown (a state can hold several regions). */
function regionText(code: string | null, state: string | null, country: string | null): string | null {
  const iso = country === "USA" ? "US" : country === "Canada" ? "CA" : null;
  const st = state && iso ? stateName(iso, state) : null;
  const named = st && st !== state!.toUpperCase() ? st : null;
  if (!code) return null;
  if (named && iso && code.toUpperCase() === `${iso}${state!.toUpperCase()}`) return named;
  return named ? `${named} (${code})` : code;
}

/** A team's own facts from FIRST's listing: "12345 school", "where is 12345 from", "12345 rookie year", "12345 website";
 *  its name and region; and its profile ("12345 team profile summary"): the team page's numbers for one season. */
export async function teamFactAnswer(q: string, prefer: ReadonlySet<string>): Promise<SearchAnswer | null> {
  const raw = squash(q.toLowerCase().replace(/[?]/g, ""));
  // A season named anywhere ("12345 profile 2024-25", "12345 2024-25 profile", "12345 record this season") is the season of
  // the card's numbers, and never part of the team's name. "This season" is the latest completed one, "last" the one before.
  const sm = new RegExp(`(?:^|\\s)(?:in\\s+|for\\s+)?${SEASON_WORDS}(?=\\s|$)`).exec(raw);
  const full = sm ? squash(raw.replace(sm[0], " ")) : raw;
  // A second question about the same team ("where is bad wolf from and what is their record"): its season number is
  // asked too, and shown with the fact rather than under it.
  const also = /\s+(?:and|&)\s+(?:what(?:'s| is| are| was| were)\s+|how\s+(?:is|was|are)\s+)?(?:their|its|the\s+team's)\s+(record|opr|rating|reliability)$/.exec(full);
  const t = also ? full.slice(0, also.index) : full;
  const alsoLabel: string | null = also ? ({ record: "Record", opr: "OPR", rating: "Rating", reliability: "Reliability" } as Record<string, string>)[also[1]] : null;
  const named = /^(?:what(?:'s| is)\s+)?(?:the\s+)?name\s+of\s+(.+)$/.exec(t);
  const said = /^where\s+(?:is|are)\s+(.+?)\s+(from|located|based)$/.exec(t)
    ?? /^what(?:'s| is| are)\s+(.+?)\s+(called)$/.exec(t)
    ?? new RegExp(`^(?:what(?:'s| is)\\s+)?(.+?)(?:'s)?\\s+(${FACT_PHRASES})$`).exec(t)
    ?? /^when\s+(?:was|did)\s+(.+?)\s+(founded|start|started)$/.exec(t);
  // [who, the fact's words]
  const m = named ? [named[1], "name"] : said ? [said[1], said[2]] : null;
  if (!m) return null;
  const last = FACT_WORDS.find(([w]) => w.test(m[1]))?.[1];
  if (!last) return null;
  const teamHit = async (n: string) => (await search(String(Number(n)), 5, prefer, new Set(["team"]))).find((h) => h.kind === "team" && h.ref === String(Number(n)));
  const find = async (who: string) => {
    if (/^\d{1,6}$/.test(who)) return teamHit(who);
    // A number with the team's own name after it ("67890 bad wolf"): that team, when the name is its own.
    const nm = /^(\d{1,6})\s+(.+)$/.exec(who);
    const h = nm ? await teamHit(nm[1]) : undefined;
    if (h && normalize(teamNameOf(h.title)) === normalize(nm![2])) return h;
    return (await search(who, 5, prefer, new Set(["team"]))).find((x) => x.kind === "team" && normalize(teamNameOf(x.title)) === normalize(who));
  };
  // More than one fact asked at once ("12345 sponsors school", "12345 rookie year, website and sponsors"): each is
  // answered. The whole name is tried first, so a team named with a fact word ("River City") is never cut short.
  let who = m[0].replace(/^(?:team|ftc)\s+/, "");
  const facts: Fact[] = [last];
  let hit = await find(who);
  for (let p: RegExpExecArray | null; !hit && (p = new RegExp(`^(.+?)[\\s,]+(?:and\\s+|&\\s+)?(${FACT_PHRASES})$`).exec(who.replace(/,?\s+(?:and|&)$/, "")));) {
    const f = FACT_WORDS.find(([w]) => w.test(p![2]))?.[1];
    if (!f) break;
    if (!facts.includes(f)) facts.unshift(f);
    who = p[1].replace(/^(?:team|ftc)\s+/, "");
    hit = await find(who);
  }
  if (!hit) return null;
  const number = Number(hit.ref);
  const row = await get<any>("SELECT school, city, state, country, rookie_year, website, sponsors, home_region FROM teams WHERE number = ?", [number]);
  if (!row) return null;
  const name = nameOf(hit);
  const team = { number, name: teamNameOf(hit.title) };
  // The team page's numbers for one season (seasonStats, ./teams.ts: the same stored row the page reads, nothing
  // worked out here): the season asked, else the latest completed season, else the team's latest with matches.
  const done = await completedSeason();
  const asked = !sm ? null : /^(?:this)/.test(sm[1]) ? done : /^(?:last|previous)/.test(sm[1]) ? done - 1 : Number(sm[1].slice(0, 4));
  let season = asked ?? done;
  let st = await seasonStats(season, number);
  if (asked == null && !st?.record.matches) {
    const latest = await get<{ s: number | null }>("SELECT MAX(season) s FROM team_season_stats WHERE team = ? AND matches > 0", [number]);
    st = latest?.s != null ? await seasonStats((season = Number(latest.s)), number) : null;
  }
  // A season asked that the team didn't play has no numbers: said so, never another season's.
  if (!st?.record.matches) st = null;
  const S = seasonLabel(season);
  const place = [row.city, row.state, row.country].filter(Boolean).join(", ") || null;
  const region = regionText(row.home_region ?? null, row.state ?? null, row.country ?? null);
  const LABEL: Record<Fact, string> = { school: "School or organization", place: "Where they're from", rookie: "Rookie year", website: "Website", sponsors: "Sponsors", name: "Team name", region: "Region", summary: "Team profile" };
  // Titles name the facts short and in sentence case ("Sponsors and school"); each line keeps its full label.
  const TITLE: Record<Fact, string> = { ...LABEL, school: "School" };
  const read = (fact: Fact): { text: string | null; detail?: string } => {
    if (fact === "school") return { text: row.school ? String(row.school) : null };
    if (fact === "place") return { text: place };
    if (fact === "rookie") return row.rookie_year ? { text: `Rookie season ${seasonLabel(Number(row.rookie_year))}`, detail: `${CURRENT_SEASON - Number(row.rookie_year) + 1} seasons, this one included` } : { text: null };
    if (fact === "website") return { text: row.website ? String(row.website) : null };
    if (fact === "name") return { text: team.name || null, detail: `Team ${number}` };
    if (fact === "region") return region ? { text: region, detail: "FIRST home region" } : { text: null };
    if (fact === "summary") return { text: [name, place].filter(Boolean).join(" · ") };
    let s: string[] = [];
    try { s = JSON.parse(row.sponsors ?? "[]"); } catch { /* not a list */ }
    return { text: s.length ? s.join(", ") : null };
  };
  // Each fact's values apart, exactly as stored (FIRST's listing cuts some school names short; they're shown as stored).
  const values = (fact: Fact): string[] => {
    if (fact !== "sponsors") { const t = read(fact).text; return t ? [t] : []; }
    try { const s = JSON.parse(row.sponsors ?? "[]"); return Array.isArray(s) ? s.map(String).filter(Boolean) : []; } catch { return []; }
  };
  const factOf = (f: Fact): SearchCardFact => ({ label: LABEL[f], values: values(f), ...(read(f).detail ? { detail: read(f).detail } : {}), ...(f === "website" ? { link: true } : {}) });
  // The season's numbers as the team page shows them (num, src/shared/format.ts): record, OPR with its world rank,
  // rating ± its uncertainty, reliability.
  const of = Number(st?.opr.np.of) || 0;
  const numbers: SearchCardFact[] = st ? [
    { label: `Record, ${S}`, values: [`${st.record.wins ?? 0}-${st.record.losses ?? 0}-${st.record.ties ?? 0}`], detail: `${st.record.matches ?? 0} matches at ${st.record.events ?? 0} event${st.record.events === 1 ? "" : "s"}` },
    ...(st.opr.np.value != null ? [{ label: `OPR, ${S}`, values: [num(st.opr.np.value)], ...(st.opr.np.rank && of ? { detail: `#${Number(st.opr.np.rank).toLocaleString("en-US")} of ${of.toLocaleString("en-US")} worldwide` } : {}) }] : []),
    ...(st.rating ? [{ label: `Rating, ${S}`, values: [`${num(st.rating.np)}${st.rating.sd != null ? ` ± ${num(st.rating.sd)}` : ""}`], detail: "The prediction rating, ± its uncertainty" }] : []),
    ...(st.reliability ? [{ label: `Reliability, ${S}`, values: [`${st.reliability.index} out of 100`], ...(st.reliability.fieldIndex != null ? { detail: `Field average ${st.reliability.fieldIndex}` } : {}) }] : []),
  ] : [];
  const related = ["record", "awards", "opr"].map((x) => `${hit.ref} ${x}`);
  // The number asked with the fact ("… and what is their record"), when the team has one that season.
  const asked2 = alsoLabel ? numbers.find((f) => f.label.startsWith(`${alsoLabel},`)) ?? null : null;

  if (facts.includes("summary")) {
    // One card, every line the team page's: who and where, rookie year, and the season's numbers.
    const profile: SearchCardFact[] = [
      factOf("name"), factOf("place"), ...(region ? [factOf("region")] : []),
      ...(row.rookie_year ? [{ label: "Rookie year", values: [String(row.rookie_year)], detail: `First season ${seasonLabel(Number(row.rookie_year))}` }] : []),
      // Anything else asked with it ("12345 school and profile"), each as its own fact.
      ...facts.filter((f) => !["summary", "name", "place", "region", "rookie"].includes(f)).map(factOf),
      ...numbers,
    ];
    const why = asked != null ? `${S}, the season asked` : season === done ? `${S}, the latest completed season` : `${S}, the team's latest season with matches`;
    return answer(q, {
      hits: [{ ...hit, match: "exact" }], pages: pagesFor(q),
      card: {
        kind: "info", title: `Team profile, ${S}`, team, season, facts: profile, related,
        lines: [{ text: read("summary").text!, detail: [row.rookie_year ? `Rookie ${row.rookie_year}` : null, why].filter(Boolean).join(" · "), results: numbers.map((f) => `${f.label.replace(/,.*$/, "")} ${f.values[0]}`), href: `/teams/${hit.ref}?season=${season}` }],
        ...(st ? {} : { none: asked != null ? `${name} has no matches on record in ${S}.` : `${name} has no matches on record yet, so there are no season numbers.` }),
      },
      understood: { kind: "team", label: `${name} · team profile, ${S}` },
    });
  }

  // Under the facts asked, the rest of the team's card: where it's from, its region and the season's numbers, so
  // every fact answer can be drawn as a full team card. Only what wasn't asked.
  // A school FIRST doesn't list is said so, and where the team is from is given with it (it's on the listing).
  const from = facts.length === 1 && last === "school" && !row.school ? place : null;
  const support: SearchCardFact[] = [
    ...(!facts.includes("place") && !from && place ? [factOf("place")] : []),
    ...(!facts.includes("region") && region ? [factOf("region")] : []),
    ...numbers.filter((f) => f !== asked2),
  ];
  const extra = { season, ...(support.length ? { support } : {}) };
  if (facts.length > 1) {
    // Each fact on its own line, named; one FIRST's listing doesn't have is said so on its line.
    const what = [...facts.map((f, i) => (i ? TITLE[f].toLowerCase() : TITLE[f])), ...(alsoLabel ? [alsoLabel === "OPR" ? alsoLabel : alsoLabel.toLowerCase()] : [])].join(" and ");
    return answer(q, {
      hits: [{ ...hit, match: "exact" }], pages: pagesFor(q),
      card: { kind: "info", title: what, team, facts: [...facts.map(factOf), ...(asked2 ? [asked2] : [])], related, ...extra, lines: [...facts.map((f) => { const r = read(f); return { text: `${LABEL[f]}: ${r.text ?? "not in FIRST's listing"}`, ...(r.detail ? { detail: r.detail } : {}), href: `/teams/${hit.ref}` }; }), ...(asked2 ? [{ text: `${asked2.label}: ${asked2.values[0]}`, href: `/teams/${hit.ref}?season=${season}` }] : [])],
        ...(alsoLabel && !asked2 ? { none: `${name} has no ${alsoLabel === "OPR" ? alsoLabel : alsoLabel.toLowerCase()} on record in ${S}.` } : {}) },
      understood: { kind: "team", label: `${name} · ${what}` },
    });
  }
  const { text, detail } = read(last);
  // A number asked with it names both ("Where they're from and record"); one the team doesn't have that season is said.
  const what = alsoLabel ? `${TITLE[last]} and ${alsoLabel === "OPR" ? alsoLabel : alsoLabel.toLowerCase()}` : TITLE[last];
  // The card names the fact; its team is on the card already (card.team), so the page never says the team twice.
  const title = `${name} · ${what}`;
  const alsoLine = asked2 ? [{ text: `${asked2.label}: ${asked2.values[0]}`, ...(asked2.detail ? { detail: asked2.detail } : {}), href: `/teams/${hit.ref}?season=${season}` }] : [];
  return answer(q, {
    hits: [{ ...hit, match: "exact" }], pages: pagesFor(q),
    card: {
      kind: "info", title: what, team, facts: [factOf(last), ...(from ? [factOf("place")] : []), ...(asked2 ? [asked2] : [])], related, ...extra,
      lines: [...(text ? [{ text, ...(detail ? { detail } : {}), href: `/teams/${hit.ref}` }] : from ? [{ text: from, detail: "Where they're from", href: `/teams/${hit.ref}` }] : []), ...alsoLine],
      ...(text && (!alsoLabel || asked2) ? {} : { none: [text ? "" : `FIRST's listing for ${name} has no ${TITLE[last].toLowerCase()}.${from ? ` The team is from ${place}.` : ""}`, alsoLabel && !asked2 ? `${name} has no ${alsoLabel === "OPR" ? alsoLabel : alsoLabel.toLowerCase()} on record in ${S}.` : ""].filter(Boolean).join(" ") }),
    },
    understood: { kind: "team", label: title },
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "events in january", "league meets in NJ in december": the season's events held that month. The season runs
 *  from September to August, so January to August are its second calendar year. */
export async function monthAnswer(q: string, now?: number): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, ""));
  const m = new RegExp(`^(.*?\\b(?:events?|meets?|qualifiers?|championships?|scrimmages?|tournaments?|competitions?)\\b.*?)\\s+(?:in|during)\\s+(${MONTHS.join("|")})(?:\\s+(20\\d\\d))?$`).exec(t);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]) + 1;
  // The season runs September to August: September to December are its first calendar year.
  const year = m[3] ? Number(m[3]) : month >= 9 ? CURRENT_SEASON : CURRENT_SEASON + 1;
  const what = cased(q, m[1]);
  const ev = readEventQuery(`${what} ${year}`);
  if (!ev) return null;
  // The year's set, then that month's: its own count, and its own "none".
  const a = await eventSetAnswer(`${what} ${year}`, ev, { now });
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const events = a.hits.filter((h) => h.kind === "event" && ((h.event?.start ?? "").startsWith(ym) || (h.event?.end ?? "").startsWith(ym)));
  const label = `${(a.understood?.label ?? "Events").replace(/:.*$/, "").replace(/ held in \d{4}$/, "")} in ${titleCase(m[2])} ${year}`;
  const understood = { ...(a.understood ?? { kind: "events" as const }), label, total: events.length };
  if (events.length) return { ...a, q, hits: events, understood };
  const none = `No events on record in ${titleCase(m[2])} ${year}`;
  return {
    q, hits: [], pages: a.pages, step: "recovery", weak: true, understood: { ...understood, label: `${label}: ${none.toLowerCase()}` },
    recovery: { understood: [label, none], closest: (a.hits.some((h) => h.kind === "event") ? a.hits.filter((h) => h.kind === "event") : a.recovery?.closest ?? []).slice(0, 10), browse: a.recovery?.browse ?? SEARCH_BROWSE },
  };
}

/** "teams in New Jersey", "nj teams", "teams in Oradell", "texas ftc teams": a place's teams, best first. */
export async function placeTeamsAnswer(q: string, prefer: ReadonlySet<string>): Promise<SearchAnswer | null> {
  const t = squash(q.toLowerCase().replace(/[?]/g, "").replace(/\bftc\b/g, " "));
  const m = /^(?:all\s+)?(?:the\s+)?teams?\s+(?:in|from|based in)\s+(.+)$/.exec(t) ?? /^(.+?)\s+teams?$/.exec(t); // "teams" as search singularizes it too
  if (!m) return null;
  // "best team", "top teams" (place-first only): the leaderboards' (./searchAsks.ts), never a place called "best".
  // "Teams in Great Britain" names its place after "in", so it's never read this way.
  if (!/^(?:all\s+)?(?:the\s+)?teams?\s/.test(t) && /\b(?:best|top|strongest|highest|most|worst|rookie|oldest|newest|undefeated)\b/.test(m[1])) return null;
  const p = await placeOf(cased(q, m[1]));
  const season = searchSeason();
  if (p) {
    const rows = await all<any>(`SELECT s.team, t.name, t.city, t.state, t.country, s.opr_np, ${PHASE_COLS}, s.wins, s.losses, s.ties FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE s.season = ? AND s.matches >= ${RANKED_MIN_MATCHES} AND ${teamPageSql("s.team", "t.name")}${placeSql(p)} ORDER BY s.opr_np DESC, s.team LIMIT 25`, [season, ...placeArgs(p)]);
    const n = await get<{ n: number }>(`SELECT COUNT(*) n FROM team_seasons ts JOIN teams t ON t.number = ts.team WHERE ts.season = ?${placeSql(p)}`, [CURRENT_SEASON, ...placeArgs(p)]);
    const lines = rows.map((r, i) => lineOf(r, [`#${i + 1}`, `OPR ${fmt1(r.opr_np)}`, `${r.wins}-${r.losses}-${r.ties}`], season));
    const title = `Teams in ${p.name}`;
    return answer(q, {
      hits: [], pages: [{ title: `${p.name} rankings`, href: `/rankings?season=${season}&region=${encodeURIComponent(p.key)}` }],
      card: { kind: "leaderboard", title: `${title} · best by OPR, ${seasonLabel(season)}`, lines, ...(lines.length ? { table: tableOf(rows, season) } : { none: `No team in ${p.name} has ${RANKED_MIN_MATCHES}+ matches in ${seasonLabel(season)} yet.` }) },
      understood: { kind: "question", label: `${title}: ${Number(n?.n ?? 0).toLocaleString("en-US")} registered for ${seasonLabel(CURRENT_SEASON)}, best by OPR first` },
    });
  }
  // A town: its teams, by FIRST's listing, as team results.
  const town = m[1].replace(/^the\s+/, "");
  const rows = await all<{ number: number }>(`SELECT t.number FROM teams t WHERE LOWER(t.city) = LOWER(?) AND ${teamPageSql("t.number", "t.name")} ORDER BY t.number LIMIT 25`, [town]);
  if (!rows.length) return null;
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const h = (await search(String(r.number), 3, prefer, new Set(["team"]))).find((x) => x.kind === "team" && x.ref === String(r.number));
    if (h) hits.push({ ...h, match: "exact" });
  }
  return answer(q, { hits, pages: pagesFor(q), understood: { kind: "names", label: `Teams in ${titleCase(town)} (${hits.length})` } });
}
