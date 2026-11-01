// The Scout page's sections (docs/mockups/scout-redesign.html): Scout (the match on now, with the event's whole
// match list one tap away) and Data (entries, pick list, export and the rest). There used to be a third, Matches,
// which was only that list; it is part of Scout now, and an old ?tab=matches link opens Scout with the list
// showing (scoutListFromUrl). The app's own tabs (ui/tabs, as on the event page): arrow keys, Home and End, one
// tab stop. The value is plain text, so the page keeps it in the URL ("match" stays the Scout tab's value, so
// links already shared keep working).
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";

export const SCOUT_TABS = ["match", "data"] as const;
export type ScoutTab = (typeof SCOUT_TABS)[number];
const LABELS: Record<ScoutTab, string> = { match: "Scout", data: "Data" };

/** A tab read from the URL (?tab=), or Scout when it isn't one (the old "matches" included). */
export function parseScoutTab(v: string | null | undefined): ScoutTab {
  return SCOUT_TABS.includes(v as ScoutTab) ? (v as ScoutTab) : "match";
}

/** Whether the URL asks for the event's match list in place of the match: ?list=1, or an old ?tab=matches link. */
export function scoutListFromUrl(sp: { get(k: string): string | null }): boolean {
  return sp.get("list") === "1" || sp.get("tab") === "matches";
}

/** The tabs, with the selected section's content (`children`) as their panel. */
export function ScoutTabs({ tab, onTab, children }: { tab: ScoutTab; onTab: (t: ScoutTab) => void; children?: ReactNode }) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(parseScoutTab(v))}>
      <TabsList aria-label="Scout sections">
        {SCOUT_TABS.map((t) => <TabsTrigger key={t} value={t} className="max-sm:min-h-11">{LABELS[t]}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={tab} className="mt-5 max-sm:mt-4">{children}</TabsContent>
    </Tabs>
  );
}
