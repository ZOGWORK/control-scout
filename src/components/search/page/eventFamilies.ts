// The /search page's events as it lists them (src/pages/SearchPage.tsx), grouped before any card is drawn: an event
// split in divisions is one family a season (its finals and its divisions, keyed by the parent code the server sends:
// SearchHit.parent, events.division_code), any other event its own card. Nothing here knows an event's name: a family
// is any 2+ hits in one season that share a parent, whatever the event, the year or the number of divisions.
import type { SearchHit } from "../../../shared/api";
import { familyKey } from "../../../shared/search";
import { eventName } from "./records";

/** One event's family in one season: the event itself (its finals, when listed) and its divisions, in the server's
 *  order. `game`: the season's game, as the server names it; `code`: the parent event's code, `name`: its name (the finals' own, else the divisions' shared part). */
export interface EventFamily { key: string; season: number; game: string | null; code: string; name: string; finals: SearchHit | null; divisions: SearchHit[] }

export type EventGroup = { kind: "family"; family: EventFamily } | { kind: "event"; hits: SearchHit[] };

/** A division's name without its own part ("New Jersey Championship - Parkway Division" → "New Jersey Championship"). */
const familyName = (division: SearchHit) => { const parts = division.title.split(/\s+-\s+/); return parts.length > 1 ? parts.slice(0, -1).join(" - ") : division.title; };

/** The events in groups, each where its first hit stood: a family for 2+ hits of one season that share a parent (at
 *  least one a division), and every other event alone. Events alone that share a name across seasons are one group
 *  (a card with a tab per season); two with one name in the same season stay apart. Every hit is in exactly one group. */
export function eventGroups(hits: SearchHit[]): EventGroup[] {
  const byKey = new Map<string, SearchHit[]>();
  for (const h of hits) { const k = familyKey(h); const g = byKey.get(k); if (g) g.push(h); else byKey.set(k, [h]); }
  const out: EventGroup[] = [];
  const singles: { kind: "event"; hits: SearchHit[] }[] = [];
  for (const [key, g] of byKey) {
    const divisions = g.filter((h) => h.parent != null);
    if (g.length >= 2 && divisions.length && g[0].season != null) {
      const finals = g.find((h) => h.parent == null) ?? null;
      const code = divisions[0].parent!;
      out.push({ kind: "family", family: { key, season: g[0].season, game: g[0].game ?? null, code, name: finals ? finals.title : familyName(divisions[0]), finals, divisions } });
      continue;
    }
    for (const h of g) {
      const same = singles.find((x) => nameKey(x.hits[0]) === nameKey(h) && !x.hits.some((y) => y.season === h.season));
      if (same) same.hits.push(h);
      else { const one = { kind: "event" as const, hits: [h] }; singles.push(one); out.push(one); }
    }
  }
  return out;
}

/** An event's name for grouping alone events: a championship division by its own name ("Edison Division", whatever
 *  the year's championship was called), anything else by its whole name. */
const nameKey = (h: SearchHit) => eventName(h.title).title.trim().toLowerCase();

/** Where a family's own card goes: the Events list on that season, narrowed to the event's code (its divisions'
 *  codes start with it), so the finals and every division are listed together. */
export const familyHref = (f: EventFamily) => `/events?season=${f.season}&q=${encodeURIComponent(f.code)}`;

/** The family's members as listed under it: its divisions, then its finals (labelled "Finals"). */
export const familyMembers = (f: EventFamily): { hit: SearchHit; label: string }[] =>
  [...f.divisions.map((hit) => ({ hit, label: eventName(hit.title).title })), ...(f.finals ? [{ hit: f.finals, label: "Finals" }] : [])];
