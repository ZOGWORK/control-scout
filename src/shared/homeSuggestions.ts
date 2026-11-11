// Home's suggestion chips (src/components/home/HeroSearch.tsx): a pool of real FTC One Search queries, one family of
// answer each, and the six shown this UTC hour. The pick is a pure function of the hour, so every browser shows the
// same six and nothing is fetched for it. Every query here answers with a card on the live site, signed out:
// `npm run suggestions:check` asks the live API for each one and fails on any that doesn't (or says "none found").
// The queries are plain strings; nothing about their answers is stored here.
// The only teams a suggestion names are SUGGESTION_TEAMS (Sushil, Nov 10 2026), by name wherever search answers the
// name ("Ultraviolet" is four teams' name, so 23268 goes by its number).

/** Which family of answer a suggestion shows off: the six on show are never two of one family. */
export type SuggestionKind =
  | "team" | "opr" | "rating" | "record" | "matches" | "awards" | "worlds" | "versus" | "three"
  | "leaderboard" | "winners" | "predict" | "question" | "filters";

/** `q` runs on tap; `label` is the chip's text when the query is too long for a chip (sentence case); `teams`: the
 *  team numbers a query names by name, not number ("hypnotic robotics" is 4215), so a team still shows once. */
export interface HomeSuggestion { q: string; kind: SuggestionKind; label?: string; teams?: readonly string[] }

/** The chip text: its own short label, or the query itself. */
export const suggestionLabel = (s: HomeSuggestion) => s.label ?? s.q;

/** The teams a suggestion is about: the numbers in its query (not a threshold, "opr over 100"), and any it names by
 *  name. */
export const suggestionTeams = (s: HomeSuggestion): string[] => [...(s.q.match(/(?<!\bover )\b\d{3,5}\b/g) ?? []), ...(s.teams ?? [])];

/** The longest chip label: two such chips share a row wherever the hero lets the chips wrap
 *  (src/components/home/HeroSearch.tsx), so any six fit the three rows it keeps for them. */
export const SUGGESTION_LABEL_MAX = 28;

/** The teams suggestions may name, each with its name as its team page stores it (homeSuggestions.test.ts fails on
 *  any other). */
export const SUGGESTION_TEAMS: Readonly<Record<string, string>> = {
  "4215": "Hypnotic Robotics", "6980": "Bad Wolf", "7149": "ENFORCERS", "14481": "Don't Blink", "23268": "Ultraviolet", "19477": "Bit by Bit",
};

export const HOME_SUGGESTIONS: readonly HomeSuggestion[] = [
  // Team facts and location
  { q: "Where is Hypnotic Robotics from", kind: "team", label: "Where is Hypnotic Robotics", teams: ["4215"] },
  { q: "Where is Bad Wolf from", kind: "team", teams: ["6980"] },
  { q: "ENFORCERS school", kind: "team", teams: ["7149"] },
  { q: "Where is Don't Blink from", kind: "team", teams: ["14481"] },
  { q: "Where is Bit by Bit from", kind: "team", teams: ["19477"] },
  { q: "Where is 23268 from", kind: "team" },
  { q: "How many teams in NJ", kind: "team" },
  // OPR and phase OPR
  { q: "Hypnotic Robotics OPR", kind: "opr", teams: ["4215"] },
  { q: "Bad Wolf auto OPR", kind: "opr", teams: ["6980"] },
  { q: "ENFORCERS teleop OPR", kind: "opr", teams: ["7149"] },
  { q: "Don't Blink OPR", kind: "opr", teams: ["14481"] },
  { q: "Bit by Bit OPR", kind: "opr", teams: ["19477"] },
  { q: "23268 OPR", kind: "opr" },
  // Prediction rating
  { q: "Bad Wolf rating", kind: "rating", teams: ["6980"] },
  { q: "Don't Blink rating", kind: "rating", teams: ["14481"] },
  { q: "Bit by Bit rating", kind: "rating", teams: ["19477"] },
  { q: "23268 rating", kind: "rating" },
  // Records, quals and playoffs apart
  { q: "Hypnotic Robotics record", kind: "record", teams: ["4215"] },
  { q: "Bad Wolf quals record", kind: "record", teams: ["6980"] },
  { q: "ENFORCERS quals record", kind: "record", teams: ["7149"] },
  { q: "Don't Blink playoff record", kind: "record", teams: ["14481"] },
  { q: "Bit by Bit record", kind: "record", teams: ["19477"] },
  { q: "23268 playoff record", kind: "record" },
  // Matches at an event, states or Worlds
  { q: "ENFORCERS matches at Worlds", kind: "matches", label: "ENFORCERS at Worlds", teams: ["7149"] },
  { q: "Hypnotic Robotics matches at Worlds", kind: "matches", label: "Hypnotic Robotics at Worlds", teams: ["4215"] },
  { q: "Bad Wolf matches at P2-8 meet", kind: "matches", label: "Bad Wolf at P2-8 meet", teams: ["6980"] },
  { q: "Don't Blink matches at states", kind: "matches", label: "Don't Blink at states", teams: ["14481"] },
  { q: "Bit by Bit matches", kind: "matches", teams: ["19477"] },
  // Awards
  { q: "Hypnotic Robotics awards", kind: "awards", teams: ["4215"] },
  { q: "Don't Blink awards", kind: "awards", teams: ["14481"] },
  { q: "Bit by Bit awards", kind: "awards", teams: ["19477"] },
  { q: "How many awards has ENFORCERS won", kind: "awards", label: "ENFORCERS' award count", teams: ["7149"] },
  // Worlds appearances, first and last
  { q: "When did Hypnotic Robotics go to Worlds", kind: "worlds", label: "Hypnotic Robotics' Worlds", teams: ["4215"] },
  { q: "First time ENFORCERS went to Worlds", kind: "worlds", label: "ENFORCERS' first Worlds", teams: ["7149"] },
  { q: "Last time ENFORCERS went to Worlds", kind: "worlds", label: "ENFORCERS' last Worlds", teams: ["7149"] },
  { q: "When did Don't Blink go to Worlds", kind: "worlds", label: "Don't Blink's Worlds years", teams: ["14481"] },
  // Two teams: compare, partners, opponents
  { q: "Bad Wolf vs Don't Blink", kind: "versus", teams: ["6980", "14481"] },
  { q: "ENFORCERS vs 23268 OPR", kind: "versus", teams: ["7149"] },
  { q: "Bad Wolf partners", kind: "versus", teams: ["6980"] },
  { q: "ENFORCERS opponents", kind: "versus", teams: ["7149"] },
  { q: "Bit by Bit opponents", kind: "versus", teams: ["19477"] },
  { q: "23268 partners", kind: "versus" },
  // Three teams (by number: three names side by side read as a team list, not a comparison card)
  { q: "4215 vs 6980 vs 23268", kind: "three" },
  { q: "7149 vs 14481 vs 19477", kind: "three" },
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
  // Predictions: a match-up (none of the six has a published next event yet, so no next-event chip)
  { q: "ENFORCERS vs Bad Wolf who wins", kind: "predict", label: "ENFORCERS vs Bad Wolf", teams: ["7149", "6980"] },
  { q: "Bit by Bit vs Don't Blink who wins", kind: "predict", label: "Bit by Bit vs Don't Blink", teams: ["19477", "14481"] },
  { q: "23268 vs Bit by Bit who wins", kind: "predict", label: "23268 vs Bit by Bit", teams: ["19477"] },
  // Questions in a whole sentence
  { q: "When was the first time ENFORCERS went to Worlds", kind: "question", label: "ENFORCERS' first Worlds year", teams: ["7149"] },
  { q: "What did Hypnotic Robotics do at states", kind: "question", label: "Hypnotic Robotics at states", teams: ["4215"] },
  { q: "What was ENFORCERS' record at Worlds", kind: "question", label: "ENFORCERS' record at Worlds", teams: ["7149"] },
  { q: "Which teams has Bad Wolf partnered with the most", kind: "question", label: "Bad Wolf's top partner", teams: ["6980"] },
  { q: "What was Don't Blink's record in playoffs", kind: "question", label: "Don't Blink's playoff record", teams: ["14481"] },
  // Several filters at once
  { q: "top 5 nj teams by auto opr who also won inspire last season", kind: "filters", label: "NJ Inspire winners by auto" },
  { q: "teams from oradell with opr over 10", kind: "filters", label: "Oradell teams, OPR over 10" },
  { q: "teams in texas with opr over 100", kind: "filters", label: "Texas teams, OPR over 100" },
  { q: "teams in michigan that won inspire", kind: "filters", label: "Michigan Inspire winners" },
  { q: "teams in california with auto opr over 20", kind: "filters", label: "California, auto OPR 20+" },
  { q: "top 3 texas teams by opr who won inspire", kind: "filters", label: "Top 3 Texas Inspire teams" },
  { q: "teams from houston with opr over 15", kind: "filters", label: "Houston teams, OPR 15+" },
  { q: "teams in new jersey that won inspire with opr over 80 last season", kind: "filters", label: "NJ Inspire teams, OPR 80+" },
  { q: "teams in florida with opr over 60", kind: "filters", label: "Florida teams, OPR 60+" },
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

/** A chip's width on a desktop (16px text), from its label: measured in a browser, every label's chip is 119–235px
 *  and no wider than this (68px of border, padding and icon, then about 6.6px a letter). */
export const chipWidthEstimate = (s: HomeSuggestion) => 68 + 6.6 * suggestionLabel(s).length;

/** The narrowest a desktop's chip column gets (beside the globe at 1280px it is 394px), its gap and its rows: every
 *  hour's six fit there whole (fitChips), so a desktop always shows all six. */
export const DESKTOP_CHIPS = { width: 390, gap: 8, rows: 3 } as const;

/** The six for the UTC hour holding `now`: a leaderboard, a whole-sentence or several-filter query, then four other
 *  families, never two of one family. A query that names a team already showing, or that wouldn't fit a desktop's
 *  rows beside the ones chosen (DESKTOP_CHIPS), is passed over; a family with none left gives way to the next one, so
 *  a team shows once and a desktop shows all six (the first two always fill: most of their queries name no team and
 *  are short). In a shuffled order. */
export function suggestionsAt(now: number, pool: readonly HomeSuggestion[] = HOME_SUGGESTIONS): HomeSuggestion[] {
  const rand = seeded(Math.floor(now / SUGGESTION_HOUR_MS) * 2654435761);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T,>(xs: readonly T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const kinds = [...new Set(pool.map((s) => s.kind))];
  // One try at the six; a try that runs out of families (its first picks too long to leave room) is tried again with
  // the hour's next numbers, so the same hour still gives the same six.
  const attempt = () => {
    const must: SuggestionKind[] = ["leaderboard", pick(["question", "filters"] as const)];
    const wanted = [...must, ...shuffle(kinds.filter((k) => !must.includes(k)))].filter((k) => kinds.includes(k));
    const out: HomeSuggestion[] = [];
    const used = new Set<string>();
    for (const kind of wanted) {
      if (out.length === SUGGESTION_COUNT) break;
      const all = pool.filter((s) => s.kind === kind);
      const fits = (s: HomeSuggestion) => allFit([...out, s].map(chipWidthEstimate), DESKTOP_CHIPS.width, DESKTOP_CHIPS.gap, DESKTOP_CHIPS.rows);
      const fresh = all.filter((s) => !suggestionTeams(s).some((t) => used.has(t)) && fits(s));
      if (!fresh.length && !must.includes(kind)) continue;
      const s = pick(fresh.length ? fresh : all);
      suggestionTeams(s).forEach((t) => used.add(t));
      out.push(s);
    }
    return out;
  };
  let out = attempt();
  for (let i = 0; i < 20 && out.length < SUGGESTION_COUNT; i++) out = attempt();
  return shuffle(out);
}

/** Which of the six the placeholder can show ("Try “…”"): queries short enough for the field. */
export const placeholderable = (s: HomeSuggestion) => s.q.length <= 30;

/** Whether every chip fits whole onto `rows` rows `width` wide (fitChips keeps them all), worked out quickly: the
 *  widest first, each onto a row with room, trying the next row when the rest won't follow. */
export function allFit(widths: readonly number[], width: number, gap: number, rows: number): boolean {
  const ws = [...widths].sort((a, b) => b - a);
  const used = Array.from({ length: rows }, () => -gap);
  const place = (i: number): boolean => {
    if (i === ws.length) return true;
    const tried = new Set<number>();
    for (let r = 0; r < rows; r++) {
      // Rows with the same room left are the same choice.
      if (tried.has(used[r]) || used[r] + gap + ws[i] > width) continue;
      tried.add(used[r]);
      used[r] += gap + ws[i];
      if (place(i + 1)) return true;
      used[r] -= gap + ws[i];
    }
    return false;
  };
  return place(0);
}

/** Which chips to show, in what order, when they wrap onto `rows` rows `width` wide with `gap` between chips: the
 *  most that fit whole, keeping a leaderboard and a sentence or filtered query where it can, then the earliest. A
 *  chip that fits nowhere is left out (it is never cut). Returns indexes into `widths`, row by row, so a list that
 *  wraps in this order uses no more than `rows` rows, as close to the given order as that allows. */
export function fitChips(widths: readonly number[], width: number, gap: number, rows: number, kinds: readonly SuggestionKind[] = []): number[] {
  const n = widths.length;
  const fits = (row: number[]) => row.reduce((w, i) => w + widths[i], 0) + gap * Math.max(0, row.length - 1) <= width;
  const must = (k: SuggestionKind) => k === "leaderboard" || k === "question" || k === "filters";
  let best: number[] = []; let bestScore = -1;
  // Every way of putting each chip on a row, or on none (rows + 1 choices each): at most 4^6, small.
  const total = (rows + 1) ** n;
  for (let code = 0; code < total; code++) {
    const bins: number[][] = Array.from({ length: rows }, () => []);
    let c = code;
    for (let i = 0; i < n; i++) { const b = c % (rows + 1); c = Math.floor(c / (rows + 1)); if (b < rows) bins[b].push(i); }
    if (!bins.every(fits)) continue;
    const kept = bins.flat();
    // More chips first, then the must-have kinds, then the earliest chips (a lower mask of left-out ones).
    const left = Array.from({ length: n }, (_, i) => (kept.includes(i) ? 0 : 1 << (n - 1 - i))).reduce((a, b) => a + b, 0);
    const score = kept.length * 1e6 + kept.filter((i) => kinds[i] && must(kinds[i])).length * 1e4 + (2 ** n - left);
    const order = bins.flatMap((b) => [...b].sort((x, y) => x - y));
    // Of equal ones, the order closest to the hour's own (the first to differ comes earlier).
    const earlier = () => { const d = order.findIndex((x, i) => x !== best[i]); return d >= 0 && order[d] < best[d]; };
    if (score > bestScore || (score === bestScore && earlier())) { bestScore = score; best = order; }
  }
  return best;
}
