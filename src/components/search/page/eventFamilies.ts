// The /search page's events as it lists them (src/pages/SearchPage.tsx), grouped before any card is drawn: an event
// split in divisions is one family a season (its finals and its divisions, keyed by the parent code the server sends:
// SearchHit.parent, events.division_code), any other event its own card. Nothing here knows an event's name: a family
// is any 2+ hits in one season that share a parent, whatever the event, the year or the number of divisions.
import type { SearchHit } from "../../../shared/api";
import { familyKey } from "../../../shared/search";
import { eventName } from "./records";
import { eventFacts } from "./results";

/** One event's family in one season: the event itself (its finals, when listed) and its divisions, in the server's
 *  order. `game`: the season's game, as the server names it; `code`: the parent event's code, `name`: its name (the finals' own, else the divisions' shared part). */
export interface EventFamily { key: string; season: number; game: string | null; code: string; name: string; finals: SearchHit | null; divisions: SearchHit[] }

export type EventGroup = { kind: "family"; family: EventFamily } | { kind: "event"; hits: SearchHit[] };

/** A division's name without its own part ("New Jersey Championship - Parkway Division" → "New Jersey Championship"). */
const familyName = (division: SearchHit) => { const parts = division.title.split(/\s+-\s+/); return parts.length > 1 ? parts.slice(0, -1).join(" - ") : division.title; };

/** The events in groups, each where its first hit stood: a family for 2+ hits of one season that share a parent (at
 *  least one a division), and every other event alone. Every hit is in exactly one group. A flat list of groups, so
 *  a wider grouping (status, then date) can sort them into its own sections whole. */
export function eventGroups(hits: SearchHit[]): EventGroup[] {
  const byKey = new Map<string, SearchHit[]>();
  for (const h of hits) { const k = familyKey(h); const g = byKey.get(k); if (g) g.push(h); else byKey.set(k, [h]); }
  const out: EventGroup[] = [];
  for (const [key, g] of byKey) {
    const divisions = g.filter((h) => h.parent != null);
    if (g.length >= 2 && divisions.length && g[0].season != null) {
      const finals = g.find((h) => h.parent == null) ?? null;
      const code = divisions[0].parent!;
      out.push({ kind: "family", family: { key, season: g[0].season, game: g[0].game ?? null, code, name: finals ? finals.title : familyName(divisions[0]), finals, divisions } });
      continue;
    }
    for (const h of g) out.push({ kind: "event", hits: [h] });
  }
  return out;
}

/** Where a family's own card goes: the Events list on that season, narrowed to the event's code (its divisions'
 *  codes start with it), so the finals and every division are listed together. */
export const familyHref = (f: EventFamily) => `/events?season=${f.season}&q=${encodeURIComponent(f.code)}`;

export type FamilyStatus = "live" | "upcoming" | "finished";

/** A family's status, as one: live while any of it is under way, else upcoming while any of it is to come, else
 *  finished. A division says its own only where it differs. */
export function familyStatus(f: EventFamily, today?: string): FamilyStatus {
  const all = [...f.divisions, ...(f.finals ? [f.finals] : [])].map((h) => eventFacts(h, today).status);
  return all.some((s) => s === "live" || s === "started") ? "live" : all.some((s) => s === "upcoming") ? "upcoming" : "finished";
}

/** The families whose divisions show at first: every live or upcoming one, and the newest finished one (the list is
 *  newest first, so the first finished). The rest open with a tap; none leaves the count. */
export function openFamilies(groups: EventGroup[], today?: string): Set<string> {
  const open = new Set<string>();
  let finished = false;
  for (const g of groups) {
    if (g.kind !== "family") continue;
    const s = familyStatus(g.family, today);
    if (s !== "finished") open.add(g.family.key);
    else if (!finished) { finished = true; open.add(g.family.key); }
  }
  return open;
}

/** The family's members as listed under it: its divisions, then its finals (labelled "Finals"). */
export const familyMembers = (f: EventFamily): { hit: SearchHit; label: string }[] =>
  [...f.divisions.map((hit) => ({ hit, label: eventName(hit.title).title })), ...(f.finals ? [{ hit: f.finals, label: "Finals" }] : [])];
