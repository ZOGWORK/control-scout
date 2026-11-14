// Owner console › Clip coverage (server/videos/coverageCheck.ts): every recorded event with a played match missing a
// clip, checked again whenever its recording or results change. Each shows its days and parts with the video checked
// for each, a day with no recording, and the matches without a clip grouped by why. Mark one reviewed once seen: it
// moves to Reviewed and comes back on its own if its missing list changes. Nothing here changes a clip.
import { Link } from "react-router-dom";
import { Check, CircleSlash, ExternalLink, Film, TriangleAlert } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { labelRanges, missingGroups } from "../../shared/coverage";
import type { OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { cn } from "../cn";

const PATH = "/api/owner/clip-coverage";

async function reviewed(e: OwnerCoverageEvent) {
  try {
    const r = await apiFetch<OwnerClipCoverage>(`${PATH}/${e.season}/${encodeURIComponent(e.code)}/reviewed`, { method: "POST" });
    prime(PATH, r);
    prime(`${PATH}/counts`, { open: r.open.length });
    toast.success(`${e.code} marked reviewed`);
  } catch (err) { toast.error((err as ApiError).message); }
}

export function ClipCoveragePanel() {
  const state = useApi<OwnerClipCoverage>(PATH);
  return (
    <Async state={state}>
      {(d) => (
        <div className="grid gap-8">
          <p className="text-sm text-muted-foreground" data-coverage-totals>
            {d.totals.events.toLocaleString()} recorded events checked · {d.totals.full.toLocaleString()} fully clipped · {d.totals.withClip.toLocaleString()} of {d.totals.played.toLocaleString()} played matches have a clip
          </p>
          <Section title={`To review (${d.open.length})`} description="Recorded events with played matches that have no clip, newest check first. Checked again after every recording is added or refreshed.">
            {d.open.length ? <ul className="grid gap-3">{d.open.map((e) => <EventGaps key={`${e.season}/${e.code}`} e={e} />)}</ul>
              : <EmptyState icon={Film} title="Nothing to review" description="Every played match of every recorded event has a clip, or its gap was reviewed." />}
          </Section>
          <Section title={`Reviewed (${d.reviewed.length})`} collapsible summary="Seen already: back under To review if the missing list changes."
            description="Seen already: back under To review if the missing list changes.">
            {d.reviewed.length ? <ul className="grid gap-3">{d.reviewed.map((e) => <EventGaps key={`${e.season}/${e.code}`} e={e} />)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}
          </Section>
        </div>
      )}
    </Async>
  );
}

function EventGaps({ e }: { e: OwnerCoverageEvent }) {
  const groups = missingGroups(e.missing);
  return (
    <li className="rounded-xl border border-line p-3 text-sm" data-coverage-event={`${e.season}/${e.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/events/${e.season}/${encodeURIComponent(e.code)}`} className="font-medium hover:underline">{e.name}</Link>
          <div className="text-xs text-muted-foreground">{e.season} {e.code} · <span className="tabular-nums">{e.withClip} of {e.played}</span> clipped · checked {ago(e.checkedAt)}{e.reviewedAt ? ` · reviewed by ${e.reviewedBy}` : ""}</div>
        </div>
        {!e.reviewedAt && <Button size="sm" variant="outline" onClick={() => reviewed(e)}><Check /> Reviewed</Button>}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {e.videos.map((v) => {
          const full = v.matches > 0 && v.clipped >= v.matches;
          return (
            <li key={v.videoId}>
              <a href={watchUrl(v.videoId)} target="_blank" rel="noreferrer noopener" title={v.why ?? v.basis}
                className={cn("inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs hover:underline", full ? "border-line" : "border-warning/50 bg-warning/[0.07]")}>
                {full ? <Check className="size-3.5 text-success" aria-hidden /> : <TriangleAlert className="size-3.5 text-warning" aria-hidden />}
                {v.label} <span className="tabular-nums">{v.clipped}/{v.matches}</span> <code className="text-[11px] text-muted-foreground">{v.videoId}</code><ExternalLink className="size-3" aria-hidden />
              </a>
            </li>
          );
        })}
        {e.daysMissing.map((x) => (
          <li key={x.date} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-xs text-muted-foreground"><CircleSlash className="size-3.5" aria-hidden />{x.label} not recorded</li>
        ))}
      </ul>
      <ul className="mt-2 space-y-1 text-xs">
        {groups.map((g) => (
          <li key={`${g.videoId}|${g.why}`}><span className="font-medium tabular-nums">{labelRanges(g.labels)}</span> <span className="text-muted-foreground">· {g.why}{g.videoId ? <> · <code>{g.videoId}</code></> : null}</span></li>
        ))}
      </ul>
    </li>
  );
}
