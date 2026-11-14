// Search's parser (./parse.ts) reading with what the downloaded event packs know (src/lib/offline/search.ts, with no
// signal): their teams by number and name, with where each is from, and their events by name and code. The index is
// built by the same function as the server's (./names.ts buildNames), from the pack's rows instead of the database's,
// so a query reads the same way as online for anything the packs hold.
import type { EventBundle } from "../eventBundle";
import type { ParseContext } from "./parse";
import { buildNames, fold, type NameRow } from "./names";

export type ParsePack = Pick<EventBundle, "search" | "event">;

/** The parser's context for these packs on `today` (YYYY-MM-DD, UTC). */
export function packParseContext(packs: ParsePack[], today: string): ParseContext {
  const rows: NameRow[] = [];
  const seen = new Set<number>();
  for (const p of packs) {
    for (const part of Object.values(p.search?.teams ?? {})) {
      if (seen.has(part.facts.number)) continue;
      seen.add(part.facts.number);
      rows.push({ ...part.facts, lastPlayed: part.rows.length ? Math.max(...part.rows.map((r) => Number(r.season))) : null, strength: null });
    }
  }
  const places = packs.map((p) => ({ city: p.event.event.city ?? null, state: p.event.event.state ?? null, country: p.event.event.country ?? null, name: p.event.event.name, code: p.event.event.code }));
  const names = buildNames(rows, places);
  const events = new Set(packs.flatMap((p) => [fold(p.event.event.name), fold(p.event.event.code)]));
  return { names, today, isEvent: async (words) => events.has(fold(words)), nearTeam: async (words) => names.nearTeam(words) };
}
