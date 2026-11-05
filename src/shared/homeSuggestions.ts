// Home's suggestion chips (src/components/home/HeroSearch.tsx): a pool of real FTC One Search queries, one family of
// answer each, and the six shown this UTC hour. The pick is a pure function of the hour, so every browser shows the
// same six and nothing is fetched for it. Every query here answers with a card on the live site, signed out:
// `npm run suggestions:check` asks the live API for each one and fails on any that doesn't (or says "none found").
// The queries are plain strings; nothing about their answers is stored here.

/** Which family of answer a suggestion shows off: the six on show are never two of one family. */
export type SuggestionKind =
  | "team" | "opr" | "rating" | "record" | "matches" | "awards" | "worlds" | "versus" | "three"
  | "leaderboard" | "winners" | "predict" | "spelling" | "question" | "filters";

/** `q` runs on tap; `label` is the chip's text when the query is too long for a chip (sentence case); `teams`: the
 *  team numbers a query names by name, not number ("hypnotic robotics" is 4215), so a team still shows once. */
export interface HomeSuggestion { q: string; kind: SuggestionKind; label?: string; teams?: readonly string[] }

/** The chip text: its own short label, or the query itself. */
export const suggestionLabel = (s: HomeSuggestion) => s.label ?? s.q;

/** The teams a suggestion is about: the numbers in its query, and any it names by name. */
export const suggestionTeams = (s: HomeSuggestion): string[] => [...(s.q.match(/\b\d{3,5}\b/g) ?? []), ...(s.teams ?? [])];

/** The longest chip label: two such chips share a row wherever the hero lets the chips wrap
 *  (src/components/home/HeroSearch.tsx), so any six fit the three rows it keeps for them. */
export const SUGGESTION_LABEL_MAX = 28;

export const HOME_SUGGESTIONS: readonly HomeSuggestion[] = [
  // Team facts and location
  { q: "Where is 11115 from", kind: "team" },
  { q: "21229 school", kind: "team" },
  { q: "Where is 23314 from", kind: "team" },
  { q: "where is hypnotic robotics from", kind: "team", label: "Where is Hypnotic Robotics", teams: ["4215"] },
  { q: "How many teams in NJ", kind: "team" },
  // OPR and phase OPR
  { q: "19460 OPR", kind: "opr" },
  { q: "14343 auto OPR", kind: "opr" },
  { q: "7149 teleop OPR", kind: "opr" },
  { q: "22105 OPR", kind: "opr" },
  // Prediction rating
  { q: "11260 rating", kind: "rating" },
  { q: "6165 rating", kind: "rating" },
  { q: "23314 rating", kind: "rating" },
  // Records, quals and playoffs apart
  { q: "18061 record", kind: "record" },
  { q: "6165 quals record", kind: "record" },
  { q: "18438 playoff record", kind: "record" },
  { q: "4215 states record", kind: "record" },
  // Matches at an event, states or Worlds
  { q: "7149 matches at worlds", kind: "matches" },
  { q: "19460 matches at worlds", kind: "matches" },
  { q: "6980 matches at P2-8 meet", kind: "matches" },
  { q: "33950 matches at Essex Conference", kind: "matches", label: "33950 at Essex Conference" },
  // Awards
  { q: "3954 awards", kind: "awards" },
  { q: "23014 awards", kind: "awards" },
  { q: "6165 awards", kind: "awards" },
  { q: "How many awards has 7149 won", kind: "awards", label: "7149's award count" },
  // Worlds appearances, first and last
  { q: "When did 7149 go to Worlds", kind: "worlds" },
  { q: "First time 6165 went to Worlds", kind: "worlds", label: "6165's first Worlds" },
  { q: "Last time 9848 went to Worlds", kind: "worlds", label: "9848's last Worlds" },
  // Two teams: compare, partners, opponents
  { q: "6980 vs 16461 who wins", kind: "versus", label: "6980 vs 16461" },
  { q: "11260 vs 3954 opr", kind: "versus" },
  { q: "4215 and 6980 opr", kind: "versus" },
  { q: "6980 partners", kind: "versus" },
  { q: "7149 opponents", kind: "versus" },
  // Three teams
  { q: "4215 vs 6980 vs 33950", kind: "three" },
  { q: "16461 vs 19460 vs 23314", kind: "three" },
  // Leaderboards by place, city, phase, reliability and record
  { q: "Top teams in NJ", kind: "leaderboard" },
  { q: "Highest OPR", kind: "leaderboard" },
  { q: "Top teams in Texas", kind: "leaderboard" },
  { q: "Top teams in California", kind: "leaderboard" },
  { q: "Top teams in Houston", kind: "leaderboard" },
  { q: "Top teams in Canada", kind: "leaderboard" },
  { q: "Best auto OPR", kind: "leaderboard" },
  { q: "Best endgame OPR in Texas", kind: "leaderboard" },
  { q: "Best teleop OPR in Michigan", kind: "leaderboard", label: "Best teleop in Michigan" },
  { q: "Top teams by reliability", kind: "leaderboard" },
  { q: "Top teams by record", kind: "leaderboard" },
  { q: "Top rookie teams", kind: "leaderboard" },
  { q: "Most improved teams", kind: "leaderboard" },
  // An event's winning alliance
  { q: "Who won Worlds", kind: "winners" },
  { q: "Who won NJ states", kind: "winners" },
  { q: "Who won Michigan states", kind: "winners" },
  { q: "Who won Texas state championship", kind: "winners", label: "Who won Texas states" },
  // Predictions: the next event, a match-up
  { q: "Will 6980 win their next event", kind: "predict", label: "6980's next event" },
  { q: "What is 7149's next event", kind: "predict", label: "7149's next event" },
  { q: "16461 vs 6165 who wins", kind: "predict" },
  // Spelling: "Did you mean"
  { q: "hypnotik robotics opr", kind: "spelling", label: "Hypnotik robotics OPR", teams: ["4215"] },
  { q: "infinte turtles record", kind: "spelling", label: "Infinte turtles record", teams: ["16461"] },
  { q: "bad wolff record", kind: "spelling", label: "Bad wolff record", teams: ["6980"] },
  // Questions in a whole sentence
  { q: "when was the first time 7149 went to worlds", kind: "question", label: "7149's first time at Worlds" },
  { q: "what did 4215 do at states", kind: "question", label: "What did 4215 do at states" },
  { q: "What was 7149's record at Worlds", kind: "question", label: "7149's record at Worlds" },
  { q: "which teams has 14343 partnered with the most", kind: "question", label: "14343's top partner" },
  { q: "what was 22105's record in playoffs", kind: "question", label: "22105's playoff record" },
  // Several filters at once
  { q: "top 5 nj teams by auto opr who also won inspire", kind: "filters", label: "NJ Inspire winners by auto" },
  { q: "teams from oradell with opr over 100", kind: "filters", label: "Oradell teams, OPR over 100" },
  { q: "teams in texas with opr over 150", kind: "filters", label: "Texas teams, OPR over 150" },
  { q: "teams in michigan that won inspire", kind: "filters", label: "Michigan Inspire winners" },
  { q: "teams in california with auto opr over 40", kind: "filters", label: "California, auto OPR 40+" },
  { q: "top 3 texas teams by opr who won inspire", kind: "filters", label: "Top 3 Texas Inspire teams" },
  { q: "teams from houston with opr over 90", kind: "filters", label: "Houston teams, OPR 90+" },
  { q: "teams in new jersey that won inspire with opr over 80", kind: "filters", label: "NJ Inspire teams, OPR 80+" },
  { q: "teams in florida with opr over 120", kind: "filters", label: "Florida teams, OPR 120+" },
  { q: "4215 not 6980 record", kind: "filters" },
];

/** How many chips show at once, and how long one set stays: a UTC hour. */
export const SUGGESTION_COUNT = 6;
export const SUGGESTION_HOUR_MS = 3_600_000;

/** A small seeded generator (mulberry32): the same hour gives the same numbers in every browser. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The six for the UTC hour holding `now`: a leaderboard, a whole-sentence or several-filter query, then four other
 *  families, never two of one family. A family whose every query names a team already showing is passed over for
 *  the next one, so a team shows once (the first two always fill: most of their queries name no team). In a
 *  shuffled order. */
export function suggestionsAt(now: number, pool: readonly HomeSuggestion[] = HOME_SUGGESTIONS): HomeSuggestion[] {
  const rand = seeded(Math.floor(now / SUGGESTION_HOUR_MS) * 2654435761);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T,>(xs: readonly T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const kinds = [...new Set(pool.map((s) => s.kind))];
  const must: SuggestionKind[] = ["leaderboard", pick(["question", "filters"] as const)];
  const wanted = [...must, ...shuffle(kinds.filter((k) => !must.includes(k)))].filter((k) => kinds.includes(k));
  const out: HomeSuggestion[] = [];
  const used = new Set<string>();
  for (const kind of wanted) {
    if (out.length === SUGGESTION_COUNT) break;
    const all = pool.filter((s) => s.kind === kind);
    const fresh = all.filter((s) => !suggestionTeams(s).some((t) => used.has(t)));
    if (!fresh.length && !must.includes(kind)) continue;
    const s = pick(fresh.length ? fresh : all);
    suggestionTeams(s).forEach((t) => used.add(t));
    out.push(s);
  }
  return shuffle(out);
}

/** Which of the six the placeholder can show ("Try “…”"): queries short enough for the field that type as they
 *  read (a spelling mistake shown as the thing to try would read as our typo). */
export const placeholderable = (s: HomeSuggestion) => s.kind !== "spelling" && s.q.length <= 30;
