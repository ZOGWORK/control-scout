// Plain-English text for filters and stats: the builder's preview sentence
// ("Teams with penalty points TOT under 2 and (…)"), and how a stat's value
// and column header look (colour family, formatting).
import type { FilterGroup, FilterNode } from "../../shared/filterDsl";
import { STAT_BY_KEY, type RecordScope, type StatDef } from "../../shared/statCatalog";
import { num, oddsPct } from "../format";
import { toneOf, type Tone } from "../../shared/statTones";

const OP_WORDS: Record<string, string> = { lt: "under", lte: "at most", gt: "over", gte: "at least", eq: "exactly", ne: "not", contains: "containing" };
const TEXT_OP_WORDS: Record<string, string> = { eq: "is", ne: "is not", contains: "contains" };

/** "auto points AVG" — the label as it reads mid-sentence. */
export function statPhrase(def: StatDef | undefined, key: string): string {
  if (!def) return key;
  // Words in lower case; abbreviations (TOT, AVG, OPR, NP…) stay as they are.
  return def.label.split(" ").map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

function condText(key: string, op: string, value: number | string): string {
  const def = STAT_BY_KEY.get(key);
  const what = statPhrase(def, key);
  if (typeof value === "string") return `${what} ${TEXT_OP_WORDS[op] ?? op} “${value}”`;
  const v = `${num(value, 2)}${def?.percent ? "%" : ""}`;
  return `${what} ${OP_WORDS[op] ?? op} ${v}`;
}

/** The sentence a filter reads as, e.g. "Teams with penalty points TOT under 2 and (total points OPR at least 55 or auto points AVG at least 30)". */
export function describeFilter(g: FilterGroup | null, scope: RecordScope): string {
  const subject = scope === "match" ? "Matches" : scope === "teamSeason" ? "Teams (season)" : "Teams";
  if (!g || !g.children.length) return `All ${subject.toLowerCase().replace(" (season)", "")}`;
  const node = (n: FilterNode, nested: boolean): string => {
    if (n.kind === "cond") return condText(n.key, n.op, n.value);
    const inner = n.children.map((c) => node(c, true)).join(n.type === "and" ? " and " : " or ");
    return nested && n.children.length > 1 ? `(${inner})` : inner;
  };
  return `${subject} with ${node(g, false)}`;
}

const PART_SHORT: Record<string, string> = {
  totalPoints: "Total", totalPointsNp: "np", autoPoints: "Auto", dcPoints: "DC", endgamePoints: "Endgame", penaltyPointsCommitted: "Pen", penaltyPointsByOpp: "Opp pen",
};

/** A compact column header: "np OPR", "Auto AVG", "RS"… (FTC Scout's style). */
export function headerOf(def: StatDef | undefined, key: string): string {
  if (!def) return key;
  if (def.base && def.aggregate) return `${PART_SHORT[def.base]} ${def.aggregate.toUpperCase()}`;
  return def.short;
}

// --- Colours ------------------------------------------------------------------

export { toneOf, type Tone } from "../../shared/statTones";

/**
 * v8's take on the scoring categories (Sushil, 11-19: one colour means one category, everywhere): the classic's
 * hues, softened to their 300 shades for the dark page. np / total OPR purple, Auto blue, DC orange, Endgame green,
 * Penalties red. Ranks, counts and records stay white in v8 (no entry here). Text and a small dot (preset chips).
 */
export const V8_CATEGORY: Partial<Record<Tone, { text: string; dot: string }>> = {
  violet: { text: "v8:text-violet-300", dot: "v8:bg-violet-300" },
  sky: { text: "v8:text-blue-300", dot: "v8:bg-blue-300" },
  orange: { text: "v8:text-orange-300", dot: "v8:bg-orange-300" },
  emerald: { text: "v8:text-emerald-300", dot: "v8:bg-emerald-300" },
  rose: { text: "v8:text-red-300", dot: "v8:bg-red-300" },
  pink: { text: "v8:text-pink-300", dot: "v8:bg-pink-300" },
};

/** A stat column's v8 colour: only a scoring category's own stats (OPR, average, max… of total / np, auto, DC,
 *  endgame or penalty points) take one. Stats that share a classic tone by key alone (winning margin, high score,
 *  combined score, rank, RS, counts) stay white, so purple always means total points. */
export function v8CategoryOf(def: StatDef | undefined): string | undefined {
  if (!def?.base || def.category === "Control Scout Exclusives") return undefined;
  return V8_CATEGORY[toneOf(def)]?.text;
}

/** The same colours by OPR phase, for tables that list phases (event rankings, team page, compare). */
export const V8_PHASE = {
  np: V8_CATEGORY.violet!.text, auto: V8_CATEGORY.sky!.text, teleop: V8_CATEGORY.orange!.text, endgame: V8_CATEGORY.emerald!.text, pen: V8_CATEGORY.rose!.text,
} as const;
export type V8Phase = keyof typeof V8_PHASE;

/** Tailwind classes per tone: header text, header underline, soft chip background. */
export const TONE_CLASS: Record<Tone, { text: string; bar: string; chip: string }> = {
  gold: { text: "text-accent-text", bar: "bg-accent", chip: "bg-accent/15 text-accent-text border-accent/30" },
  red: { text: "text-red-700 dark:text-red-400", bar: "bg-red-500", chip: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/30" },
  blue: { text: "text-blue-600 dark:text-blue-400", bar: "bg-blue-500", chip: "bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  green: { text: "text-green-800 dark:text-green-500", bar: "bg-green-500", chip: "bg-green-500/12 text-green-800 dark:text-green-500 border-green-500/30" },
  violet: { text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500", chip: "bg-violet-500/12 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  sky: { text: "text-sky-700 dark:text-sky-400", bar: "bg-sky-400", chip: "bg-sky-400/12 text-sky-700 dark:text-sky-400 border-sky-400/30" },
  orange: { text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-400", chip: "bg-orange-400/12 text-orange-700 dark:text-orange-400 border-orange-400/30" },
  emerald: { text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-400", chip: "bg-emerald-400/12 text-emerald-700 dark:text-emerald-400 border-emerald-400/30" },
  rose: { text: "text-rose-700 dark:text-rose-400", bar: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/30" },
  pink: { text: "text-pink-700 dark:text-pink-400", bar: "bg-pink-400", chip: "bg-pink-400/12 text-pink-700 dark:text-pink-400 border-pink-400/30" },
  slate: { text: "text-text-muted", bar: "bg-text-base/25", chip: "bg-text-base/[0.06] text-text-muted border-line" },
  redAlliance: { text: "text-red-alliance", bar: "bg-red-alliance", chip: "bg-red-alliance/12 text-red-alliance border-red-alliance/30" },
  blueAlliance: { text: "text-blue-alliance", bar: "bg-blue-alliance", chip: "bg-blue-alliance/12 text-blue-alliance border-blue-alliance/30" },
};

const COUNT_KEYS = new Set(["rank", "teamNumber", "rookieYear", "qualMatchesPlayed", "wins", "losses", "ties", "events"]);

/** A stat value for a table cell / CSV-free display. Percentages use oddsPct (never a flat 0% or 100%). */
export function formatStat(def: StatDef | undefined, v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return v;
  if (def?.percent) return oddsPct(v / 100);
  if (def?.key === "swing") return `±${v.toFixed(2)}`;
  if (def && (COUNT_KEYS.has(def.key) || def.aggregate === "Tot" || def.aggregate === "Min" || def.aggregate === "Max" || def.category === "Match Scores")) return num(v, 2);
  return num(v, 1);
}
