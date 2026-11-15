// The event's results came from its own results site, not FIRST (server/data/criResults.ts): said plainly above the
// matches, with a link to the event's page there.
import { ExternalLink } from "lucide-react";
import type { EventDetail } from "../shared/api";

export function ResultsSource({ d }: { d: Pick<EventDetail, "event" | "resultsSource"> }) {
  if (d.event.source !== "cri") return null;
  const s = d.resultsSource;
  return (
    <p className="mt-3 text-sm text-muted-foreground" data-results-source>
      Results from{" "}
      {s ? (
        <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline pointer-coarse:min-h-[44px]">
          {s.site} <ExternalLink className="size-3" />
        </a>
      ) : <span className="font-medium text-foreground">the event's own results site</span>}
      {" "}· FIRST has not published them.
    </p>
  );
}
