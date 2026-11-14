// The events list as a season pack's boards hold it (server/packs/boards.ts): the Events page's list
// (/api/events?season=S) and the Scout event chooser's every-event list, asked with this limit.

/** Enough for any season's every event (the list's own default is 2,000). */
export const EVENT_CHOOSER_LIMIT = 3000;
