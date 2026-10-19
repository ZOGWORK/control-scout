// Plain-English text for filters and stats: the builder's preview sentence
// ("Teams with penalty points TOT under 2 and (…)"), and how a stat's value
// and column header look (colour family, formatting).
import type { FilterGroup, FilterNode } from "../../shared/filterDsl";
import { STAT_BY_KEY, type RecordScope, type StatDef } from "../../shared/statCatalog";
import { num, oddsPct } from "../format";

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

/** Colour families for stat columns (FTC Scout's coloured headers, our palette). */
export type Tone = "gold" | "red" | "blue" | "green" | "violet" | "sky" | "orange" | "emerald" | "rose" | "pink" | "slate" | "redAlliance" | "blueAlliance";

export function toneOf(def: StatDef | undefined): Tone {
  if (!def) return "slate";
  if (def.category === "Control Scout Exclusives") return "gold";
  if (def.key.startsWith("red") && def.category === "Match Scores") return "redAlliance";
  if (def.key.startsWith("blue") && def.category === "Match Scores") return "blueAlliance";
  switch (def.base) {
    case "totalPoints": case "totalPointsNp": return "violet";
    case "autoPoints": return "sky";
    case "dcPoints": return "orange";
    case "endgamePoints": return "emerald";
    case "penaltyPointsCommitted": return "rose";
    case "penaltyPointsByOpp": return "pink";
  }
  switch (def.key) {
    case "rank": return "gold";
    case "rp": return "red";
    case "tb1": return "blue";
    case "qualMatchesPlayed": case "wins": case "losses": case "ties": case "events": return "green";
    case "winningMargin": case "highScore": case "combinedScore": return "violet";
  }
  return "slate";
}

/** Tailwind classes per tone: header text, header underline, soft chip background. */
export const TONE_CLASS: Record<Tone, { text: string; bar: string; chip: string }> = {
  gold: { text: "text-accent-text", bar: "bg-accent", chip: "bg-accent/15 text-accent-text border-accent/30" },
  red: { text: "text-red-600 dark:text-red-500", bar: "bg-red-500", chip: "bg-red-500/12 text-red-600 dark:text-red-500 border-red-500/30" },
  blue: { text: "text-blue-600 dark:text-blue-500", bar: "bg-blue-500", chip: "bg-blue-500/12 text-blue-600 dark:text-blue-500 border-blue-500/30" },
  green: { text: "text-green-700 dark:text-green-500", bar: "bg-green-500", chip: "bg-green-500/12 text-green-700 dark:text-green-500 border-green-500/30" },
  violet: { text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500", chip: "bg-violet-500/12 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  sky: { text: "text-sky-700 dark:text-sky-400", bar: "bg-sky-400", chip: "bg-sky-400/12 text-sky-700 dark:text-sky-400 border-sky-400/30" },
  orange: { text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-400", chip: "bg-orange-400/12 text-orange-700 dark:text-orange-400 border-orange-400/30" },
  emerald: { text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-400", chip: "bg-emerald-400/12 text-emerald-700 dark:text-emerald-400 border-emerald-400/30" },
  rose: { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", chip: "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30" },
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
  if (def && (COUNT_KEYS.has(def.key) || def.aggregate === "Tot" || def.aggregate === "Min" || def.aggregate === "Max" || def.category === "Match Scores")) return num(v, 2);
  return num(v, 1);
}
