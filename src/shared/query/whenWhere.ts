// "When" and "where" asks (search audit, "when/where asks"): "when did <team> win inspire" is the dates of the answer
// "<team> inspire awards" gives, "where did <team> play last" its event. The question is read as asked without the
// word (the pipeline's own answer), and that answer's rows (each an event and a date) are its headline. Nothing here
// names a team, an award or an event: they are the answer's own rows.
import { dateRange } from "../format.js";
import type { StatAnswer, StatBlock } from "../searchStat.js";

export type Ask = "when" | "where";

/** What a question asks for, by its first words: "when …", "what day …" (dates); "where …", "at which event …"
 *  (events). Null for any other question: "which event had …" asks for the events themselves. */
export function askOf(q: string): Ask | null {
  const s = q.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (/^(?:so |and )?(?:when\b|(?:on )?(?:what|which) (?:day|date)s?\b)/.test(s)) return "when";
  if (/^(?:so |and )?(?:where\b|(?:at|in) (?:what|which) (?:event|competition|meet|tournament)s?\b)/.test(s)) return "where";
  return null;
}

/** One row of an answer: an event and a date, and the page it opens. */
interface Place { event: string | null; date: string | null; href?: string }

/** The rows of `stat` that say what's asked (a date for "when", an event for "where"): its tables' rows that do, else
 *  its first list of matches (a score split by season is a table of events with no dates: its matches have them).
 *  Every row listed (an Inspire table's 2nd places too, as its headline counts them apart). */
function rowsOf(stat: StatAnswer, ask: Ask): Place[] {
  const says = (r: Place) => !!(ask === "when" ? r.date : r.event);
  // Every table of them, in order (an answer split by season is one table a season).
  const tables = stat.blocks.flatMap((b) => {
    if (b.kind !== "table") return [];
    const keys = new Set(b.columns.map((c) => c.key));
    const dateKey = keys.has("date") ? "date" : keys.has("when") ? "when" : null;
    if (!keys.has("event") && !dateKey) return [];
    return b.rows.map((r) => ({ event: str(r.cells.event), date: dateKey ? str(r.cells[dateKey]) : null, ...(r.href ? { href: r.href } : {}) })).filter(says);
  });
  if (tables.length) return tables;
  const m = stat.blocks.find((b) => b.kind === "matches" && b.rows.length);
  return m?.kind === "matches" ? m.rows.map((r) => ({ event: r.event?.label ?? null, date: dayOf(r.date), href: r.href })).filter(says) : [];
}
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
/** A row's day as it reads: a stored day ("2026-03-08") said as one ("Mar 8, 2026"), one already said as is. */
const dayOf = (d: string | null | undefined) => (!d ? null : /^\d{4}-\d\d-\d\d/.test(d) ? dateRange(d.slice(0, 10)) : d);

/** A day as format.ts dateRange writes one ("Jan 10, 2025", "Mar 8–9, 2026"). */
const DAY = /\b[A-Z][a-z]{2} \d{1,2}(?:\s?[–-]\s?(?:[A-Z][a-z]{2} )?\d{1,2})?, \d{4}\b/;
/** An answer of one thing whose rows aren't it (a team's first match, its rows the latest season's): the headline's
 *  own day and event, as its line says them ("Q8 at <event>", "<season> · <day>"); none when it says neither. */
function headlineRow(stat: StatAnswer): Place[] {
  const h = stat.headline;
  if (!h) return [];
  const date = [h.sub, h.label, h.value].map((x) => x && DAY.exec(x)?.[0]).find(Boolean) ?? null;
  const event = / at (.+?)(?: \(|$)/.exec(h.label ?? "")?.[1] ?? null;
  return date || event ? [{ event, date, ...(h.href ? { href: h.href } : {}) }] : [];
}

/** Up to three, then how many more: "A · B · C +2 more". */
const listed = (xs: string[]) => `${xs.slice(0, 3).join(" · ")}${xs.length > 3 ? ` +${xs.length - 3} more` : ""}`;

/** `stat` as the answer to "when" or "where": its rows' dates or events as the headline, a tile for each (up to
 *  six), what it answered under them. Unchanged when its rows name no event or date. */
export function whenWhere(stat: StatAnswer, ask: Ask): StatAnswer {
  if (stat.none) return stat;
  // An answer of one thing (its headline links it: a superlative's match, one award's event) is that row alone, the
  // row the headline links else the first (rows lead with the answer); a count's rows (no link) are every one.
  const all = rowsOf(stat, ask);
  const own = all.filter((r) => r.href && r.href === stat.headline?.href);
  const rows = own.length ? own : stat.headline?.href ? headlineRow(stat).filter((r) => (ask === "when" ? r.date : r.event)) : all;
  // Each event once (a team's two awards at one event are one place, one date).
  const seen = new Set<string>();
  const each = rows.filter((r) => { const k = `${r.event}|${r.date}`; return seen.has(k) ? false : (seen.add(k), true); });
  const said = each.map((r) => (ask === "when" ? r.date : r.event)).filter((x): x is string => !!x);
  if (!said.length) return stat;
  const other = each.map((r) => (ask === "when" ? r.event : r.date)).filter((x): x is string => !!x);
  const tiles: StatBlock = {
    kind: "kpis",
    items: each.slice(0, 6).map((r) => ({ label: (ask === "when" ? r.event : r.date) ?? "", value: (ask === "when" ? r.date : r.event) ?? "—", tone: "accent" as const, ...(r.href ? { href: r.href } : {}) })),
  };
  const was = stat.headline;
  // What the headline drew besides its words stays (an event's type chip, an alliance's team chips, a match to play).
  const { value: _v, label: _l, sub: _s, href: _h, ...drawn } = was ?? ({} as Partial<NonNullable<StatAnswer["headline"]>>);
  // An answer that already leads with what's asked ("which event did <team> score highest in"): as it is.
  const value = listed([...new Set(said)]);
  if (was?.value === value) return stat;
  return {
    ...stat,
    title: `${ask === "when" ? "When" : "Where"}: ${stat.title}`,
    headline: {
      ...drawn,
      value,
      label: [was?.value, was?.label].filter(Boolean).join(" · ") || stat.title,
      ...(other.length ? { sub: listed([...new Set(other)]) } : {}),
      ...(each[0].href ? { href: each[0].href } : was?.href ? { href: was.href } : {}),
    },
    blocks: [tiles, ...stat.blocks],
  };
}
