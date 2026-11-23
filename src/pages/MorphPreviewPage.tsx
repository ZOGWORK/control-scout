// /preview/morph: the card morph (src/lib/cardMorph.ts) on the real cards, for review before it ships. Noindex, linked
// from nowhere. Inside this page the event cards morph into the real event page and Back shrinks it home again; the same
// cards everywhere else still cut, as every link does, until the morph is approved.
import { useEffect, useId, useState } from "react";
import { Switch } from "../components/ui/controls";
import { morphSpeed, setMorphSpeed } from "../lib/cardMorph";
import { PageHeader } from "../components/page";
import { MorphScope } from "../components/CardMorph";
import { LiveCard } from "../components/home/HomeDashboard";
import { EventWeeks } from "../components/EventBrowse";
import { Async } from "../components/states";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason } from "../lib/meta";
import type { EventListItem } from "../shared/api";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const noop = () => {};
/** Slow motion: four times longer, to see each part of the morph (only here). */
const SLOW = 4;

export default function MorphPreviewPage() {
  const season = useCurrentSeason();
  // This week and next: enough rows to try the morph from anywhere in a list.
  const [win] = useState(() => { const now = Date.now(); return { from: iso(new Date(now - 2 * 864e5)), to: iso(new Date(now + 12 * 864e5)) }; });
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from: win.from, to: win.to })}`);
  // Read back from the morph itself, so coming Back from an event (a fresh mount) keeps the speed the reader chose.
  const [slow, setSlow] = useState(() => morphSpeed() > 1);
  useEffect(() => { setMorphSpeed(slow ? SLOW : 1); }, [slow]);
  const slowId = useId();
  return (
    <div data-morph-preview>
      <PageHeader
        title="Card morph"
        description="Tap an event: its card grows into the event page, and its name glides to the page's title. Back shrinks the page into the card again. With reduced motion on, it's the usual instant change."
        phoneDescription="Tap an event to see it grow into its page. Back shrinks it home."
      >
        <label htmlFor={slowId} className="inline-flex items-center gap-2 text-sm text-text-muted">
          <Switch id={slowId} checked={slow} onCheckedChange={setSlow} data-morph-slow />Slow motion ({SLOW}×)
        </label>
      </PageHeader>
      <MorphScope>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section aria-labelledby="morph-home" className="space-y-3">
            <h2 id="morph-home" className="text-sm font-semibold text-text-base">As on Home</h2>
            <LiveCard season={season} />
          </section>
          <section aria-labelledby="morph-list" className="min-w-0 space-y-3">
            <h2 id="morph-list" className="text-sm font-semibold text-text-base">As on the Events list</h2>
            <Async state={state}>
              {(d) => <EventWeeks events={d.events} region={null} type="all" status="all" from={null} to={null} q="" video="all" onClear={noop} />}
            </Async>
          </section>
        </div>
      </MorphScope>
    </div>
  );
}
