// FTC One Search's word lists for the layered query path (./searchLayers.ts, docs/search-layers.md): every intent the
// keyword layer can reach, the words that say it, the scope each accepts, and the one phrasing it hands to that
// intent's answer. Data, reviewed like code; every entry has a test (./searchLayers.test.ts).

/** Who an intent is about: a team it needs, may have, or must not have. */
export type TeamRule = "required" | "optional" | "forbidden";
export type ScopeKind = "season" | "place" | "event";

/** What the keyword layer found: the team(s), the intent's modifiers and the scope, as the canonical phrasing reads them. */
export interface Found {
  teams: string[];
  /** A phase (auto, teleop, endgame) and an award name, when typed. */
  phase?: "auto" | "teleop" | "endgame";
  award?: string;
  /** Scope as the answers read it: a season as typed ("2024-25", "decode", "last season"), a place by its name, an
   *  event's words. */
  season?: string;
  place?: string;
  event?: string;
  /** Words that only shape how it was asked ("who wins", "appearances", "record"). */
  extra: Set<string>;
}

export interface Intent {
  id: string;
  /** The family it belongs to, for the coverage table. */
  family: string;
  /** Strong keywords (any one, with the team rule met, is the intent). Phrases are words joined by spaces. */
  words: string[];
  team: TeamRule;
  scope: ScopeKind[];
  /** The phrasing the existing answer reads, or null when the found pieces don't make one. */
  canonical: (f: Found) => string | null;
}

const T = (f: Found) => f.teams[0];
const at = (f: Found) => (f.event ? ` at ${f.event}` : "");
const PHASE_LABEL = { auto: "auto", teleop: "teleop", endgame: "endgame" } as const;

/** The intent catalog. Order is not precedence: precedence is PRECEDENCE below. */
export const INTENTS: Intent[] = [
  // A team's own facts (searchCoverage.ts teamFactAnswer).
  { id: "location", family: "team facts", words: ["from", "location", "located", "hometown", "come from", "comes from"], team: "required", scope: [], canonical: (f) => `${T(f)} location` },
  { id: "school", family: "team facts", words: ["school", "high school", "organization"], team: "required", scope: [], canonical: (f) => `${T(f)} school` },
  { id: "sponsors", family: "team facts", words: ["sponsor", "sponsors", "sponsored"], team: "required", scope: [], canonical: (f) => `${T(f)} sponsors` },
  { id: "rookie-year", family: "team facts", words: ["rookie year", "rookie", "founded"], team: "required", scope: [], canonical: (f) => `${T(f)} rookie year` },
  { id: "website", family: "team facts", words: ["website", "web site", "site", "url"], team: "required", scope: [], canonical: (f) => `${T(f)} website` },
  // A team's stats (answers/families/facts.ts and trends.ts).
  { id: "opr", family: "team stats", words: ["opr", "oprs"], team: "required", scope: ["season"],
    canonical: (f) => `${T(f)} ${f.phase ? `${PHASE_LABEL[f.phase]} ` : ""}opr${f.season ? ` ${f.season}` : ""}` },
  { id: "rating", family: "team stats", words: ["rating", "prediction rating", "predicted rating", "prediction", "predicted"], team: "required", scope: ["season"],
    canonical: (f) => `${T(f)} prediction rating${f.season ? ` ${f.season}` : ""}` },
  { id: "record", family: "record", words: ["record", "wins", "losses", "win loss", "w l", "wins and losses"], team: "required", scope: ["season", "event"],
    canonical: (f) => (f.event ? `${T(f)} record${at(f)}` : `${T(f)} record${f.season ? ` ${f.season}` : ""}`) },
  { id: "win-rate", family: "record", words: ["win rate", "win percentage"], team: "required", scope: [], canonical: (f) => `${T(f)} win rate` },
  { id: "rank", family: "record", words: ["rank", "ranking", "ranked", "standing"], team: "required", scope: ["place"],
    canonical: (f) => (f.place ? `${T(f)} rank in ${f.place}` : `${T(f)} rank`) },
  { id: "matches", family: "matches", words: ["matches", "match", "games", "schedule", "fixtures"], team: "required", scope: ["event"], canonical: (f) => `${T(f)} matches${at(f)}` },
  { id: "high-score", family: "matches", words: ["highest score", "high score", "best score", "top score", "highest scores"], team: "required", scope: [], canonical: (f) => `${T(f)} highest score` },
  { id: "next-match", family: "next and last", words: ["next match", "next game", "upcoming match"], team: "required", scope: [], canonical: (f) => `${T(f)} next match` },
  { id: "next-event", family: "next and last", words: ["next event", "upcoming event", "next competition"], team: "required", scope: [], canonical: (f) => `${T(f)} next event` },
  { id: "last-event", family: "next and last", words: ["last event", "most recent event", "latest event", "previous event"], team: "required", scope: [], canonical: (f) => `${T(f)} last event` },
  { id: "last-match", family: "next and last", words: ["last match", "last game", "most recent match", "latest match", "previous match"], team: "required", scope: [], canonical: (f) => `${T(f)} last match` },
  { id: "awards", family: "awards", words: ["awards", "award"], team: "required", scope: ["season", "event"],
    // An award name at an event has no one phrasing the answers read: it isn't guessed.
    canonical: (f) => (f.event ? (f.award ? null : `${T(f)} awards${at(f)}`) : `${T(f)} ${f.award ? `${f.award} award` : "awards"}${f.season ? ` ${f.season}` : ""}`) },
  { id: "events", family: "events", words: ["events", "event"], team: "required", scope: ["season", "place"],
    // No season named: the default (searchLayers.ts) fills in the team's latest season with an event.
    canonical: (f) => (f.place && !f.season ? `${T(f)} events in ${f.place}` : f.season ? `${T(f)} events in ${f.season}` : null) },
  { id: "worlds", family: "worlds and states", words: ["worlds", "world championship", "first championship"], team: "required", scope: [],
    canonical: (f) => `${T(f)} worlds${f.extra.has("record") ? " record" : ""}` },
  { id: "states", family: "worlds and states", words: ["states", "state championship", "state championships"], team: "required", scope: [], canonical: (f) => `${T(f)} states` },
  { id: "reliability", family: "team stats", words: ["reliability", "reliable"], team: "required", scope: [], canonical: (f) => `${T(f)} reliability` },
  { id: "league-rank", family: "team stats", words: ["league rank", "league standing", "league ranking"], team: "required", scope: [], canonical: (f) => `${T(f)} league rank` },
  { id: "report-card", family: "team stats", words: ["report card"], team: "required", scope: [], canonical: (f) => `${T(f)} report card` },
  // Two teams (searchCompare.ts): read before any one team's intent.
  { id: "versus", family: "versus", words: ["vs", "versus", "v", "compare", "head to head", "better than"], team: "optional", scope: [],
    canonical: (f) => (f.teams.length === 2 ? `${f.teams[0]} vs ${f.teams[1]}${f.extra.has("who wins") ? " who wins" : ""}` : null) },
  // No team: a leaderboard, a count, winners, a meaning.
  { id: "leaderboard", family: "leaderboards", words: ["top", "best", "highest", "most", "leaders", "leaderboard", "strongest"], team: "forbidden", scope: ["place"],
    canonical: (f) => { const stat = [...f.extra].find((w) => LEADER_STATS[w]); return stat ? `${LEADER_STATS[stat](f)}${f.place ? ` in ${f.place}` : ""}` : null; } },
  { id: "count", family: "counts", words: ["how many", "number of", "count"], team: "forbidden", scope: ["place", "season"],
    canonical: (f) => { const n = f.extra.has("teams") ? "teams" : f.extra.has("events") ? "events" : null; return n && (f.place || !f.season) ? `how many ${n}${f.place ? ` in ${f.place}` : ""}` : null; } },
  { id: "winners", family: "winners", words: ["won", "winner", "winners", "champion", "champions", "who won"], team: "forbidden", scope: ["event", "season"],
    canonical: (f) => (f.event ? `who won ${f.award ? `${f.award} at ` : ""}${f.event}${f.season ? ` ${f.season}` : ""}` : f.extra.has("worlds") ? `who won worlds${f.season ? ` ${f.season}` : ""}` : null) },
  { id: "meaning", family: "meanings", words: ["define", "definition", "meaning", "means", "mean"], team: "forbidden", scope: [], canonical: () => null },
];

/** A leaderboard's stat word and the phrasing the leaderboard answer reads (answers/families/leaderboard.ts and the
 *  win-rate card in searchAsks.ts). "teams" alone is the prediction rating's board, as "top teams" is today. */
const LEADER_STATS: Record<string, (f: Found) => string> = {
  opr: (f) => `top ${f.phase ? `${PHASE_LABEL[f.phase]} ` : ""}opr`,
  auto: () => "top auto opr", teleop: () => "top teleop opr", endgame: () => "top endgame opr",
  wins: () => "most wins", "win rate": () => "highest win rate",
  rating: () => "top teams", "prediction rating": () => "top teams", teams: () => "top teams",
};
export const LEADER_STAT_WORDS = Object.keys(LEADER_STATS);

/** A phase is its own stat word: "4215 auto" is the team's Auto OPR, "best auto" the Auto OPR leaderboard. */
export const PHASES: Record<string, Found["phase"]> = { auto: "auto", autonomous: "auto", teleop: "teleop", endgame: "endgame" };

/** Award names in the data: a name narrows the awards (or winners) intent, never a team-name search. */
export const AWARDS = ["inspire", "think", "connect", "design", "innovate", "motivate", "control", "reach", "sustain", "compass", "promote", "judges"];

/** Weak signals (Layer 5): a word that points at one intent only when no strong keyword is present. Each lists every
 *  intent it could mean; one candidate is answered, more than one is named and never guessed. */
export const WEAK_SIGNALS: Record<string, string[]> = {
  where: ["location"],
  based: ["location"],
  city: ["location"],
  played: ["matches"],
  won: ["awards"],
  win: ["awards", "next-match"],
  good: ["opr"],
  strong: ["opr"],
  stats: ["opr", "record"],
};

/** Layer 3: phrasings people use for an intent, said the way the keyword layer reads them. Each is tried on whole
 *  words only; the reading line names the paraphrase when one was used. */
export const PARAPHRASES: [string, string][] = [
  ["from where", "from"],
  ["where from", "from"],
  ["where are they from", "from"],
  ["where is it from", "from"],
  ["what city", "location"],
  ["what town", "location"],
  ["what state", "location"],
  ["based in", "location"],
  ["what school", "school"],
  ["which school", "school"],
  ["who sponsors", "sponsors"],
  ["when did start", "rookie year"],
  ["first season", "rookie year"],
  ["start year", "rookie year"],
  ["offensive power rating", "opr"],
  ["tele op", "teleop"],
  ["driver controlled", "teleop"],
  ["end game", "endgame"],
  ["autonomous", "auto"],
  ["how many wins", "wins"],
  ["win loss record", "record"],
  ["games played", "matches"],
  ["matches played", "matches"],
  ["upcoming game", "next match"],
  ["next competition", "next event"],
  ["next tournament", "next event"],
  ["upcoming competition", "next event"],
  ["most recent competition", "last event"],
  ["last competition", "last event"],
  ["last tournament", "last event"],
  ["trophies", "awards"],
  ["awards won", "awards"],
  ["competitions", "events"],
  ["tournaments", "events"],
  ["world championships", "worlds"],
  ["state champs", "states"],
  ["who would win", "who wins"],
  ["who will win", "who wins"],
  ["leader board", "leaderboard"],
  ["what does mean", "meaning"],
];

/** Layer 4 filler, allowlist only (docs/search-layers.md has each word's justification): words that cannot change
 *  which team, intent, place, season, event, award or stat a query means. Stripped only outside a team's full name. */
export const FILLER: string[] = [
  // Time filler: "right now", carrying no season or date.
  "rn", "right now", "currently", "at the moment", "at this moment",
  // Politeness and softeners.
  "please", "pls", "plz", "just", "really", "basically", "actually", "quick", "kindly",
  // Greetings, only with a team and an intent (filler never makes an intent from nothing).
  "hey", "hi", "hello",
];

/** Question and conversational scaffolding, read by the keyword layer around the team, intent and scope (never by
 *  plain stripping, and never inside a team's full name). */
export const SCAFFOLD: string[] = [
  "what was", "what is", "what's", "whats", "what are", "what", "was", "were", "is", "are", "do", "does", "did", "how", "can", "could",
  "would", "should", "tell me", "show me", "give me", "tell me about", "find", "search", "look up", "lookup", "i want", "i need",
  "called", "named", "this team called", "team called", "team named", "this team", "that team", "the team", "of this team",
  "for this team", "team", "teams", "ftc", "about", "info", "information", "their", "its", "his", "her", "they", "them", "it",
  "who", "which", "when", "there", "any", "all", "list", "much", "many",
  "have", "has", "had", "been", "get", "go", "went", "come", "comes", "came", "know", "me", "you", "your", "i", "we",
  // Connectors, consumed only as glue between the team, the intent and the scope.
  "of", "in", "for", "at", "the", "a", "an", "to", "on", "during", "with",
];

/** Never filler, never ignored (a later layer may still answer, but never by dropping these). */
export const FORBIDDEN: string[] = [
  "not", "never", "no", "without", "except", "excluding",
  "vs", "versus", "or", "and", "than", "better", "worse",
  "before", "after", "next", "last", "this", "yesterday", "today", "tomorrow", "this week", "this month", "this weekend",
];

/** Precedence when two strong intents are found (docs/search-layers.md lists the example that forced each one). A pair
 *  [a, b] means a wins over b; a pair with no rule is ambiguous and never guessed. */
export const PRECEDENCE: [string, string][] = [
  ["next-match", "matches"], ["last-match", "matches"], ["next-event", "events"], ["last-event", "events"],
  ["next-match", "rating"], ["high-score", "matches"], ["league-rank", "rank"], ["report-card", "rating"],
  ["record", "matches"], ["worlds", "record"], ["win-rate", "record"], ["worlds", "events"], ["states", "events"],
  ["awards", "events"], ["school", "location"], ["opr", "rank"], ["rating", "rank"],
];
