// The Scout page's sections (src/shared/scoutSections.ts): Event day, Entries, and Pick list & planning, as the
// app's own tabs (ui/tabs: arrow keys, Home and End, one tab stop). Personal has no shared pick list, so it
// shows only the first two. The selected section's content is the panel.
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { SCOUT_SECTIONS, SECTION_LABEL, type ScoutSection } from "../../../shared/scoutSections";

export function ScoutSections({ section, onSection, sections = SCOUT_SECTIONS, children }: {
  section: ScoutSection;
  onSection: (s: ScoutSection) => void;
  /** The sections this space has, in order. */
  sections?: readonly ScoutSection[];
  children?: ReactNode;
}) {
  return (
    <Tabs value={section} onValueChange={(v) => { if (sections.includes(v as ScoutSection)) onSection(v as ScoutSection); }}>
      <TabsList aria-label="Scout sections">
        {sections.map((s) => <TabsTrigger key={s} value={s} className="max-sm:min-h-11">{SECTION_LABEL[s]}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={section} className="mt-5 max-sm:mt-4">{children}</TabsContent>
    </Tabs>
  );
}
