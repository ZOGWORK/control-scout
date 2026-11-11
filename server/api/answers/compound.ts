// Compound questions (docs/search.md, "Stat answers"): one question that joins filters or asks for two things at once
// ("top 5 NJ teams by auto opr who also won inspire", "12345 matches where they lost by less than 10 points", "12345
// awards and record in 2025-26 combined"). Read by fixed rules, clause by clause, into subject teams, filters and
// outputs; answered from the stored rows (./families/compound.ts). Every filter read is applied and shown on the card;
// a question with a clause these rules don't read is left to the readers after this one.
import type { Region } from "../../../src/shared/regions.js";
import { findRegions, nearRegion } from "../../../src/shared/regions.js";
import { countryOf } from "../../../src/shared/countries.js";
import { SEASONS } from "../../data/seasons.js";
import { currentSeason, lastSeason } from "./season.js";

/** "over 100", "less than 10", "at least 3": a comparison with a number. */
export interface Threshold { op: "gt" | "ge" | "lt" | "le"; value: number }
/** A season stat a list filters, sorts or shows (families/leaderboard.ts BOARD_STATS keys). */
export type ListStat = "opr" | "auto" | "teleop" | "endgame" | "rating" | "win-rate" | "record" | "reliability" | "matches" | "wins";

/** The season words of a clause: one season, every season ("ever"), or none said. */
export interface SeasonWords { season: number | null; ever: boolean; latest: boolean;
  /** "last season" was said (the latest completed one; beside a team's "this season", the season before it). */
  last?: boolean }

export type CompoundQuestion =
  /** Teams by place, filtered by an award won, a Worlds season (gone to, or not), rookies or stat thresholds (each one
   *  applied), sorted by a stat, top N. */
  | { kind: "list"; n: number | null; stat: ListStat | null; region: Region | null; country: { code: string; name: string } | null; city: string | null; season: number | null;
      award: { type: string; label: string } | null; worlds: boolean; noWorlds?: boolean; rookie?: boolean; thresholds: (Threshold & { stat: ListStat })[]; outputs: ListStat[] }
  /** How many teams one list holds in each of two seasons ("how many NJ teams went to worlds in 2024 versus 2025"). */
  | { kind: "list-pair"; lists: [Extract<CompoundQuestion, { kind: "list" }>, Extract<CompoundQuestion, { kind: "list" }>] }
  /** One team's OPR at its first (or last) event of two seasons, side by side. */
  | { kind: "event-pair"; core: string; which: "first" | "last"; seasons: [number, number];
      /** Each side's words: "this season" is the team's latest season with matches, "last season" beside it the one
       *  before (the one season rule, ./season.ts), resolved by the answer. */
      said?: ["this" | "last" | null, "this" | "last" | null] }
  /** One team's matches it won or lost by a margin. */
  | { kind: "margin"; core: string; result: "W" | "L"; margin: Threshold; when: SeasonWords }
  /** Two of a team's answers on one card: its record, its awards, its OPR. */
  | { kind: "combined"; core: string; parts: ("record" | "awards" | "opr")[]; when: SeasonWords }
  /** A team's partners (or opponents) at an event or in a season, filtered by their OPR. */
  | { kind: "side-threshold"; core: string; side: "partners" | "opponents"; at: string | null; threshold: Threshold; when: SeasonWords }
  /** The engine's call for a team against each team ranked in the world's top N ("can 12345 beat a top 10 team"). */
  | { kind: "predict-top"; core: string; n: number; when: SeasonWords }
  /** Whether a team beat a team ranked in the world's top N. */
  | { kind: "beat-top"; core: string; n: number; by: "rating" | "opr"; when: SeasonWords }
  /** Two picks from one season's events: its best (or worst) by rank, OPR or record. */
  | { kind: "event-picks"; core: string; picks: { pick: "best" | "worst"; by: "rank" | "opr" | "record" }[]; when: SeasonWords }
  /** A team's average score in its wins against its losses. */
  | { kind: "win-loss-average"; core: string; when: SeasonWords }
  /** A team's per-event OPRs averaged with its worst (or best) event left out. */
  | { kind: "opr-excluding"; core: string; drop: "worst" | "best"; when: SeasonWords }
  /** Three or four teams by number, the one with the highest stat named. */
  | { kind: "set-best"; teams: number[]; stat: "reliability" | "opr"; when: SeasonWords };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const norm = (raw: string) => squash(` ${raw.toLowerCase().replace(/['’]s\b/g, "").replace(/[?!,]/g, " ").replace(/\.+\s*$/, " ")} `);
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const OP = String.raw`(over|above|more than|greater than|higher than|at least|no less than|under|below|less than|fewer than|lower than|at most|no more than|>=|<=|>|<)`;
const opOf = (w: string): Threshold["op"] =>
  /^(?:at least|no less than|>=)$/.test(w) ? "ge" : /^(?:at most|no more than|<=)$/.test(w) ? "le" : /^(?:under|below|less than|fewer than|lower than|<)$/.test(w) ? "lt" : "gt";

/** A season named in a clause's words: "this season" (the default season), "last season" (the one before), "2024-25",
 *  "in 2024" (its season, as search reads a bare year), "ever" (every season). */
export function seasonWords(s: string): SeasonWords & { rest: string } {
  let rest = ` ${s} `;
  const out: SeasonWords = { season: null, ever: false, latest: false };
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
  const label = take(/\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(20\d\d)\s*[-–/]\s*(\d\d)(?:\s+season)?\b/);
  if (label && (Number(label[1]) + 1) % 100 === Number(label[2])) out.season = Number(label[1]);
  if (out.season == null && take(/\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(?:this|current)\s+(?:season|year)\b/)) { out.season = currentSeason(); out.latest = true; }
  if (out.season == null && take(/\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(?:last|previous|past)\s+(?:season|year)\b/)) { out.season = lastSeason(); out.last = true; }
  if (out.season == null) {
    const y = take(/\b(?:in\s+|during\s+|for\s+)?(20\d\d)\b/);
    if (y && SEASONS.some((x) => x.season === Number(y[1]))) out.season = Number(y[1]);
    else if (y) return { ...out, rest: s };
  }
  if (out.season == null) {
    for (const x of SEASONS) {
      const re = new RegExp(`\\b(?:in\\s+|during\\s+)?${[...x.game.replace(/\s+/g, "").toLowerCase()].join("[\\s-]?")}\\b`);
      if (take(re)) { out.season = x.season; break; }
    }
  }
  if (take(/\b(?:ever|all[\s-]+time|of\s+all\s+time|career|in\s+history)\b/)) out.ever = true;
  // "in the same season", "combined", "together": the clause's own framing, naming nothing.
  rest = rest.replace(/\b(?:in\s+)?(?:the\s+)?same\s+season\b|\b(?:combined|together|both|in\s+one|points?)\b/g, " ");
  return { ...out, rest: squash(rest) };
}

const STAT_WORDS: [ListStat, RegExp][] = [
  ["auto", /^auto(?:nomous)?(?: opr)?$/], ["teleop", /^(?:tele ?op|driver(?:[- ]controlled)?)(?: opr)?$/], ["endgame", /^end ?game(?: opr)?$/],
  ["opr", /^(?:total |overall |season )?opr$/], ["rating", /^(?:prediction |predicted )?(?:rating|strength)$/],
  ["win-rate", /^(?:win(?:ning)? (?:rate|percentage|pct)|win%)$/], ["record", /^(?:win[- ]loss )?record$/], ["reliability", /^(?:reliability|reliable)(?: index| score)?$/],
];
const statOf = (s: string): ListStat | null => STAT_WORDS.find(([, re]) => re.test(squash(s)))?.[0] ?? null;
const STAT = String.raw`((?:auto(?:nomous)?|tele ?op|end ?game) opr|opr|(?:prediction )?rating|win rate|reliability)`;

/** Awards by the words people use (awards.type, placement 1 unless said). */
const AWARDS: [RegExp, string, string][] = [
  [/^inspire$/, "Inspire", "Inspire Award"], [/^think$/, "Think", "Think Award"], [/^innovate$/, "Innovate", "Innovate Award"], [/^design$/, "Design", "Design Award"],
  [/^reach$/, "Reach", "Reach Award"], [/^sustain$/, "Sustain", "Sustain Award"], [/^connect$/, "Connect", "Connect Award"], [/^control$/, "Control", "Control Award"],
  [/^motivate$/, "Motivate", "Motivate Award"], [/^compass$/, "Compass", "Compass Award"], [/^judges?(?: choice)?$/, "JudgesChoice", "Judges' Choice Award"],
  [/^(?:an? )?(?:event|winning alliance|tournament)$/, "Winner", "Winning Alliance"],
];
/** The judged awards by name alone, as said before "teams" ("Inspire teams"). */
const JUDGED = String.raw`(inspire|think|innovate|design|reach|sustain|connect|control|motivate|compass)`;
const AWARD = String.raw`(inspire|think|innovate|design|reach|sustain|connect|control|motivate|compass|judges?(?: choice)?|winning alliance|an? event|a tournament)`;

/** A region named outright or by a near miss, else null (read.ts regionOf). */
const regionOf = (s: string): Region | null => { const rs = findRegions(s); return rs.length === 1 ? rs[0] : rs.length ? null : nearRegion(s); };

/** "teams in NJ that went to worlds in 2025 and their opr", "top 5 NJ teams by auto opr who also won inspire", "teams
 *  from Oradell with opr over 100": a list of teams with at least one filter clause (an award, Worlds, a threshold). */
function readList(said: string): CompoundQuestion | null {
  // "How many NJ teams went to worlds in 2024": the list, whose answer leads with how many there are.
  const q = said.replace(/^(?:how many|the number of|number of)\s+(?=(?:\S+\s+){0,3}?(?:ftc\s+)?(?:teams?|robots?)\b)/, "");
  if (!/\b(?:teams?|robots?)\b/.test(q)) return null;
  // Each clause read is cut out with a mark, so the words joining it to the rest ("and", "who") go with it.
  let rest = ` ${q} `;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " ¦ "); return m; };
  const WHO = String.raw`(?:(?:who|that|which)\s+)?(?:(?:also|have|has|had|already|still)\s+)*`;
  const aw = take(new RegExp(String.raw`\b${WHO}(?:won|win|received|earned|got)\s+(?:an?\s+|the\s+)?${AWARD}(?:\s+awards?)?\b`))
    ?? take(new RegExp(String.raw`\b${AWARD}\s+(?:award\s+)?winners?\b`))
    // An award's name before the teams ("Texas Inspire teams"): the teams that won it.
    ?? take(new RegExp(String.raw`\b${JUDGED}(?:\s+awards?)?(?:\s+winning)?(?=\s+(?:ftc\s+)?(?:teams?|robots?)\b)`));
  const award = aw ? AWARDS.find(([re]) => re.test(aw[1]))! : null;
  // Gone to Worlds, or not ("did not make worlds", "never went to worlds").
  const NOT = String.raw`(?:did\s*n[o']?t|didnt|never|not|have\s*n[o']?t|has\s*n[o']?t|failed\s+to)\s+`;
  const WENT = String.raw`(?:(?:went|go|gone|been|qualified|qualify|advanced|advance|made\s+it|make\s+it|competed|compete|played|play|were|was)\s+(?:to|at|for|in)|made|make|makes|reached|reach)`;
  const WORLDS = String.raw`\s+(?:the\s+)?(?:worlds?|world championships?|first championship|houston)(?:\s+(?:in|during)?\s*(20\d\d)(?:\s*[-–/]\s*(\d\d))?)?\b`;
  const nwd = take(new RegExp(String.raw`\b${WHO}${NOT}${WENT}${WORLDS}`));
  const wd = nwd ? null : take(new RegExp(String.raw`\b${WHO}${WENT}${WORLDS}`))
    ?? take(/\b(?:worlds?|first championship)\s+(?:teams?|qualifiers?|attendees?)(?:\s+(?:in|during)?\s*(20\d\d)(?:\s*[-–/]\s*(\d\d))?)?\b/);
  const ws = wd ?? nwd;
  // "Worlds in 2025" is the championship held in 2025 (the 2024–25 season); "worlds 2025-26" names its season.
  const worldsSeason = ws?.[1] ? (ws[2] ? Number(ws[1]) : Number(ws[1]) - 1) : null;
  // Rookies: "rookie teams", "a team that started as a rookie this year".
  const rookie = !!(take(/\b(?:(?:who|that)\s+)?(?:started|start|starting|began|begun)\s+(?:out\s+)?as\s+(?:an?\s+)?rookies?(?:\s+teams?)?\b/)
    ?? take(/\b(?:rookie|first[\s-]year)(?=\s+(?:ftc\s+)?(?:teams?|robots?)\b)/));
  // Thresholds, each applied: a stat against a number ("with OPR over 100", ", OPR 90+", "a win rate over 70 percent"),
  // or a count of matches or wins ("with at least 30 matches", "that played 20+ matches"). A stat with a bare number
  // and no comparison is at least that number; a year is never one ("by opr 2025").
  const thresholds: (Threshold & { stat: ListStat })[] = [];
  const LEAD = String.raw`(?:(?:with|who\s+had|that\s+had|who\s+have|that\s+have|who\s+has|that\s+has|having|whose)\s+)?`;
  const AMOUNT = String.raw`${NUM}(?![\d.]|\s*[-–/]\s*\d)(?:\s*(\+|%|percent|per\s+cent)(?!\w))?`;
  // "or above", "or more", "and up" after a number: at least it ("opr 44 or above", "44 or above opr").
  const AT_LEAST = String.raw`(?:\s+(?:or|and)\s+(?:above|more|higher|over|better|up))`;
  for (let k = 0; k < 3; k++) {
    const T = new RegExp(String.raw`\b${LEAD}(?:an?\s+)?${STAT}\s+(?:of\s+|is\s+|was\s+)?(?:${OP}\s+)?${AMOUNT}(${AT_LEAST})?`);
    const seen = T.exec(rest);
    // A year after a stat with no comparison ("by opr 2025") is the season's words, left for seasonWords.
    if (seen && !(!seen[2] && !seen[4] && !seen[5] && /^(?:19|20)\d\d$/.test(seen[3]))) {
      const t = take(T)!;
      const stat = statOf(t[1]);
      if (!stat) return null;
      thresholds.push({ stat, op: t[2] ? opOf(t[2]) : "ge", value: Number(t[3]) });
      continue;
    }
    // The number said first, with the words that make it a floor: "with 44 or above opr".
    const F = new RegExp(String.raw`\b${LEAD}${NUM}(?![\d.])${AT_LEAST}\s+${STAT}\b`);
    const first = take(F);
    if (first) {
      const stat = statOf(first[2]);
      if (!stat) return null;
      thresholds.push({ stat, op: "ge", value: Number(first[1]) });
      continue;
    }
    const c = take(new RegExp(String.raw`\b((?:with|having|who\s+(?:have|had|has)|that\s+(?:have|had|has)|(?:who\s+|that\s+)?(?:played|play|plays))\s+)?(?:${OP}\s+)?${NUM}(\+)?\s+(matches|match|games?|wins?)\b`));
    if (!c) break;
    // A count needs a comparison or a verb ("10 teams" never is one).
    if (!c[1] && !c[2] && !c[4]) return null;
    thresholds.push({ stat: /^w/.test(c[5]) ? "wins" : "matches", op: c[2] ? opOf(c[2]) : "ge", value: Number(c[3]) });
  }
  const out = take(new RegExp(String.raw`\b(?:and|with|plus|showing)\s+(?:their|its|the)\s+${STAT}(?:\s+(?:and|&)\s+${STAT})?(?:\s*¦)*\s*$`));
  // Rookies alone are the rookie leaderboard's ("best rookie team in new jersey"): a list here needs another filter.
  if (!award && !ws && !thresholds.length) return null;
  // The words that joined a clause go with it; "list them all" and "worldwide" add nothing.
  rest = rest.replace(/(?:\b(?:and|but|who|that|which|also|already)\s+)*¦(?:\s+(?:and|but)\b)*/g, " ")
    .replace(/\b(?:list|show)\s+(?:them|all\s+of\s+them)(?:\s+all)?\s*$|\b(?:worldwide|world\s+wide|globally|in\s+the\s+world)\b/g, " ");
  const sw = seasonWords(rest);
  if (sw.ever) return null;
  rest = sw.rest;
  const m = /^(?:show(?: me)?|list|which|what|find|get|are there(?: any)?)?\s*(?:(?:the |an? )?(?:leaderboard|rankings?|list|standings) (?:for|of) )?(?:all |any |an? )?(?:the )?(?:(?:top|best|highest(?: ranked)?|strongest)(?: (\d{1,2}))? )?(?:(.+?) )?(?:ftc )?(?:teams?|robots?)(?: (?:by|for|on|ranked by|sorted by) (.+?))?(?: (?:in|from|based in) (.+?))?(?: (?:by|ranked by|sorted by) (.+?))?$/.exec(squash(rest));
  if (!m) return null;
  const stat = m[3] ?? m[5] ? statOf(m[3] ?? m[5]) : null;
  if ((m[3] ?? m[5]) && !stat) return null;
  const placeWords = m[4] ?? m[2] ?? null;
  if (m[4] && m[2]) return null;
  const region = placeWords ? regionOf(placeWords) : null;
  // A place that isn't a state or province is a country, else a home city (checked against the team directory when
  // answered).
  const c = placeWords && !region ? countryOf(placeWords) : null;
  const country = c ? { code: c.code, name: c.name } : null;
  const city = placeWords && !region && !country ? placeWords : null;
  if (city && !/^[a-z][a-z .'-]{1,40}$/.test(city)) return null;
  const outputs = out ? [out[1], out[2]].filter(Boolean).map((s) => statOf(s)).filter((s): s is ListStat => !!s) : [];
  return {
    kind: "list", n: m[1] ? Number(m[1]) : null, stat, region, country, city,
    // A Worlds season named wins; the season words otherwise (else the default season, said on the card).
    season: worldsSeason ?? sw.season,
    award: award ? { type: award[1], label: award[2] } : null, worlds: !!wd, ...(nwd ? { noWorlds: true } : {}), ...(rookie ? { rookie: true } : {}),
    thresholds, outputs,
  };
}

const SIDE_END = String.raw`(.*)$`;
/** Words about a prediction a question says beside it: "according to (the) predictions", "and by how much would they
 *  lose", "by what margin". */
const PREDICT_WORDS = /\b(?:and )?(?:according to|based on|using|per) (?:the )?(?:predictions?|engine|ratings?|forecasts?|predict)\b|\b(?:and )?(?:by )?(?:how much|what margin|how many points)(?: (?:would|will|could|do|does) (?:they|it|we) (?:lose|win))?(?: by)?\b/g;

/** The compound question `raw` asks, or null. `raw` is the query as search cleaned it (plurals singular). */
export function readCompound(raw: string): CompoundQuestion | null {
  const q = norm(raw);
  let m: RegExpExecArray | null;
  const when = (tail: string) => { const s = seasonWords(tail); return s.rest ? null : { season: s.season, ever: s.ever, latest: s.latest }; };

  // "12345 vs 67890 vs 33950 which has highest reliability": three or four team numbers.
  if ((m = new RegExp(String.raw`^((?:\d{1,5} (?:vs\.? |versus |and |or )?){2,3}\d{1,5}) (?:which|who)(?: one| team)? (?:has |have |is |had )?(?:the )?(?:highest|best|most|higher|better|greatest|strongest) (reliability|reliable|opr)${SIDE_END}`).exec(q))) {
    const teams = [...new Set(m[1].split(" ").filter((w) => /^\d+$/.test(w)).map(Number))];
    const w = when(m[3]);
    // "Ever" isn't one season's reliability: left to search rather than answered for one season.
    if (teams.length >= 3 && teams.length <= 4 && w && !w.ever) return { kind: "set-best", teams, stat: /^reliab/.test(m[2]) ? "reliability" : "opr", when: w };
  }

  // "what was 12345 opr at their first event this season compared to last season".
  if ((m = /^(?:what (?:was|is|were) )?(.+?) opr (?:at|in) (?:their|its|the) (first|last|latest|most recent|final) (?:event|competition|meet|tournament) (?:of |in )?(.+?) (?:compared (?:to|with)|vs\.?|versus|against|and) (.+?)$/.exec(q))) {
    const a = seasonWords(m[3]), b = seasonWords(m[4]);
    const said = (w: SeasonWords) => (w.latest ? "this" : w.last ? "last" : null);
    if (!a.rest && !b.rest && a.season != null && b.season != null && (a.season !== b.season || (a.latest !== b.latest))) return { kind: "event-pair", core: m[1], which: m[2] === "first" ? "first" : "last", seasons: [a.season, b.season], said: [said(a), said(b)] };
  }

  // "12345 matches where they lost by less than 10 points", "12345 wins by more than 50 this season".
  if ((m = new RegExp(String.raw`^(.+?) (?:(?:matches|match|games?) (?:where|when|in which|that)? ?(?:they |it |the team )?(won|lost|win|lose)|(wins?|losses|loss)) by ${OP} ${NUM}(?: points?| pts)?${SIDE_END}`).exec(q))) {
    const w = when(m[6]);
    const word = m[2] ?? m[3];
    if (w) return { kind: "margin", core: m[1], result: /^w/.test(word) ? "W" : "L", margin: { op: opOf(m[4]), value: Number(m[5]) }, when: w };
  }

  // "12345 awards and record in 2025-26 combined".
  const PART = String.raw`(awards?|record|opr)`;
  if ((m = new RegExp(String.raw`^(.+?) ${PART} (?:and|&|plus|with) (?:their |its )?${PART}${SIDE_END}`).exec(q))) {
    const part = (s: string) => (/^award/.test(s) ? "awards" : s === "record" ? "record" : "opr") as "awards" | "record" | "opr";
    const parts = [...new Set([part(m[2]), part(m[3])])];
    const w = when(m[4]);
    if (parts.length === 2 && w && !/\b(?:vs\.?|versus|and|or)\b/.test(m[1])) return { kind: "combined", core: m[1], parts, when: w };
  }

  // "12345 partners at NJ championship who had opr over 80", "12345 opponents this season with opr above 100".
  // The same asked as a question by the verb: "who partnered 12345 at NJ championship with opr over 80", "who teamed up
  // with 12345 …", "who played against 12345 …" (the side is the verb's: with a partner, against an opponent).
  const THRESH = String.raw`(?: (?:at|in) (.+?))? (?:who|that|which|with)(?: had| have| has| having)? (?:an? )?(?:opr|event opr) (?:of |is |was )?${OP} ${NUM}${SIDE_END}`;
  const asked = new RegExp(String.raw`^(?:who|which teams?|what teams?)(?: have| has| did)? (partnered|teamed up|teamed|played alongside|played against|played|faced|met)( with| against)? (.+?)${THRESH}`).exec(q);
  const named = asked ? null : new RegExp(String.raw`^(.+?) (?:alliance )?(partners?|opponents?)${THRESH}`).exec(q);
  const sided = asked
    ? { core: asked[3], against: /against|faced|met/.test(`${asked[1]}${asked[2] ?? ""}`) || (asked[1] === "played" && !asked[2]), rest: asked.slice(4) }
    : named ? { core: named[1], against: !/^p/.test(named[2]), rest: named.slice(3) } : null;
  if (sided) {
    const [atWords, op, value, tail] = sided.rest;
    const w = when(tail);
    // "at <event>" names an event unless its words are only a season ("in 2024-25").
    const at = atWords ? seasonWords(atWords) : null;
    const scoped = at && (at.season != null || at.ever) ? { season: at.season, ever: at.ever, latest: at.latest } : null;
    // An OPR is one season's: "ever" across seasons isn't read here.
    if (w && !(scoped ?? w).ever) return { kind: "side-threshold", core: sided.core, side: sided.against ? "opponents" : "partners", at: at?.rest || null, threshold: { op: opOf(op), value: Number(value) }, when: scoped && w.season == null ? scoped : w };
  }

  // "can 12345 beat a top 10 worldwide team", "would 12345 beat a team ranked top 5": not a meeting that happened, the
  // engine's call against each of them. What the question adds about the call ("according to predictions", "and by how
  // much would they lose") is the card's own, so it's read as said; any other words are left to the readers after this.
  if ((m = /^(?:can|could|will|would) (.+?) (?:beat|defeat|win against|win vs|outscore) (?:a|any|an|the) (?:(?:team|opponent)s? (?:that (?:is|are) |who (?:is|are) )?(?:ranked )?(?:in the )?)?top (\d{1,3})(?: (?:teams? )?(?:worldwide|in the world|globally|world ?wide))?(?: (?:team|opponent)s?)?(.*)$/.exec(q))) {
    const w = when(m[3].replace(PREDICT_WORDS, " ").replace(/\s+/g, " ").trim());
    if (w && !w.ever && Number(m[2]) >= 1 && Number(m[2]) <= 25) return { kind: "predict-top", core: m[1], n: Number(m[2]), when: w };
  }

  // "did 12345 ever beat a team ranked top 10 worldwide".
  if ((m = /^(?:did|has|have) (.+?) (?:(ever) )?(?:beat|beaten|defeat|defeated|win against|won against) (?:a|any|an) (?:team|opponent)s? (?:that (?:was|is|were) |who (?:was|is|were) )?(?:ranked )?(?:in the )?top (\d{1,3})(?: (?:teams? )?(?:worldwide|in the world|globally|world ?wide|in the world rankings))?(?: by (opr|rating))?(.*)$/.exec(q))) {
    const w = when(`${m[2] ?? ""} ${m[5]}`);
    if (w) return { kind: "beat-top", core: m[1], n: Number(m[3]), by: m[4] === "opr" ? "opr" : "rating", when: w };
  }

  // "12345 best event by rank and worst event by opr in same season".
  const PICK = String.raw`(best|worst|top|lowest|highest) (?:event|competition|tournament) by (rank|ranking|opr|record)`;
  if ((m = new RegExp(String.raw`^(.+?) ${PICK} and (?:their |its |the )?${PICK}${SIDE_END}`).exec(q))) {
    const pick = (p: string, by: string) => ({ pick: /^(?:best|top|highest)$/.test(p) ? "best" as const : "worst" as const, by: /^rank/.test(by) ? "rank" as const : by === "opr" ? "opr" as const : "record" as const });
    const w = when(m[6]);
    if (w && !w.ever) return { kind: "event-picks", core: m[1], picks: [pick(m[2], m[3]), pick(m[4], m[5])], when: w };
  }

  // "what is 12345 average score when they win versus when they lose".
  const WIN = String.raw`(?:they |it )?(?:win|wins|won|winning)`, LOSE = String.raw`(?:they |it )?(?:lose|loses|lost|losing|losses|loss)`;
  const VS = String.raw`(?:versus|vs\.?|compared (?:to|with)|and|or|against)`;
  if ((m = new RegExp(String.raw`^(?:what (?:is|was|are|were) )?(.+?) (?:average|avg|mean) (?:match |alliance )?(?:score|point)s? (?:when|in|in matches) (?:${WIN} ${VS} (?:when |in )?${LOSE}|${LOSE} ${VS} (?:when |in )?${WIN})${SIDE_END}`).exec(q))) {
    const w = when(m[2]);
    if (w) return { kind: "win-loss-average", core: m[1], when: w };
  }

  // "12345 opr if you exclude their worst event".
  if ((m = /^(?:what (?:is|was|would be) )?(.+?) opr (?:if (?:you |we )?|when (?:you |we )?)?(?:exclude|excluding|without|drop|dropping|minus|ignore|ignoring|remove|removing|leaving out|leave out) (?:their|its|the) (worst|lowest|weakest|best|highest) event(.*)$/.exec(q))) {
    const w = when(m[3]);
    if (w && !w.ever) return { kind: "opr-excluding", core: m[1], drop: /^(?:best|highest)$/.test(m[2]) ? "best" : "worst", when: w };
  }

  // "How many NJ teams went to worlds in 2024": the list, its length the count. Said of two years or seasons ("… in
  // 2024 versus 2025"): the same list read once with each, side by side.
  const count = /^(?:how many|number of|the number of|count of|count)\s+(.+)$/.exec(q);
  if (count) {
    const YEAR = String.raw`((?:19|20)\d\d(?:\s*[-–/]\s*\d\d)?)`;
    const pair = new RegExp(String.raw`^(.+?\s)${YEAR}\s+(?:versus|vs\.?|v|compared\s+(?:to|with)|against)\s+(?:in\s+)?${YEAR}$`).exec(count[1]);
    if (pair) {
      const a = readList(`${pair[1]}${pair[2]}`), b = readList(`${pair[1]}${pair[3]}`);
      // A count is of every team on the list: a "top N" said with it limits nothing counted (Greptile on #1094).
      return a?.kind === "list" && b?.kind === "list" && a.season != null && b.season != null && a.season !== b.season ? { kind: "list-pair", lists: [{ ...a, n: null }, { ...b, n: null }] } : null;
    }
    const one = readList(count[1]);
    if (one?.kind === "list") return { ...one, n: null };
  }
  return readList(q);
}
