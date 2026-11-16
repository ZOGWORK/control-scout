// Home's suggestion chips (src/components/home/HeroSearch.tsx): a pool of real FTC One Search queries, one family of
// answer each, and the six shown this UTC hour. The pick is a pure function of the hour, so every browser shows the
// same six and nothing is fetched for it. Every query here answers with a card on the live site, signed out:
// `npm run suggestions:check` asks the live API for each one and fails on any that doesn't (or says "none found").
// The queries are plain strings; nothing about their answers is stored here.
// The pool names no team and leans on no one region (Sushil, Nov 15 2026): leaderboards, winners, counts and scores
// from around the world. A visitor with a team of their own (My team) also gets a couple of chips about that team
// (teamSuggestions), by its number and name.

/** Which family of answer a suggestion shows off: the six on show are never two of one family. The pool's own
 *  families come first; the rest are the families of a visitor's own team's chips (teamSuggestions). */
export type SuggestionKind =
  | "leaderboard" | "phase" | "winners" | "question" | "filters" | "count" | "scores" | "events"
  | "rating" | "opr" | "record" | "matches" | "awards" | "worlds";

/** `q` runs on tap; `label` is the chip's text when the query is too long for a chip (sentence case); `mine`: a chip
 *  about the visitor's own team (teamSuggestions), kept over the others where room is short (fitChips); `short`: such a
 *  chip's label cut to TEAM_SHORT_LABEL_MAX, used when its full label would leave too little room (suggestionsAt). */
export interface HomeSuggestion { q: string; kind: SuggestionKind; label?: string; mine?: true; short?: string }

/** The chip text: its own short label, or the query itself. */
export const suggestionLabel = (s: HomeSuggestion) => s.label ?? s.q;

/** The longest chip label: two such chips share a row wherever the hero lets the chips wrap
 *  (src/components/home/HeroSearch.tsx), so any six fit the three rows it keeps for them. */
export const SUGGESTION_LABEL_MAX = 28;

export const HOME_SUGGESTIONS: readonly HomeSuggestion[] = [
  // Leaderboards: the world, a country or a state, by rating, reliability, record, rookies and improvement
  { q: "Highest OPR", kind: "leaderboard" },
  { q: "Best teams in the world", kind: "leaderboard" },
  { q: "Top teams in Texas", kind: "leaderboard" },
  { q: "Top teams in California", kind: "leaderboard" },
  { q: "Top teams in Michigan", kind: "leaderboard" },
  { q: "Top teams in Florida", kind: "leaderboard" },
  { q: "Top teams in Canada", kind: "leaderboard" },
  { q: "Top teams in China", kind: "leaderboard" },
  { q: "Top teams in Brazil", kind: "leaderboard" },
  { q: "Top teams in Australia", kind: "leaderboard" },
  { q: "Top teams by reliability", kind: "leaderboard" },
  { q: "Top teams by record", kind: "leaderboard" },
  { q: "Top rookie teams", kind: "leaderboard" },
  { q: "Most improved teams", kind: "leaderboard" },
  { q: "Undefeated teams", kind: "leaderboard" },
  // One part of the match: auto, TeleOp or endgame OPR
  { q: "Best auto OPR", kind: "phase" },
  { q: "Best teleop OPR", kind: "phase" },
  { q: "Best endgame OPR", kind: "phase" },
  { q: "Best auto OPR in Romania", kind: "phase" },
  { q: "Best auto OPR in China", kind: "phase" },
  { q: "Best teleop OPR in Canada", kind: "phase" },
  { q: "Best teleop OPR in Michigan", kind: "phase", label: "Best teleop in Michigan" },
  { q: "Best endgame OPR in Texas", kind: "phase" },
  // A season's or an event's winning alliance
  { q: "Who won Worlds", kind: "winners" },
  { q: "Who won DECODE", kind: "winners" },
  { q: "Who won INTO THE DEEP", kind: "winners" },
  { q: "Who won Romania nationals", kind: "winners" },
  { q: "Who won Ontario provincials", kind: "winners", label: "Who won in Ontario" },
  { q: "Who won Michigan states", kind: "winners" },
  { q: "Who won California states", kind: "winners" },
  { q: "Who won Texas state championship", kind: "winners", label: "Who won Texas states" },
  // Questions in a whole sentence
  { q: "What is OPR", kind: "question" },
  { q: "Which team has the highest OPR", kind: "question", label: "Who has the highest OPR" },
  { q: "Which team has the best record", kind: "question", label: "Who has the best record" },
  { q: "Who has the best auto in Texas", kind: "question", label: "Who leads auto in Texas" },
  { q: "Who has the highest rating in Canada", kind: "question", label: "Highest rating in Canada" },
  { q: "Which team has won the most Inspire awards", kind: "question", label: "Most Inspire Awards ever" },
  // Several filters at once
  { q: "best teams in romania by auto", kind: "filters", label: "Best in Romania by auto" },
  { q: "top 5 teams in china by auto opr", kind: "filters", label: "Top 5 in China by auto" },
  { q: "teams in brazil that won inspire", kind: "filters", label: "Brazil Inspire winners" },
  { q: "teams in michigan that won inspire", kind: "filters", label: "Michigan Inspire winners" },
  { q: "teams in texas with opr over 100", kind: "filters", label: "Texas teams, OPR over 100" },
  { q: "top 3 texas teams by opr who won inspire", kind: "filters", label: "Top 3 Texas Inspire teams" },
  { q: "teams in california with auto opr over 20", kind: "filters", label: "California, auto OPR 20+" },
  { q: "teams from houston with opr over 15", kind: "filters", label: "Houston teams, OPR 15+" },
  { q: "teams in florida with opr over 60", kind: "filters", label: "Florida teams, OPR 60+" },
  { q: "undefeated teams in texas", kind: "filters", label: "Undefeated in Texas" },
  // How many teams a place has
  { q: "How many teams in Canada", kind: "count" },
  { q: "How many teams in Brazil", kind: "count" },
  { q: "How many teams in China", kind: "count" },
  { q: "How many teams in Romania", kind: "count" },
  { q: "How many teams in Australia", kind: "count", label: "How many in Australia" },
  { q: "How many teams in Texas", kind: "count" },
  // The highest-scoring matches
  { q: "Highest score this season", kind: "scores" },
  { q: "Highest score at Worlds", kind: "scores" },
  { q: "Highest score in Romania", kind: "scores" },
  { q: "Highest score in Canada", kind: "scores" },
  { q: "Highest score in California", kind: "scores", label: "Top score in California" },
  // Events coming up
  { q: "Meets this weekend", kind: "events" },
  { q: "Events this week", kind: "events" },
];

/** The chips a visitor's own team can have: each query names the team by number, so it always finds that team, and
 *  search answers it for any team. `tail`: the label's words after the team. */
const TEAM_TEMPLATES: readonly { kind: SuggestionKind; q: (n: number) => string; tail: string }[] = [
  { kind: "rating", q: (n) => `${n} rating`, tail: "rating" },
  { kind: "opr", q: (n) => `${n} OPR`, tail: "OPR" },
  { kind: "record", q: (n) => `${n} record`, tail: "record" },
  { kind: "matches", q: (n) => `${n} matches`, tail: "matches" },
  { kind: "awards", q: (n) => `${n} awards`, tail: "awards" },
  { kind: "worlds", q: (n) => `When did ${n} go to Worlds`, tail: "Worlds" },
];

/** How many of the six are about the visitor's own team, when they have one. */
export const TEAM_SUGGESTION_COUNT = 2;

/** The longest label of a visitor's own team's chip: a little over SUGGESTION_LABEL_MAX, so a name of two words
 *  usually shows whole ("4215 Hypnotic Robotics matches"). Still one row's width on the narrowest phone; only two of
 *  them show, and suggestionsAt and fitChips make room for them. */
export const TEAM_LABEL_MAX = 30;

/** "4215 Hypnotic Robotics rating": the team's number and name, the name cut short (at a word, with "…") when the
 *  label would pass TEAM_LABEL_MAX, and the number alone when there's no name or no room for a useful part. */
export function teamLabel(team: number, name: string | null | undefined, tail: string, max: number = TEAM_LABEL_MAX): string {
  const bare = `${team} ${tail}`;
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return bare;
  const whole = `${team} ${n} ${tail}`;
  if (whole.length <= max) return whole;
  const room = max - bare.length - 2; // the space before the name and the "…"
  let cut = n.slice(0, Math.max(0, room));
  const space = cut.lastIndexOf(" ");
  if (n[cut.length] !== " " && space >= 3) cut = cut.slice(0, space);
  // A bracket opened and not closed is left out whole, and what comes before it is the name's own short form, with
  // no "…": "T.W.C.A. (Team Without a Cool Acronym)" is "T.W.C.A.".
  const open = cut.lastIndexOf("(");
  const short = open > cut.lastIndexOf(")");
  if (short) cut = cut.slice(0, open);
  cut = cut.replace(/[\s,;:&/-]+$/u, "");
  return cut.length >= 3 ? `${team} ${cut}${short ? "" : "…"} ${tail}` : bare;
}

/** The longest a team chip's `short` label is: short enough that each of its two chips shares a desktop row with a
 *  pool chip (DESKTOP_CHIPS), so five or six show however long the team's name. */
export const TEAM_SHORT_LABEL_MAX = 25;

/** Every chip the visitor's own team can have, by its number and (when known) its name as its team page has it. */
export function teamSuggestions(team: number, name?: string | null): HomeSuggestion[] {
  return TEAM_TEMPLATES.map((t) => {
    const label = teamLabel(team, name, t.tail), short = teamLabel(team, name, t.tail, TEAM_SHORT_LABEL_MAX);
    return { q: t.q(team), kind: t.kind, label, ...(short !== label ? { short } : {}), mine: true };
  });
}

/** The places the pool's queries name: an hour's six name each at most once, so no one place fills the chips. */
export const SUGGESTION_PLACES = ["Texas", "California", "Michigan", "Florida", "Canada", "China", "Brazil", "Australia", "Romania", "Houston", "Ontario"] as const;
const PLACE_RES = SUGGESTION_PLACES.map((p) => [p, new RegExp(`\\b${p}\\b`, "i")] as const);
/** The place a suggestion's query names, or null for the world. */
export const suggestionPlace = (s: HomeSuggestion): string | null => PLACE_RES.find(([, re]) => re.test(s.q))?.[0] ?? null;

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
 *  families, never two of one family and never one place (SUGGESTION_PLACES) twice. A query that wouldn't fit a desktop's rows beside the ones chosen
 *  (DESKTOP_CHIPS) is passed over; a family with none left gives way to the next one, so a desktop shows all six (the
 *  first two always fill: most of their queries are short). In a shuffled order.
 *  `mine`: the visitor's own team's chips (teamSuggestions). TEAM_SUGGESTION_COUNT of them are picked first, then the
 *  pool's fill the rest, as many as still fit a desktop's rows whole (a team's chips are long, so that can be five). */
export function suggestionsAt(now: number, pool: readonly HomeSuggestion[] = HOME_SUGGESTIONS, mine: readonly HomeSuggestion[] = []): HomeSuggestion[] {
  const rand = seeded(Math.floor(now / SUGGESTION_HOUR_MS) * 2654435761);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T,>(xs: readonly T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const kinds = [...new Set(pool.map((s) => s.kind))];
  const fitsWith = (chips: readonly HomeSuggestion[]) => allFit(chips.map(chipWidthEstimate), DESKTOP_CHIPS.width, DESKTOP_CHIPS.gap, DESKTOP_CHIPS.rows);
  // One try at the six; a try that runs out of families (its first picks too long to leave room) is tried again with
  // the hour's next numbers, so the same hour still gives the same six.
  const attempt = () => {
    const out: HomeSuggestion[] = shuffle(mine).slice(0, TEAM_SUGGESTION_COUNT);
    const must: SuggestionKind[] = ["leaderboard", pick(["question", "filters"] as const)];
    const wanted = [...must, ...shuffle(kinds.filter((k) => !must.includes(k)))]
      .filter((k) => kinds.includes(k) && !out.some((s) => s.kind === k));
    for (const kind of wanted) {
      if (out.length === SUGGESTION_COUNT) break;
      const all = pool.filter((s) => s.kind === kind);
      const places = new Set(out.map(suggestionPlace).filter(Boolean));
      const fresh = all.filter((s) => !places.has(suggestionPlace(s)) && fitsWith([...out, s]));
      // A must-have family with nothing that fits still shows, unless the visitor's own chips took the room.
      if (!fresh.length && (!must.includes(kind) || mine.length)) continue;
      const elsewhere = all.filter((s) => !places.has(suggestionPlace(s)));
      out.push(pick(fresh.length ? fresh : elsewhere.length ? elsewhere : all));
    }
    return out;
  };
  const best = () => {
    let got = attempt();
    for (let i = 0; i < 20 && got.length < SUGGESTION_COUNT; i++) { const next = attempt(); if (next.length > got.length) got = next; }
    return got;
  };
  let out = best();
  // A long team name leaves no room beside its two chips for five in all: those two take their shorter labels.
  if (mine.length && out.length < SUGGESTION_COUNT - 1) {
    mine = mine.map((s) => (s.short ? { ...s, label: s.short } : s));
    const tighter = best();
    if (tighter.length > out.length) out = tighter;
  }
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
 *  visitor's own team's chips (`mine`) first, then the most that fit whole, keeping a leaderboard and a sentence or
 *  filtered query where it can, then the earliest. A chip that fits nowhere is left out (it is never cut). Returns
 *  indexes into `widths`, row by row, so a list that wraps in this order uses no more than `rows` rows, as close to
 *  the given order as that allows. */
export function fitChips(widths: readonly number[], width: number, gap: number, rows: number, kinds: readonly SuggestionKind[] = [], mine: readonly boolean[] = []): number[] {
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
    // The visitor's own chips first, then more chips, then the must-have kinds, then the earliest chips (a lower
    // mask of left-out ones).
    const left = Array.from({ length: n }, (_, i) => (kept.includes(i) ? 0 : 1 << (n - 1 - i))).reduce((a, b) => a + b, 0);
    const score = kept.filter((i) => mine[i]).length * 1e8 + kept.length * 1e6 + kept.filter((i) => kinds[i] && must(kinds[i])).length * 1e4 + (2 ** n - left);
    const order = bins.flatMap((b) => [...b].sort((x, y) => x - y));
    // Of equal ones, the order closest to the hour's own (the first to differ comes earlier).
    const earlier = () => { const d = order.findIndex((x, i) => x !== best[i]); return d >= 0 && order[d] < best[d]; };
    if (score > bestScore || (score === bestScore && earlier())) { bestScore = score; best = order; }
  }
  return best;
}
