// The match records page (/matches) and search ("highest score this season") give one record number for a season:
// the best alliance score at an official event, penalties left out (server/api/searchHighScores.ts seasonRecordLine).
// The table below it lists every played match by its score with penalties, scrimmages and off-season events too, and
// says so, so its first row is never read as a second, different record.
import { UNOFFICIAL_NOTE } from "./searchStat";

export const SEASON_RECORD_LABEL = "Season record";
export const SEASON_RECORD_RULE = "Official events only, penalties left out, as search answers it.";
export const MATCHES_TABLE_HEADING = "every played match by score, penalties in, all events";
export const seasonRecordPath = (season: number) => `/api/records/${season}/high-score`;

/** What search says beside the record's line that changes how to read its number: "Not an official record: …", or
 *  "Penalties not posted" (the score then includes them, as the only one on record). Joined, or null when none. */
export const recordMarks = (line: { results?: string[] }) =>
  (line.results ?? []).filter((r) => r.startsWith(UNOFFICIAL_NOTE) || r === PENALTIES_NOT_POSTED).join("; ") || null;
/** Search's words for a record whose penalties FIRST never posted (server/api/searchHighScores.ts). */
export const PENALTIES_NOT_POSTED = "Penalties not posted";
/** The table under the record, said beside it on the page too. */
export const MATCHES_TABLE_NOTE = "The table lists every played match by score, penalties in, all events.";

/** A highlights headline's reason, said with its rule where a reader could take it for the score with penalties: the
 *  best score is picked without them ("Best score without penalties: Q6"), while an event's own high score includes them.
 *  `np`: that match's score without penalties; null when FIRST never posted them, so its score may include them and
 *  is said as such ("Best score, penalties not posted"). */
export const withoutPenalties = (note: string, np: number | null | undefined) =>
  note !== "Best score" ? note : np == null ? `Best score, ${PENALTIES_NOT_POSTED.toLowerCase()}` : "Best score without penalties";
