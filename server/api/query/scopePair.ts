// One no-team question asked of two scopes, side by side ("<event> highest score compared to the world record", "highest
// score in <place> vs <event>"): the same answer asked at each scope, its headline number for each, and how far apart
// they are. The second scope is said alone after the "versus" (an event, a place, or nothing: the whole world, "the
// world record"). A scope with nothing in it says so on its own tile; the card never borrows the other's number for it.
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";

/** A season's chip on a card ("2025–26"): its first year, or null. */
export function chipSeason(chip: string | undefined): number | null {
  const m = /^(\d{4})[–-](\d{2})$/.exec(chip ?? "");
  return m && (Number(m[1]) + 1) % 100 === Number(m[2]) ? Number(m[1]) : null;
}

/** The number a headline leads with ("273 points" → 273), or null. */
const leading = (v: string | undefined): number | null => {
  const m = /^-?\d+(?:\.\d+)?/.exec((v ?? "").replace(/,/g, ""));
  return m ? Number(m[0]) : null;
};

/** How far the first number is from the second, said in words ("12 points below the world record (95%)"). */
export function gapLine(a: StatAnswer, b: StatAnswer, bName: string): string | null {
  const x = leading(a.headline?.value), y = leading(b.headline?.value);
  if (x == null || y == null) return null;
  const unit = (a.headline!.value.replace(/^-?[\d.,]+\s*/, "") || "").trim();
  if (x === y) return `Level with ${bName}`;
  const d = Math.abs(x - y);
  const units = unit ? ` ${d === 1 ? unit.replace(/s$/, "") : unit}` : "";
  return `${d}${units} ${x < y ? "below" : "above"} ${bName}${y > 0 ? ` (${Math.round((x / y) * 100)}% of it)` : ""}`;
}

/** A side's name inside a sentence: the whole world in lower case ("vs the world record"), a name as it is. */
const inLine = (name: string) => (name === "World record" ? "the world record" : name === "Worldwide" ? "worldwide" : name);
/** A side's name after a list's title ("Top 10 alliance scores, worldwide"). */
const listed = (name: string) => (name === "World record" ? "worldwide" : inLine(name));

/** The two answers (`x` for the first scope, named `names[0]`; `y` for the second) as one card. The first side's lists
 *  stay whole under the pair; the second's first list only (its top scores), so the card isn't two cards long. */
export function scopePairAnswer(q: string, names: [string, string], x: SearchAnswer, y: SearchAnswer, opts: { pages: SearchPageLink[] }): SearchAnswer {
  const [a, b] = [x.stat!, y.stat!];
  const tile = (s: StatAnswer, name: string) => ({
    label: name,
    value: s.headline?.value ?? "–",
    sub: s.headline ? [s.headline.label, s.headline.sub].filter(Boolean).join(" · ") : (s.none ?? "Nothing on record"),
    ...(s.headline?.href ? { href: s.headline.href } : {}),
  });
  const kpis: StatBlock = { kind: "kpis", items: [tile(a, names[0]), tile(b, names[1])] };
  // Each side's own lists under the pair, each titled with its scope ("Top 5 alliance scores, <event>").
  const own = (s: StatAnswer, name: string) => s.blocks.filter((k) => k.kind !== "kpis" && k.kind !== "links")
    .map((k) => ("title" in k && k.title && !k.title.includes(name) ? { ...k, title: `${k.title}, ${listed(name)}` } : k));
  const links = [...a.blocks, ...b.blocks].filter((k) => k.kind === "links").slice(0, 1);
  const gap = a.headline && b.headline ? gapLine(a, b, inLine(names[1])) : null;
  const title = `${a.title} vs ${inLine(names[1])}`;
  const stat: StatAnswer = {
    ...a, intent: `${a.intent}-scopes`, title,
    scope: [...new Set([...a.scope, ...b.scope])],
    blocks: [kpis, ...own(a, names[0]), ...own(b, names[1]).slice(0, 1), ...links],
    headline: a.headline || b.headline
      ? { value: `${a.headline?.value ?? "–"} vs ${b.headline?.value ?? "–"}`, label: gap ?? `${names[0]} vs ${names[1]}` }
      : undefined,
    none: !a.headline && !b.headline ? `Nothing on record for ${names[0]} (${a.none ?? "no matches"}) or ${names[1]} (${b.none ?? "no matches"}).` : undefined,
    definition: `The same question asked of each, side by side: a side with nothing in it says so, never the other's number. ${a.definition}`,
    source: [a.source, b.source].filter(Boolean).join(" · "),
  };
  return {
    ...x, q, stat, understood: { ...(x.understood ?? { kind: "question" }), kind: "question", label: title },
    pages: opts.pages,
    intent: { kind: `stat-${stat.intent}`, pattern: `${x.intent?.pattern ?? "[scope]"} vs [scope]`, met: true, understood: [] },
  };
}
