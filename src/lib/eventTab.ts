// Which event page tab ?tab= opens. An unknown tab (a typo, an old link) or Odds on a history season
// isn't a tab this event has: the page opens its normal default instead, and drops the bad ?tab=.
export const EVENT_TABS = ["matches", "rankings", "insights", "teams", "playoffs", "awards", "odds"] as const;
export type EventTab = (typeof EVENT_TABS)[number];

/** `asked`: the ?tab= value (null when absent). `valid` is false when ?tab= is there but can't be shown. */
export function eventTab(asked: string | null, { predictable, fallback }: { predictable: boolean; fallback: EventTab }): { tab: EventTab; valid: boolean } {
  if (asked == null) return { tab: fallback, valid: true };
  const known = (EVENT_TABS as readonly string[]).includes(asked) && (predictable || asked !== "odds");
  return known ? { tab: asked as EventTab, valid: true } : { tab: fallback, valid: false };
}
