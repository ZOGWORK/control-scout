// Owner console › Clip coverage (server/videos/coverageCheck.ts): every recorded event with a played match missing a
// clip, checked again whenever its recording or results change, and triaged by the server (coverageTriage.ts): only
// Actionable events are "To review", the default view; No timing, Early start / unsafe and Old season are one tap away,
// each row with its category and why. Each shows its days and parts with the video checked for each, a day with no
// recording, and the matches without a clip grouped by why. Mark one reviewed, or a whole category or season at once
// (confirmed with its count, audited): a reviewed event comes back only when its missing list changes to an actionable
// one. Nothing here changes a clip.
import { Link } from "react-router-dom";
import { Check, CircleSlash, ExternalLink, Film, TriangleAlert } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { useState } from "react";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { ago, seasonLabel } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { labelRanges, missingGroups, TRIAGE_ABOUT, TRIAGE_LABEL, TRIAGE_ORDER } from "../../shared/coverage";
import type { CoverageTriage, OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { chipTone } from "../contributors/RecordingGaps";
import { cn } from "../cn";

const PATH = "/api/owner/clip-coverage";
type List = CoverageTriage | "reviewed";
const listPath = (list: List) => `${PATH}?list=${list}`;
const n = (x: number) => x.toLocaleString();
const events = (x: number) => `${n(x)} ${x === 1 ? "event" : "events"}`;

/** After a change: every list and the menu's count are asked again. */
function changed(r: OwnerClipCoverage) {
  prime(`${PATH}/counts`, { open: r.open });
  markStale(PATH);
}

/** Mark one reviewed: the list it showed (its version) must still be the event's, or the server says it changed. */
async function reviewed(e: OwnerCoverageEvent, done: () => void) {
  try {
    const r = await apiFetch<OwnerClipCoverage>(`${PATH}/${e.season}/${encodeURIComponent(e.code)}/reviewed`, { method: "POST", json: { version: e.version } });
    changed(r);
    toast.success(`${e.code} marked reviewed`);
  } catch (err) { toast.error((err as ApiError).message); markStale(PATH); }
  done();
}

/** A bulk Reviewed waiting for the owner's yes: what it marks, and how many the owner was shown. */
interface Bulk { category?: CoverageTriage | "non-actionable"; season?: number; count: number; what: string }

export function ClipCoveragePanel() {
  const [list, setList] = useState<List>("actionable");
  const state = useApi<OwnerClipCoverage>(listPath(list));
  // Bumped after a change: the list starts again from its first page.
  const [round, setRound] = useState(0);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  // A season's Actionable events are marked with it only when the owner ticks this.
  const [withActionable, setWithActionable] = useState(false);
  const done = () => setRound((x) => x + 1);
  return (
    <Async state={state}>
      {(d) => {
        const other = d.categories["no-timing"] + d.categories["early-start"] + d.categories["old-season"];
        const seasonOpen = d.seasons.find((s) => s.season === season) ?? d.seasons[0];
        const shown = list === "reviewed" ? d.reviewed : d.categories[list];
        const seasonCount = seasonOpen ? (withActionable ? seasonOpen.open : seasonOpen.open - seasonOpen.actionable) : 0;
        return (
          <div className="grid gap-6">
            <p className="text-sm text-muted-foreground" data-coverage-totals>
              {n(d.totals.events)} recorded events checked · {n(d.totals.full)} fully clipped · {n(d.totals.withClip)} of {n(d.totals.played)} played matches have a clip
            </p>
            <div className="grid gap-3" data-coverage-triage>
              <p className="text-sm">
                <span className="font-medium">To review: {events(d.open)}</span>
                <span className="text-muted-foreground"> (Actionable only). Not to review: {TRIAGE_ORDER.slice(1).map((k) => `${TRIAGE_LABEL[k]} ${n(d.categories[k])}`).join(" · ")} · Reviewed {n(d.reviewed)}.</span>
              </p>
              {other > 0 && (
                <div>
                  <Button size="sm" className="h-auto min-h-9 whitespace-normal py-1.5 text-left" onClick={() => setBulk({ category: "non-actionable", count: other, what: "every event that isn't Actionable (No timing, Early start / unsafe, Old season)" })} data-coverage-bulk="non-actionable">
                    <Check /> Mark all non-actionable as reviewed ({n(other)})
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
                {[...TRIAGE_ORDER, "reviewed" as const].map((k) => (
                  <button key={k} type="button" aria-pressed={list === k} onClick={() => { setList(k); done(); }} data-coverage-list={k}
                    className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors pointer-coarse:min-h-11",
                      list === k ? "border-accent/70 bg-accent/[0.08] text-text-base" : "border-line text-text-muted hover:text-text-base")}>
                    {k === "reviewed" ? "Reviewed" : TRIAGE_LABEL[k]} <span className="tabular-nums">{n(k === "reviewed" ? d.reviewed : d.categories[k])}</span>
                  </button>
                ))}
              </div>
            </div>
            <Section
              title={list === "actionable" ? `To review (${n(d.open)})` : list === "reviewed" ? `Reviewed (${n(d.reviewed)})` : `${TRIAGE_LABEL[list]} (${n(shown)})`}
              description={list === "reviewed" ? "Seen already: back under To review only if the missing list changes to an actionable one." : `${TRIAGE_ABOUT[list]} Newest season first; checked again after every recording is added or refreshed.`}
              action={list !== "reviewed" && list !== "actionable" && shown > 0
                ? <Button size="sm" variant="outline" onClick={() => setBulk({ category: list, count: shown, what: `every ${TRIAGE_LABEL[list]} event` })} data-coverage-bulk={list}><Check /> Mark all {n(shown)} reviewed</Button>
                : undefined}
              stackAction
            >
              {shown ? <Pages key={`${list}-${round}`} first={d} total={shown} list={list} onDone={done} />
                : list === "actionable"
                  ? <EmptyState icon={Film} title="0 to review" description="Nothing actionable: every gap left is No timing, Early start / unsafe or Old season, or was reviewed." />
                  : <p className="text-sm text-muted-foreground">None.</p>}
            </Section>
            {d.seasons.length > 0 && seasonOpen && (
              <Section title="By season" description="Mark one season's events not reviewed yet: the non-actionable ones, and its Actionable ones too only when ticked." collapsible summary="Mark a whole season reviewed.">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm" htmlFor="coverage-season">Season</label>
                  <select id="coverage-season" className="min-h-9 rounded-lg border border-line bg-card px-2 text-sm text-text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11"
                    value={seasonOpen.season} onChange={(e) => setSeason(Number(e.target.value))} data-coverage-season>
                    {d.seasons.map((s) => <option key={s.season} value={s.season}>{seasonLabel(s.season)} ({n(s.open)}, {n(s.actionable)} Actionable)</option>)}
                  </select>
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
                    <input type="checkbox" checked={withActionable} onChange={(e) => setWithActionable(e.target.checked)} className="size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" data-coverage-season-actionable />
                    Include Actionable ({n(seasonOpen.actionable)})
                  </label>
                  <Button size="sm" variant="outline" disabled={!seasonCount} onClick={() => setBulk({
                    category: withActionable ? undefined : "non-actionable", season: seasonOpen.season, count: seasonCount,
                    what: withActionable
                      ? `every ${seasonLabel(seasonOpen.season)} event not reviewed yet, including its ${n(seasonOpen.actionable)} Actionable`
                      : `every ${seasonLabel(seasonOpen.season)} event not reviewed yet that isn't Actionable (${n(seasonOpen.actionable)} Actionable ${seasonOpen.actionable === 1 ? "event stays" : "events stay"} under To review)`,
                  })} data-coverage-bulk="season">
                    <Check /> Mark {seasonLabel(seasonOpen.season)} reviewed ({n(seasonCount)})
                  </Button>
                </div>
              </Section>
            )}
            <BulkConfirm bulk={bulk} onClose={() => setBulk(null)} onDone={done} />
          </div>
        );
      }}
    </Async>
  );
}

/** The yes for a bulk Reviewed: it says how many it marks; the server marks them only if that's still the count. */
function BulkConfirm({ bulk, onClose, onDone }: { bulk: Bulk | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!bulk) return;
    setBusy(true);
    try {
      const r = await apiFetch<OwnerClipCoverage & { marked: number }>(`${PATH}/bulk-reviewed`, { method: "POST", json: { category: bulk.category, season: bulk.season, expected: bulk.count } });
      changed(r);
      toast.success(`${events(r.marked)} marked reviewed`);
    } catch (err) { toast.error((err as ApiError).message); markStale(PATH); }
    setBusy(false);
    onClose();
    onDone();
  };
  return (
    <Dialog open={!!bulk} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-coverage-confirm>
        <DialogHeader>
          <DialogTitle>Mark {bulk ? events(bulk.count) : ""} reviewed?</DialogTitle>
          <DialogDescription>
            This marks {bulk?.what}. Their missing lists stay, and they're still checked every 5 minutes: an event comes back under To review if its gap changes to an actionable one. No clip or video is touched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={busy} data-coverage-confirm-yes><Check /> Mark {bulk ? events(bulk.count) : ""} reviewed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A list's first page, then "Show more" for the next ones (50 at a time), so no event is out of reach. */
function Pages({ first, total, list, onDone }: { first: OwnerClipCoverage; total: number; list: List; onDone: () => void }) {
  const [more, setMore] = useState<OwnerCoverageEvent[]>([]);
  const [busy, setBusy] = useState(false);
  // An event that moved between lists while paging (reviewed elsewhere) is shown once.
  const shown = [...first.events, ...more].filter((e, i, all) => all.findIndex((x) => x.season === e.season && x.code === e.code) === i);
  const next = async () => {
    setBusy(true);
    const last = shown[shown.length - 1];
    try { const r = await apiFetch<OwnerClipCoverage>(`${listPath(list)}&after=${last.season}/${encodeURIComponent(last.code)}`); setMore((m) => [...m, ...r.events]); }
    catch (err) { toast.error((err as ApiError).message); }
    setBusy(false);
  };
  return (
    <>
      <ul className="grid gap-3">{shown.map((e) => <EventGaps key={`${e.season}/${e.code}`} e={e} onDone={onDone} />)}</ul>
      {shown.length < total && (
        <Button variant="outline" className="mt-3 w-full" onClick={next} disabled={busy} data-coverage-more>Show more ({n(total - shown.length)} left)</Button>
      )}
    </>
  );
}

function EventGaps({ e, onDone }: { e: OwnerCoverageEvent; onDone: () => void }) {
  const groups = missingGroups(e.missing);
  return (
    <li className="rounded-xl border border-line p-3 text-sm" data-coverage-event={`${e.season}/${e.code}`} data-triage={e.triage}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/events/${e.season}/${encodeURIComponent(e.code)}`} className="font-medium hover:underline">{e.name}</Link>
          <div className="text-xs text-muted-foreground">{e.season} {e.code} · <span className="tabular-nums">{e.withClip} of {e.played}</span> clipped · checked {ago(e.checkedAt)}{e.reviewedAt ? ` · reviewed by ${e.reviewedBy}` : ""}</div>
        </div>
        {!e.reviewedAt && <Button size="sm" variant="outline" onClick={() => reviewed(e, onDone)}><Check /> Reviewed</Button>}
      </div>
      <p className="mt-2 text-xs" data-triage-why>
        <span className={cn("mr-1.5 inline-flex items-center rounded-full border px-2 py-0.5 font-medium", e.triage === "actionable" ? "border-warning/50 bg-warning/[0.07]" : "border-line text-muted-foreground")}>{TRIAGE_LABEL[e.triage]}</span>
        {e.triageWhy}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {e.videos.map((v) => {
          const tone = chipTone(v);
          return (
            <li key={v.videoId}>
              <a href={watchUrl(v.videoId)} target="_blank" rel="noreferrer noopener" title={v.why ?? v.basis}
                className={cn("inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs hover:underline", tone === "short" ? "border-warning/50 bg-warning/[0.07]" : "border-line")}>
                {tone === "done" ? <Check className="size-3.5 text-success" aria-hidden /> : tone === "short" ? <TriangleAlert className="size-3.5 text-warning" aria-hidden /> : null}
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
