// Which results the lite pack's ratings learned, per recent event. The device's local estimate folds every
// played result the ratings haven't learned into them (the forecaster's eventBook, as on the server), so it
// must know exactly which ones they have: a result scheduled before the pack was built may have arrived
// after it, and a season pack from another release lists different ones.
//
// The server writes it when it builds the lite pack (server/packs/build.ts): for every event of a season
// that ended on or after `since` (a few days before the build), the match keys (`level:series:number`) its
// forecaster had folded into the ratings: ScoutForecaster.storedPlayedKeys, the set its own eventBook uses.
// Such an event missing from `events` had none. Older events aren't covered (finished long before the
// build: nothing left to estimate), and neither is any event in a pack built before this record existed.

export interface LiteLearned {
  /** Events that ended on or after this day (YYYY-MM-DD) are covered. */
  since: string;
  /** Season → event code → learned match keys. */
  events: Record<string, Record<string, string[]>>;
}

/** Days before the build that the record reaches back. */
export const LEARNED_DAYS = 7;

/**
 * The match keys of an event the ratings learned: a set (possibly empty) when the record covers the event,
 * null when it can't say (no record, or the event ended before it reaches back).
 */
export function learnedKeys(learned: LiteLearned | null | undefined, season: number, code: string, end: string | null): Set<string> | null {
  if (!learned) return null;
  const own = learned.events[String(season)]?.[code];
  if (own) return new Set(own);
  // Not listed: covered (and so none learned) only when the event ended inside the window.
  return end && end >= learned.since ? new Set() : null;
}
