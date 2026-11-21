// The Scout page's sections (src/shared/scoutSections.ts): Event day, Entries, and Pick list & planning, as the
// app's own tabs (ui/tabs: arrow keys, Home and End, one tab stop). Personal has no shared pick list, so it
// shows only the first two. The selected section's content is the panel.
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { SCOUT_SECTIONS, SECTION_LABEL, SECTION_SHORT, type ScoutSection } from "../../../shared/scoutSections";

// On a touch screen the trigger's tap-44 ::after (centred: top 50% and a transform) lands on v8's underline, which is
// the same ::after, and draws it through the label. The tab is already 44px tall there, so the underline wins.
const UNDERLINE_ON_TOUCH = "max-sm:min-h-11 v8:after:top-auto v8:after:bottom-0 v8:after:left-3 v8:after:w-auto v8:after:h-0.5 v8:after:transform-none";

export function ScoutSections({ section, onSection, sections = SCOUT_SECTIONS, folded = false, children }: {
  section: ScoutSection;
  onSection: (s: ScoutSection) => void;
  /** The sections this space has, in order. */
  sections?: readonly ScoutSection[];
  /** v8, a match being scouted on a phone: the tab row folds away so the match starts high (its back link returns). */
  folded?: boolean;
  children?: ReactNode;
}) {
  return (
    <Tabs value={section} onValueChange={(v) => { if (sections.includes(v as ScoutSection)) onSection(v as ScoutSection); }}>
      <TabsList aria-label="Scout sections" className={folded ? "v8:max-md:hidden" : undefined}>
        {/* On a phone a long name goes short ("Picks"), so the row fits at 320 px; its name stays the full one. */}
        {sections.map((s) => (
          <TabsTrigger key={s} value={s} className={UNDERLINE_ON_TOUCH} aria-label={SECTION_SHORT[s] ? SECTION_LABEL[s] : undefined}>
            {SECTION_SHORT[s] ? <><span className="sm:hidden">{SECTION_SHORT[s]}</span><span className="max-sm:hidden">{SECTION_LABEL[s]}</span></> : SECTION_LABEL[s]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={section} className={folded ? "mt-5 max-sm:mt-4 v8:max-md:mt-0" : "mt-5 max-sm:mt-4"}>{children}</TabsContent>
    </Tabs>
  );
}
