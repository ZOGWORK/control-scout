// An address's spelling of an event code → the code as stored (src/shared/eventCode.ts says why codes vary).
import { get } from "./db.js";
import { canonicalEventCode } from "../src/shared/eventCode.js";

/**
 * Event `raw`'s code as stored for `season`, whatever the case it's written in: "usnjcmp" → "USNJCMP",
 * "2019INMEET10" → "2019INMeet10". By key first (codes are nearly always stored in upper case, as addresses are
 * written), then as written (a code SQLite can't fold: Cyrillic), then ignoring case. With no such event, the code in
 * upper case (what every lookup did before), so callers answer their own 404.
 */
export async function storedEventCode(season: number, raw: string): Promise<string> {
  const up = canonicalEventCode(raw);
  if (!Number.isInteger(season)) return up;
  const hit = (await get<{ code: string }>("SELECT code FROM events WHERE season = ? AND code = ?", [season, up]))
    ?? (up !== raw ? await get<{ code: string }>("SELECT code FROM events WHERE season = ? AND code = ?", [season, raw]) : undefined)
    ?? await get<{ code: string }>("SELECT code FROM events WHERE season = ? AND code = ? COLLATE NOCASE LIMIT 1", [season, up]);
  return hit?.code ?? up;
}

/**
 * The newest season holding an event under `raw` (any case), with its code as stored: for an address that leaves
 * the season out (/events/USNJNEM2). Codes come back season after season, so the newest is the one meant. Null:
 * no event has that code.
 */
export async function latestEventSeason(raw: string): Promise<{ season: number; code: string } | null> {
  const up = canonicalEventCode(raw);
  const hit = (await get<{ season: number; code: string }>("SELECT season, code FROM events WHERE code IN (?, ?) ORDER BY season DESC LIMIT 1", [up, raw]))
    ?? await get<{ season: number; code: string }>("SELECT season, code FROM events WHERE code = ? COLLATE NOCASE ORDER BY season DESC LIMIT 1", [up]);
  return hit ? { season: Number(hit.season), code: String(hit.code) } : null;
}
