// Compound questions (docs/search.md, "Stat answers"): one question that joins filters or asks for two things at once
// ("top 5 NJ teams by auto opr who also won inspire", "4215 matches where they lost by less than 10 points", "4215
// awards and record in 2025-26 combined"). Read by fixed rules, clause by clause, into subject teams, filters and
// outputs; answered from the stored rows (./families/compound.ts). Every filter read is applied and shown on the card;
// a question with a clause these rules don't read is left to the readers after this one.
import type { Region } from "../../../src/shared/regions.js";
import { findRegions, nearRegion } from "../../../src/shared/regions.js";
import { countryOf } from "../../../src/shared/countries.js";
import { SEASONS } from "../../data/seasons.js";
import { searchSeason } from "./season.js";

/** "over 100", "less than 10", "at least 3": a comparison with a number. */
export interface Threshold { op: "gt" | "ge" | "lt" | "le"; value: number }
/** A season stat a list filters, sorts or shows (families/leaderboard.ts BOARD_STATS keys). */
export type ListStat = "opr" | "auto" | "teleop" | "endgame" | "rating" | "win-rate" | "record" | "reliability";

/** The season words of a clause: one season, every season ("ever"), or none said. */
export interface SeasonWords { season: number | null; ever: boolean; latest: boolean }

export type CompoundQuestion =
  /** Teams by place, filtered by an award won, a Worlds season or a stat threshold, sorted by a stat, top N. */
  | { kind: "list"; n: number | null; stat: ListStat | null; region: Region | null; country: { code: string; name: string } | null; city: string | null; season: number | null;
      award: { type: string; label: string } | null; worlds: boolean; threshold: (Threshold & { stat: ListStat }) | null; outputs: ListStat[] }
  /** One team's OPR at its first (or last) event of two seasons, side by side. */
  | { kind: "event-pair"; core: string; which: "first" | "last"; seasons: [number, number] }
  /** One team's matches it won or lost by a margin. */
  | { kind: "margin"; core: string; result: "W" | "L"; margin: Threshold; when: SeasonWords }
  /** Two of a team's answers on one card: its record, its awards, its OPR. */
  | { kind: "combined"; core: string; parts: ("record" | "awards" | "opr")[]; when: SeasonWords }
  /** A team's partners (or opponents) at an event or in a season, filtered by their OPR. */
  | { kind: "side-threshold"; core: string; side: "partners" | "opponents"; at: string | null; threshold: Threshold; when: SeasonWords }
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
  if (out.season == null && take(/\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(?:this|current)\s+(?:season|year)\b/)) { out.season = searchSeason(); out.latest = true; }
  if (out.season == null && take(/\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(?:last|previous|past)\s+(?:season|year)\b/)) out.season = searchSeason() - 1;
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
const AWARD = String.raw`(inspire|think|innovate|design|reach|sustain|connect|control|motivate|compass|judges?(?: choice)?|winning alliance|an? event|a tournament)`;

/** A region named outright or by a near miss, else null (read.ts regionOf). */
const regionOf = (s: string): Region | null => { const rs = findRegions(s); return rs.length === 1 ? rs[0] : rs.length ? null : nearRegion(s); };

/** "teams in NJ that went to worlds in 2025 and their opr", "top 5 NJ teams by auto opr who also won inspire", "teams
 *  from Oradell with opr over 100": a list of teams with at least one filter clause (an award, Worlds, a threshold). */
function readList(q: string): CompoundQuestion | null {
  if (!/\b(?:teams?|robots?)\b/.test(q)) return null;
  let rest = ` ${q} `;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
  const WHO = String.raw`(?:(?:who|that|which)\s+)?(?:(?:also|have|has|had)\s+)*`;
  const aw = take(new RegExp(String.raw`\b${WHO}(?:won|win|received|earned|got)\s+(?:an?\s+|the\s+)?${AWARD}(?:\s+awards?)?\b`))
    ?? take(new RegExp(String.raw`\b${AWARD}\s+(?:award\s+)?winners?\b`));
  const award = aw ? AWARDS.find(([re]) => re.test(aw[1]))! : null;
  const wd = take(new RegExp(String.raw`\b${WHO}(?:went|go|gone|been|qualified|advanced|made it|competed|played|were|was)\s+(?:to|at|for|in)\s+(?:the\s+)?(?:worlds?|world championships?|first championship|houston)(?:\s+(?:in|during)?\s*(20\d\d)(?:\s*[-–/]\s*(\d\d))?)?\b`))
    ?? take(/\b(?:worlds?|first championship)\s+(?:teams?|qualifiers?|attendees?)(?:\s+(?:in|during)?\s*(20\d\d)(?:\s*[-–/]\s*(\d\d))?)?\b/);
  // "Worlds in 2025" is the championship held in 2025 (the 2024–25 season); "worlds 2025-26" names its season.
  const worldsSeason = wd?.[1] ? (wd[2] ? Number(wd[1]) : Number(wd[1]) - 1) : null;
  const th = take(new RegExp(String.raw`\b(?:with|who\s+had|that\s+had|who\s+have|that\s+have|having|whose)\s+(?:an?\s+)?${STAT}\s+(?:of\s+|is\s+|was\s+)?${OP}\s+${NUM}%?`));
  const out = take(new RegExp(String.raw`\b(?:and|with|plus|showing)\s+(?:their|its|the)\s+${STAT}(?:\s+(?:and|&)\s+${STAT})?\s*$`));
  if (!award && !wd && !th) return null;
  const sw = seasonWords(rest);
  if (sw.ever) return null;
  rest = sw.rest;
  const m = /^(?:show(?: me)?|list|which|what|find|get)?\s*(?:all )?(?:the )?(?:(?:top|best|highest(?: ranked)?|strongest)(?: (\d{1,2}))? )?(?:(.+?) )?(?:ftc )?(?:teams?|robots?)(?: (?:by|for|on|ranked by) (.+?))?(?: (?:in|from|based in) (.+?))?(?: (?:by|ranked by) (.+?))?$/.exec(squash(rest));
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
  const tStat = th ? statOf(th[1]) : null;
  if (th && !tStat) return null;
  return {
    kind: "list", n: m[1] ? Number(m[1]) : null, stat, region, country, city,
    // A Worlds season named wins; the season words otherwise (else the default season, said on the card).
    season: worldsSeason ?? sw.season,
    award: award ? { type: award[1], label: award[2] } : null, worlds: !!wd,
    threshold: th && tStat ? { stat: tStat, op: opOf(th[2]), value: Number(th[3]) } : null, outputs,
  };
}

const SIDE_END = String.raw`(.*)$`;

/** The compound question `raw` asks, or null. `raw` is the query as search cleaned it (plurals singular). */
export function readCompound(raw: string): CompoundQuestion | null {
  const q = norm(raw);
  let m: RegExpExecArray | null;
  const when = (tail: string) => { const s = seasonWords(tail); return s.rest ? null : { season: s.season, ever: s.ever, latest: s.latest }; };

  // "4215 vs 6980 vs 33950 which has highest reliability": three or four team numbers.
  if ((m = new RegExp(String.raw`^((?:\d{1,5} (?:vs\.? |versus |and |or )?){2,3}\d{1,5}) (?:which|who)(?: one| team)? (?:has |have |is |had )?(?:the )?(?:highest|best|most|higher|better|greatest|strongest) (reliability|reliable|opr)${SIDE_END}`).exec(q))) {
    const teams = [...new Set(m[1].split(" ").filter((w) => /^\d+$/.test(w)).map(Number))];
    const w = when(m[3]);
    // "Ever" isn't one season's reliability: left to search rather than answered for one season.
    if (teams.length >= 3 && teams.length <= 4 && w && !w.ever) return { kind: "set-best", teams, stat: /^reliab/.test(m[2]) ? "reliability" : "opr", when: w };
  }

  // "what was 4215 opr at their first event this season compared to last season".
  if ((m = /^(?:what (?:was|is|were) )?(.+?) opr (?:at|in) (?:their|its|the) (first|last|latest|most recent|final) (?:event|competition|meet|tournament) (?:of |in )?(.+?) (?:compared (?:to|with)|vs\.?|versus|against|and) (.+?)$/.exec(q))) {
    const a = seasonWords(m[3]), b = seasonWords(m[4]);
    if (!a.rest && !b.rest && a.season != null && b.season != null && a.season !== b.season) return { kind: "event-pair", core: m[1], which: m[2] === "first" ? "first" : "last", seasons: [a.season, b.season] };
  }

  // "4215 matches where they lost by less than 10 points", "4215 wins by more than 50 this season".
  if ((m = new RegExp(String.raw`^(.+?) (?:(?:matches|match|games?) (?:where|when|in which|that)? ?(?:they |it |the team )?(won|lost|win|lose)|(wins?|losses|loss)) by ${OP} ${NUM}(?: points?| pts)?${SIDE_END}`).exec(q))) {
    const w = when(m[6]);
    const word = m[2] ?? m[3];
    if (w) return { kind: "margin", core: m[1], result: /^w/.test(word) ? "W" : "L", margin: { op: opOf(m[4]), value: Number(m[5]) }, when: w };
  }

  // "4215 awards and record in 2025-26 combined".
  const PART = String.raw`(awards?|record|opr)`;
  if ((m = new RegExp(String.raw`^(.+?) ${PART} (?:and|&|plus|with) (?:their |its )?${PART}${SIDE_END}`).exec(q))) {
    const part = (s: string) => (/^award/.test(s) ? "awards" : s === "record" ? "record" : "opr") as "awards" | "record" | "opr";
    const parts = [...new Set([part(m[2]), part(m[3])])];
    const w = when(m[4]);
    if (parts.length === 2 && w && !/\b(?:vs\.?|versus|and|or)\b/.test(m[1])) return { kind: "combined", core: m[1], parts, when: w };
  }

  // "4215 partners at NJ championship who had opr over 80", "4215 opponents this season with opr above 100".
  if ((m = new RegExp(String.raw`^(.+?) (?:alliance )?(partners?|opponents?)(?: (?:at|in) (.+?))? (?:who|that|which|with)(?: had| have| has| having)? (?:an? )?(?:opr|event opr) (?:of |is |was )?${OP} ${NUM}${SIDE_END}`).exec(q))) {
    const w = when(m[6]);
    // "at <event>" names an event unless its words are only a season ("in 2024-25").
    const at = m[3] ? seasonWords(m[3]) : null;
    const scoped = at && (at.season != null || at.ever) ? { season: at.season, ever: at.ever, latest: at.latest } : null;
    // An OPR is one season's: "ever" across seasons isn't read here.
    if (w && !(scoped ?? w).ever) return { kind: "side-threshold", core: m[1], side: /^p/.test(m[2]) ? "partners" : "opponents", at: at?.rest || null, threshold: { op: opOf(m[4]), value: Number(m[5]) }, when: scoped && w.season == null ? scoped : w };
  }

  // "did 4215 ever beat a team ranked top 10 worldwide".
  if ((m = /^(?:did|has|have) (.+?) (?:(ever) )?(?:beat|beaten|defeat|defeated|win against|won against) (?:a|any|an) (?:team|opponent)s? (?:that (?:was|is|were) |who (?:was|is|were) )?(?:ranked )?(?:in the )?top (\d{1,3})(?: (?:teams? )?(?:worldwide|in the world|globally|world ?wide|in the world rankings))?(?: by (opr|rating))?(.*)$/.exec(q))) {
    const w = when(`${m[2] ?? ""} ${m[5]}`);
    if (w) return { kind: "beat-top", core: m[1], n: Number(m[3]), by: m[4] === "opr" ? "opr" : "rating", when: w };
  }

  // "4215 best event by rank and worst event by opr in same season".
  const PICK = String.raw`(best|worst|top|lowest|highest) (?:event|competition|tournament) by (rank|ranking|opr|record)`;
  if ((m = new RegExp(String.raw`^(.+?) ${PICK} and (?:their |its |the )?${PICK}${SIDE_END}`).exec(q))) {
    const pick = (p: string, by: string) => ({ pick: /^(?:best|top|highest)$/.test(p) ? "best" as const : "worst" as const, by: /^rank/.test(by) ? "rank" as const : by === "opr" ? "opr" as const : "record" as const });
    const w = when(m[6]);
    if (w && !w.ever) return { kind: "event-picks", core: m[1], picks: [pick(m[2], m[3]), pick(m[4], m[5])], when: w };
  }

  // "what is 4215 average score when they win versus when they lose".
  const WIN = String.raw`(?:they |it )?(?:win|wins|won|winning)`, LOSE = String.raw`(?:they |it )?(?:lose|loses|lost|losing|losses|loss)`;
  const VS = String.raw`(?:versus|vs\.?|compared (?:to|with)|and|or|against)`;
  if ((m = new RegExp(String.raw`^(?:what (?:is|was|are|were) )?(.+?) (?:average|avg|mean) (?:match |alliance )?(?:score|point)s? (?:when|in|in matches) (?:${WIN} ${VS} (?:when |in )?${LOSE}|${LOSE} ${VS} (?:when |in )?${WIN})${SIDE_END}`).exec(q))) {
    const w = when(m[2]);
    if (w) return { kind: "win-loss-average", core: m[1], when: w };
  }

  // "4215 opr if you exclude their worst event".
  if ((m = /^(?:what (?:is|was|would be) )?(.+?) opr (?:if (?:you |we )?|when (?:you |we )?)?(?:exclude|excluding|without|drop|dropping|minus|ignore|ignoring|remove|removing|leaving out|leave out) (?:their|its|the) (worst|lowest|weakest|best|highest) event(.*)$/.exec(q))) {
    const w = when(m[3]);
    if (w && !w.ever) return { kind: "opr-excluding", core: m[1], drop: /^(?:best|highest)$/.test(m[2]) ? "best" : "worst", when: w };
  }

  return readList(q);
}
