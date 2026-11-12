// /events/:season/:code/highlights: an event's standout matches, the same card Search gives for "<event> highlights"
// (server/eventHighlightsPage.ts), at an address of its own. Its first HTML carries the whole answer as text
// (server/seoMeta.ts); the card here draws it with its match videos. Linked from the event page, and it links back.
import { Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { StatAnswerCard } from "../components/search/page/StatAnswer";
import { AnswerVideoProvider } from "../components/search/page/AnswerVideo";
import { isEventCodeParam } from "../shared/eventCode";
import { seasonLabel } from "../shared/format";
import type { SearchVideo } from "../shared/api";
import type { StatAnswer } from "../shared/searchStat";

interface EventHighlights { event: { season: number; code: string; name: string }; stat: StatAnswer; video?: SearchVideo }

const linkClass = "inline-flex h-[44px] items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:border-accent/60";

export default function EventHighlightsPage() {
  const { season = "", code = "" } = useParams();
  const ok = /^\d{4}$/.test(season) && isEventCodeParam(code);
  const eventHref = `/events/${season}/${encodeURIComponent(code.toUpperCase())}`;
  const state = useApi<EventHighlights>(ok ? `/api/events/${season}/${encodeURIComponent(code)}/highlights` : null);
  const name = state.data?.event.name ?? code.toUpperCase();
  useTitle(`${name} highlights${ok ? `, ${seasonLabel(Number(season))}` : ""}`);
  if (!ok) return <EmptyState icon={Sparkles} title="No such event" description="This address doesn't name an FTC event." />;
  // No highlights page for this event (no match with scores yet, or not an event we list): said plainly, with the way
  // to its page, never a broken-looking error.
  const err = state.error as ApiError | undefined;
  if (err?.status === 404 && !err.offline) {
    return <EmptyState icon={Sparkles} title="No highlights yet" description="Highlights show here once this event has played a match with scores."
      action={<Link to={eventHref} className={linkClass}>Event page</Link>} />;
  }
  return (
    <div className="space-y-5">
      <Async state={state}>
        {(d) => (
          <>
            <PageHeader title={`${d.event.name} highlights`}
              description="Its standout matches: best score, biggest margin, latest playoff match, best Auto, closest finish and biggest upset, each with its video when there is one."
              phoneDescription="Its standout matches."
              actions={<Link to={`/events/${d.event.season}/${encodeURIComponent(d.event.code)}`} className={linkClass} data-event-link>Event page</Link>} />
            <AnswerVideoProvider video={d.video}>
              <StatAnswerCard stat={d.stat} />
            </AnswerVideoProvider>
          </>
        )}
      </Async>
    </div>
  );
}
