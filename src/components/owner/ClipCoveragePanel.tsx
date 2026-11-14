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
import { useState } from "react";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { labelRanges, missingGroups } from "../../shared/coverage";
import type { OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { cn } from "../cn";

const PATH = "/api/owner/clip-coverage";
const listPath = (reviewed: boolean) => `${PATH}?list=${reviewed ? "reviewed" : "open"}`;

/** Mark one reviewed: the list it showed (its version) must still be the event's, or the server says it changed. */
async function reviewed(e: OwnerCoverageEvent, done: () => void) {
  try {
    const r = await apiFetch<OwnerClipCoverage>(`${PATH}/${e.season}/${encodeURIComponent(e.code)}/reviewed`, { method: "POST", json: { version: e.version } });
    prime(`${PATH}/counts`, { open: r.open });
    toast.success(`${e.code} marked reviewed`);
  } catch (err) { toast.error((err as ApiError).message); }
  markStale(PATH);
  done();
}

export function ClipCoveragePanel() {
  const state = useApi<OwnerClipCoverage>(listPath(false));
  // Bumped after Reviewed: both lists start again from their first page.
  const [round, setRound] = useState(0);
  return (
    <Async state={state}>
      {(d) => (
        <div className="grid gap-8">
          <p className="text-sm text-muted-foreground" data-coverage-totals>
            {d.totals.events.toLocaleString()} recorded events checked · {d.totals.full.toLocaleString()} fully clipped · {d.totals.withClip.toLocaleString()} of {d.totals.played.toLocaleString()} played matches have a clip
          </p>
          <Section title={`To review (${d.open})`} description="Recorded events with played matches that have no clip, newest check first. Checked again after every recording is added or refreshed.">
            {d.open ? <Pages key={`open-${round}`} first={d} reviewed={false} onDone={() => setRound((n) => n + 1)} />
              : <EmptyState icon={Film} title="Nothing to review" description="Every played match of every recorded event has a clip, or its gap was reviewed." />}
          </Section>
          <Section title={`Reviewed (${d.reviewed})`} collapsible summary="Seen already: back under To review if the missing list changes.">
            {d.reviewed ? <ReviewedList key={`reviewed-${round}`} /> : <p className="text-sm text-muted-foreground">None.</p>}
          </Section>
        </div>
      )}
    </Async>
  );
}

function ReviewedList() {
  const state = useApi<OwnerClipCoverage>(listPath(true));
  return <Async state={state}>{(d) => <Pages first={d} reviewed onDone={() => {}} />}</Async>;
}

/** A list's first page, then "Show more" for the next ones (50 at a time), so no event is out of reach. */
function Pages({ first, reviewed: isReviewed, onDone }: { first: OwnerClipCoverage; reviewed: boolean; onDone: () => void }) {
  const [more, setMore] = useState<OwnerCoverageEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = [...first.events, ...more];
  const total = isReviewed ? first.reviewed : first.open;
  const next = async () => {
    setBusy(true);
    try { const r = await apiFetch<OwnerClipCoverage>(`${listPath(isReviewed)}&offset=${shown.length}`); setMore((m) => [...m, ...r.events]); }
    catch (err) { toast.error((err as ApiError).message); }
    setBusy(false);
  };
  return (
    <>
      <ul className="grid gap-3">{shown.map((e) => <EventGaps key={`${e.season}/${e.code}`} e={e} onDone={onDone} />)}</ul>
      {shown.length < total && (
        <Button variant="outline" className="mt-3 w-full" onClick={next} disabled={busy} data-coverage-more>Show more ({(total - shown.length).toLocaleString()} left)</Button>
      )}
    </>
  );
}

function EventGaps({ e, onDone }: { e: OwnerCoverageEvent; onDone: () => void }) {
  const groups = missingGroups(e.missing);
  return (
    <li className="rounded-xl border border-line p-3 text-sm" data-coverage-event={`${e.season}/${e.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/events/${e.season}/${encodeURIComponent(e.code)}`} className="font-medium hover:underline">{e.name}</Link>
          <div className="text-xs text-muted-foreground">{e.season} {e.code} · <span className="tabular-nums">{e.withClip} of {e.played}</span> clipped · checked {ago(e.checkedAt)}{e.reviewedAt ? ` · reviewed by ${e.reviewedBy}` : ""}</div>
        </div>
        {!e.reviewedAt && <Button size="sm" variant="outline" onClick={() => reviewed(e, onDone)}><Check /> Reviewed</Button>}
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
