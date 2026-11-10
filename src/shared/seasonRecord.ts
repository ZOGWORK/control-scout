// The match records page (/matches) and search ("highest score this season") give one record number for a season:
// the best alliance score at an official event, penalties left out (server/api/searchHighScores.ts seasonRecordLine).
// The table below it lists every played match by its score with penalties, scrimmages and off-season events too, and
// says so, so its first row is never read as a second, different record.
export const SEASON_RECORD_LABEL = "Season record";
export const SEASON_RECORD_RULE = "Official events only, penalties left out, as search answers it.";
export const MATCHES_TABLE_HEADING = "every played match by score, penalties in, all events";
export const seasonRecordPath = (season: number) => `/api/records/${season}/high-score`;

/** A highlights headline's reason, said with its rule where a reader could take it for the score with penalties: the
 *  best score is picked without them ("Best score without penalties: Q6"), while an event's own high score includes them. */
export const withoutPenalties = (note: string) => (note === "Best score" ? "Best score without penalties" : note);
