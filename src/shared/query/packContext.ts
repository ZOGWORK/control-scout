// Search's parser (./parse.ts) reading with what the downloaded event packs know (src/lib/offline/search.ts, with no
// signal): their teams by number and name, with where each is from, and their events by name and code. The index is
// built by the same function as the server's (./names.ts buildNames), from the pack's rows instead of the database's,
// so a query reads the same way as online for anything the packs hold.
import type { EventBundle } from "../eventBundle";
import type { ParseContext } from "./parse";
import { buildNames, fold, type NameRow } from "./names";
import type { SeasonRow } from "../searchVersus";

export type ParsePack = Pick<EventBundle, "search" | "event">;

/** A team's strength as the server reads it (server/api/query/names.ts): the best world OPR percentile,
 *  1 - rank_np / ranked_teams, in its two latest ranked seasons; null with none. */
export function strengthOf(rows: Pick<SeasonRow, "season" | "rank_np" | "ranked_teams">[]): number | null {
  const ranked = rows.filter((r) => r.rank_np != null && (r.ranked_teams ?? 0) > 0).sort((a, b) => Number(b.season) - Number(a.season)).slice(0, 2);
  return ranked.length ? Math.max(...ranked.map((r) => 1.0 - Number(r.rank_np) / Number(r.ranked_teams))) : null;
}

/** The parser's context for these packs on `today` (YYYY-MM-DD, UTC). */
export function packParseContext(packs: ParsePack[], today: string): ParseContext {
  const rows: NameRow[] = [];
  const seen = new Set<number>();
  for (const p of packs) {
    for (const part of Object.values(p.search?.teams ?? {})) {
      if (seen.has(part.facts.number)) continue;
      seen.add(part.facts.number);
      rows.push({ ...part.facts, lastPlayed: part.rows.length ? Math.max(...part.rows.map((r) => Number(r.season))) : null, strength: strengthOf(part.rows) });
    }
  }
  const places = packs.map((p) => ({ city: p.event.event.city ?? null, state: p.event.event.state ?? null, country: p.event.event.country ?? null, name: p.event.event.name, code: p.event.event.code }));
  const names = buildNames(rows, places);
  const events = new Set(packs.flatMap((p) => [fold(p.event.event.name), fold(p.event.event.code)]));
  return { names, today, isEvent: async (words) => events.has(fold(words)), nearTeam: async (words) => names.nearTeam(words) };
}
