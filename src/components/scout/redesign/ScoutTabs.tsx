// The Scout page's sections (docs/mockups/scout-redesign.html): Match (scout the one on now), Matches (the
// event's schedule) and Data (entries, pick list, export and the rest). The app's own tabs (ui/tabs, as on the
// event page): arrow keys, Home and End, one tab stop. The value is plain text, so the page keeps it in the URL.
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";

export const SCOUT_TABS = ["match", "matches", "data"] as const;
export type ScoutTab = (typeof SCOUT_TABS)[number];
const LABELS: Record<ScoutTab, string> = { match: "Match", matches: "Matches", data: "Data" };

/** A tab read from the URL (?tab=), or Match when it isn't one. */
export function parseScoutTab(v: string | null | undefined): ScoutTab {
  return SCOUT_TABS.includes(v as ScoutTab) ? (v as ScoutTab) : "match";
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
