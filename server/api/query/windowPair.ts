// One team's question in two time windows, side by side ("12345 record this month, versus last month"): the same
// stat answer asked in each window exactly as said (nothing relaxed to a season), its headline number for each, and
// the window's dates. A window with nothing in it says so on its own tile; the card never borrows another window's
// number for it.
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import { dateRange } from "../../../src/shared/format.js";
import type { TimeSlot } from "./time.js";

/** The word that sets the second window against the first. */
export const PAIR_SPLIT = /(?:^|[\s,;])(?:vs\.?|versus|compared (?:to|with))(?=\s)/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The two answers (`x` for `times[0]`, `y` for `times[1]`) as one card. */
export function windowPairAnswer(q: string, times: [TimeSlot, TimeSlot], x: SearchAnswer, y: SearchAnswer, opts: { pages: SearchPageLink[] }): SearchAnswer {
  const [a, b] = [x.stat!, y.stat!];
  const [ta, tb] = times;
  // The stat's own name with the first window's words in it ("Record this month") gets the second window beside it.
  const title = a.title.toLowerCase().includes(ta.label.toLowerCase()) ? `${a.title} vs ${tb.label}` : `${a.title}: ${ta.label} vs ${tb.label}`;
  const when = (t: TimeSlot) => (t.from && t.to ? dateRange(t.from, t.to) : null);
  const tile = (s: StatAnswer, t: TimeSlot) => ({
    label: `${cap(t.label)}${when(t) ? ` (${when(t)})` : ""}`,
    value: s.headline?.value ?? "–",
    sub: s.headline ? s.headline.label : (s.none ?? "Nothing on record"),
    ...(s.headline?.href ? { href: s.headline.href } : {}),
  });
  const kpis: StatBlock = { kind: "kpis", items: [tile(a, ta), tile(b, tb)] };
  // The first window's own blocks (its matches) stay under the pair when it has any, else the second's; the links once.
  const own = (s: StatAnswer) => s.blocks.filter((k) => k.kind !== "kpis");
  // Each kept block says which window it is ("Wins, losses and ties, this month").
  const tagged = (s: StatAnswer, t: TimeSlot) => own(s).map((k) => ("title" in k && k.title && k.kind !== "links" && !k.title.toLowerCase().includes(t.label) ? { ...k, title: `${k.title}, ${t.label}` } : k));
  const rest = a.headline ? tagged(a, ta) : b.headline ? tagged(b, tb) : [];
  const links = rest.some((k) => k.kind === "links") ? [] : [...own(a), ...own(b)].filter((k) => k.kind === "links").slice(0, 1);
  const both = !a.headline && !b.headline;
  const who = a.team ? `${a.team.name ?? `Team ${a.team.number}`} (${a.team.number})` : "This team";
  const stat: StatAnswer = {
    ...a, intent: `${a.intent}-windows`, title, scope: [cap(ta.label), cap(tb.label), ...a.scope.filter((c) => c !== cap(ta.label) && c.toLowerCase() !== ta.label.toLowerCase())],
    blocks: [kpis, ...rest, ...links],
    headline: both ? undefined : { value: `${a.headline?.value ?? "–"} vs ${b.headline?.value ?? "–"}`, label: `${ta.label} vs ${tb.label}`, ...(a.headline?.sub ? { sub: a.headline.sub } : {}) },
    none: both ? `${who} has no matches on record ${ta.label} (${when(ta) ?? ta.label}) or ${tb.label} (${when(tb) ?? tb.label}).` : undefined,
    definition: `The same answer asked for each window, exactly as said: a window with nothing in it says so, never another window's number. ${a.definition}`,
  };
  return {
    ...x, q, stat, understood: { ...(x.understood ?? { kind: "question" }), kind: "question", label: x.understood?.label?.replace(a.title, title) ?? title },
    pages: opts.pages,
    intent: { kind: `stat-${stat.intent}`, pattern: `${x.intent?.pattern ?? "[team]"} [window] vs [window]`, met: true, understood: [] },
  };
}
