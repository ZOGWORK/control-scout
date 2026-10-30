// Season references for /rules and the search over them. Everything is local: the page imports this module,
// so the search never asks the server and works with no signal.
import { BIOBUZZ } from "./biobuzz";
import type { QaRuling, RuleEntry, SeasonReference } from "./types";

export type { QaRuling, RuleEntry, RuleSection, SeasonReference } from "./types";

/** Newest season first. */
export const RULE_SEASONS: SeasonReference[] = [BIOBUZZ];

/** The season's reference, or the newest one for a season we have none for. */
export const ruleReference = (season?: number | null): SeasonReference =>
  RULE_SEASONS.find((r) => r.season === season) ?? RULE_SEASONS[0];

export { hasRuleReference } from "./seasons";

/** Lower case, accents and punctuation dropped, so "G-421", "g421" and "G421" all match. */
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.\s]/g, " ");
const words = (q: string) => fold(q).split(/\s+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
/** "g 421" typed with a space still finds G421. */
const compact = (q: string) => fold(q).replace(/\s+/g, "");

const ruleText = (r: RuleEntry, sectionTitle: string) => fold(`${r.id} ${r.title} ${r.summary} ${r.penalty ?? ""} ${(r.keywords ?? []).join(" ")} ${r.section} ${sectionTitle}`);
const rulingText = (q: QaRuling) => fold(`q${q.n} qa${q.n} ${q.rules.join(" ")} ${q.title} ${q.summary}`);

export interface RuleSearch { rules: RuleEntry[]; rulings: QaRuling[] }

/** Every rule and ruling with every word of the query; a rule whose number is the query comes first. */
export function searchRules(ref: SeasonReference, query: string): RuleSearch {
  const ws = words(query);
  if (!ws.length) return { rules: ref.rules, rulings: ref.rulings };
  const title = new Map(ref.sections.map((s) => [s.id, s.title]));
  const exact = compact(query);
  const hit = (hay: string) => ws.every((w) => hay.includes(w)) || (exact.length > 1 && hay.split(" ").includes(exact));
  const rules = ref.rules.filter((r) => hit(ruleText(r, title.get(r.section) ?? "")));
  // Exact number first ("g421"), then numbers that start with it ("g42" → G420…G428), then the rest in manual order.
  const rank = (r: RuleEntry) => { const id = fold(r.id).replace(/\s+/g, ""); return id === exact ? 0 : id.startsWith(exact) ? 1 : 2; };
  rules.sort((a, b) => rank(a) - rank(b));
  const rulings = ref.rulings.filter((q) => hit(rulingText(q)));
  return { rules, rulings };
}

/** The rulings that mention a rule, for "Q&A on this rule" under an entry. */
export const rulingsFor = (ref: SeasonReference, id: string) => ref.rulings.filter((q) => q.rules.includes(id));

/** "Oct 29, 2026" */
export const stampDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
