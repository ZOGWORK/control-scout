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
