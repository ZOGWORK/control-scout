// Owner console › Clip coverage (server/videos/coverageCheck.ts), as a review screen: a progress meter on top (events
// fully clipped, matches clipped), the triage lists (coverageTriage.ts) as coloured count tiles that switch the list,
// and why matches are missing as coloured tiles that filter the chips below. Then one card per event: its video's
// thumbnail, its missing matches as small chips coloured by kind (clipReview.ts), each opening the app's video dialog
// at the second worth seeing, and Reviewed right on the card (optimistic: the card goes at once, and comes back if the
// server says no). Matches the video showed with no clip (findings) are cards of chips too. Only Actionable events are
// "To review"; "Not yet checked against the video" is a pending check, never reviewed. Bulk Reviewed (a category or a
// season, confirmed with its count, audited) and the check pass in numbers are folded under "Bulk review and check
// details". Nothing here changes a clip.
import { Link } from "react-router-dom";
import { Check, ChevronDown, CircleSlash, ExternalLink, Film, Play, X } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { useMemo, useState } from "react";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { optimistic } from "../../lib/optimistic";
import { playInDialog } from "../../lib/streamSeek";
import { ago, seasonLabel } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { thumbnailUrl } from "../../shared/stream";
import { labelRanges, missingGroups, TRIAGE_ABOUT, TRIAGE_LABEL, TRIAGE_ORDER } from "../../shared/coverage";
import type { ClipCheckTotals, CoverageFinding, CoveragePass, CoverageTriage, OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { chipTone } from "../contributors/RecordingGaps";
import { SEARCH_PALETTE } from "../../lib/textTones";
import { hms, KIND, kindOf, kindTotals, MISS_KINDS, secondOf, type MissKind } from "./clipReview";
import { cn } from "../cn";

const PATH = "/api/owner/clip-coverage";
type List = CoverageTriage | "reviewed";
const listPath = (list: List) => `${PATH}?list=${list}`;
const n = (x: number) => x.toLocaleString();
const events = (x: number) => `${n(x)} ${x === 1 ? "event" : "events"}`;
const pc = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const P = SEARCH_PALETTE;
const eventKey = (e: { season: number; code: string }) => `${e.season}/${e.code}`;
/** A touch-sized target on phones (h-11 is too tall for the owner's 14px phone base: h-[44px]). */
const TOUCH = "pointer-coarse:min-h-[44px]";

/** The list tiles: each triage list (and Reviewed) with its colour and a two-word name. */
const LISTS: { list: List; name: string; swatch: (typeof P)[keyof typeof P] }[] = [
  { list: "actionable", name: "To review", swatch: P.winning },
  { list: "unchecked", name: "Not yet checked", swatch: P.upcoming },
  { list: "no-timing", name: "No timing", swatch: P.endgame },
  { list: "early-start", name: "Early start", swatch: P.finalist },
  { list: "unplayable", name: "Can't be played", swatch: P.no },
  { list: "old-season", name: "Old season", swatch: P.no },
  { list: "reviewed", name: "Reviewed", swatch: P.yes },
];

/** After a change: every list and the menu's count are asked again. */
function changed(r: OwnerClipCoverage) {
  prime(`${PATH}/counts`, { open: r.open });
  markStale(PATH);
}

/** A bulk Reviewed waiting for the owner's yes: what it marks, and how many the owner was shown. */
interface Bulk { category?: CoverageTriage | "non-actionable"; season?: number; count: number; what: string }

/** Open a match's video in the app's dialog at its second (a new tab when the dialog isn't mounted). */
function watch(videoId: string, t: number | null, label: string) {
  if (!playInDialog({ videoId, t: t ?? 0, label })) window.open(watchUrl(videoId, t ?? undefined), "_blank", "noopener,noreferrer");
}

export function ClipCoveragePanel() {
  const [list, setList] = useState<List>("actionable");
  const state = useApi<OwnerClipCoverage>(listPath(list));
  // Bumped after a bulk change: the list starts again from its first page.
  const [round, setRound] = useState(0);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  // Chips of one kind only (a reason tile pressed), or every kind.
  const [only, setOnly] = useState<MissKind | null>(null);
  // Events marked reviewed here, by the missing list's version they were marked at: off the open lists before the server
  // answers (back if it says no), and back on them if that list changes (a new version, opened again). Never off Reviewed.
  const [gone, setGone] = useState<ReadonlyMap<string, string>>(new Map());
  const done = () => setRound((x) => x + 1);
  const review = (e: OwnerCoverageEvent) => {
    const k = eventKey(e);
    void optimistic<OwnerClipCoverage>({
      key: `clip-coverage/${k}`,
      what: `${e.code} marked reviewed`,
      apply: () => { setGone((s) => new Map(s).set(k, e.version)); return () => setGone((s) => { const x = new Map(s); x.delete(k); return x; }); },
      send: () => apiFetch<OwnerClipCoverage>(`${PATH}/${e.season}/${encodeURIComponent(e.code)}/reviewed`, { method: "POST", json: { version: e.version } }),
      reconcile: changed,
    }).then((r) => { if (r.ok) toast.success(`${e.code} marked reviewed`); else markStale(PATH); });
  };
  return (
    <Async state={state}>
      {(d) => {
        const shown = list === "reviewed" ? d.reviewed : d.categories[list];
        return (
          <div className="grid gap-5">
            <Progress d={d} />
            <ListTiles d={d} list={list} onList={(k) => { setList(k); setOnly(null); done(); }} />
            <ReasonTiles p={d.lastPass} only={only} onOnly={setOnly} />
            <Findings findings={d.findings} only={only} />
            <Section
              title={list === "actionable" ? `To review (${n(d.open)})` : list === "reviewed" ? `Reviewed (${n(d.reviewed)})` : `${TRIAGE_LABEL[list]} (${n(shown)})`}
              description={list === "reviewed" ? "Seen already: back under To review only if the missing list changes to an actionable one." : TRIAGE_ABOUT[list]}
              action={list !== "reviewed" && list !== "actionable" && list !== "unchecked" && shown > 0
                ? <Button size="sm" variant="outline" className={TOUCH} onClick={() => setBulk({ category: list, count: shown, what: `every ${TRIAGE_LABEL[list]} event` })} data-coverage-bulk={list}><Check /> Mark all {n(shown)} reviewed</Button>
                : undefined}
              stackAction
            >
              {shown ? <Pages key={`${list}-${round}`} first={d} total={shown} list={list} gone={gone} only={only} findings={d.findings} onReview={review} />
                : list === "actionable"
                  ? <EmptyState icon={Film} title="0 to review" description="Every match checked against the video has its clip or its reason. Matches not yet checked wait under Not yet checked." />
                  : <p className="text-sm text-muted-foreground">None.</p>}
            </Section>
            <More d={d} onBulk={setBulk} />
            <BulkConfirm bulk={bulk} onClose={() => setBulk(null)} onDone={done} />
          </div>
        );
      }}
    </Async>
  );
}

/** One big meter: a share as a percentage, a thick bar, and its two numbers. */
function Meter({ label, have, of, bar, testid }: { label: string; have: number; of: number; bar: string; testid: string }) {
  const p = pc(have, of);
  return (
    <div className="rounded-xl border border-line bg-card p-3 sm:p-4" data-coverage-meter={testid}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-semibold tabular-nums sm:text-4xl">{p}%</span>
        <span className="text-right text-sm tabular-nums text-muted-foreground"><span className="font-medium text-text-base">{n(have)}</span> of {n(of)}</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={of} aria-valuenow={have} aria-label={label}>
        <div className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", bar)} style={{ width: `${p}%` }} />
      </div>
      <div className="mt-1.5 text-sm font-medium">{label}</div>
    </div>
  );
}

function Progress({ d }: { d: OwnerClipCoverage }) {
  const p = d.lastPass;
  const moved = p?.pending != null && p.pendingBefore != null ? p.pendingBefore - p.pending : null;
  return (
    <div className="grid gap-2" data-coverage-totals>
      <div className="grid gap-3 sm:grid-cols-2">
        <Meter testid="events" label="Events fully clipped" have={d.totals.full} of={d.totals.events} bar={P.yes.bar} />
        <Meter testid="matches" label="Matches with a clip" have={d.totals.withClip} of={d.totals.played} bar={P.auto.bar} />
      </div>
      <p className="text-xs text-muted-foreground" data-coverage-pending>
        {p ? <>Checked {ago(p.at)}</> : "No check pass yet: the next one runs within 5 minutes"}
        {p?.pending != null && <> · <span className="tabular-nums font-medium text-text-base">{n(p.pending)}</span> waiting for their video check
          {moved != null && moved !== 0 && <span className={cn("ml-1 font-medium tabular-nums", moved > 0 ? "text-success" : "text-text-muted")}>{moved > 0 ? `↓ ${n(moved)}` : `↑ ${n(-moved)}`}</span>}</>}
      </p>
    </div>
  );
}

/** The lists as count tiles: pressing one shows it. */
function ListTiles({ d, list, onList }: { d: OwnerClipCoverage; list: List; onList: (k: List) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Show" data-coverage-triage>
      {LISTS.map(({ list: k, name, swatch }) => {
        const count = k === "reviewed" ? d.reviewed : d.categories[k];
        const on = list === k;
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onList(k)} data-coverage-list={k}
            title={k === "reviewed" ? "Seen already" : TRIAGE_ABOUT[k]}
            className={cn("flex min-h-[60px] flex-col items-start justify-center rounded-xl border border-l-4 px-3 py-2 text-left transition-colors", swatch.edge, swatch.tint,
              on ? "border-text-base/40 ring-2 ring-text-base/25" : "border-line hover:border-text-base/30")}>
            <span className={cn("text-2xl font-semibold tabular-nums leading-tight", swatch.text)}>{n(count)}</span>
            <span className="text-xs font-medium text-text-base">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Why matches are missing, over every recorded event (the last pass): a bar in each kind's colour, and a tile per kind
 *  that shows only its chips below. */
function ReasonTiles({ p, only, onOnly }: { p: CoveragePass | null; only: MissKind | null; onOnly: (k: MissKind | null) => void }) {
  const kinds = p ? kindTotals(p.why) : [];
  if (!p || !kinds.length) return null;
  const total = kinds.reduce((s, k) => s + k.n, 0);
  return (
    <div className="grid gap-2" data-coverage-pass>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Why <span className="tabular-nums">{n(p.missing)}</span> matches have no clip{p.unplayable ? <span className="font-normal text-muted-foreground"> · {n(p.unplayable)} more whose recording can't be played</span> : null}</h3>
        {only && <Button size="sm" variant="ghost" className={TOUCH} onClick={() => onOnly(null)} data-coverage-only-clear><X /> Show every kind</Button>}
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
        {kinds.map((k) => <span key={k.kind} className={cn("h-full", KIND[k.kind].swatch.bar, only && only !== k.kind && "opacity-25")} style={{ width: `${(k.n / total) * 100}%` }} />)}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Show only">
        {kinds.map((k) => {
          const K = KIND[k.kind];
          return (
            <button key={k.kind} type="button" aria-pressed={only === k.kind} onClick={() => onOnly(only === k.kind ? null : k.kind)} title={K.about} data-coverage-kind={k.kind}
              className={cn("inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors", TOUCH,
                only === k.kind ? "border-text-base/40 ring-2 ring-text-base/25" : "border-line hover:border-text-base/30", only && only !== k.kind && "opacity-50")}>
              <span className={cn("size-3 shrink-0 rounded-sm", K.swatch.bar)} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{K.name}</span>
              <span className="tabular-nums text-muted-foreground">{n(k.n)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One missing match as a small chip in its kind's colour: pressing it opens the video at its second. */
function MatchChip({ label, kind, videoId, t, title }: { label: string; kind: MissKind; videoId: string | null; t: number | null; title: string }) {
  const K = KIND[kind];
  const tip = `${label} · ${K.name}: ${K.about}${videoId ? (t != null ? `. Opens at ${hms(t)}` : ". Opens at the video's start") : ". No video to open"}`;
  const cls = cn("inline-flex min-h-8 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold tabular-nums", TOUCH, K.swatch.fill);
  if (!videoId) return <span className={cn(cls, "opacity-80")} title={tip} data-chip={label} data-kind={kind}>{label}</span>;
  return (
    <button type="button" className={cn(cls, "transition-transform hover:brightness-110 active:scale-95 motion-reduce:transform-none")} title={tip} aria-label={tip}
      onClick={() => watch(videoId, t, `${title} ${label} · ${K.name}${t != null ? ` · ${hms(t)}` : ""}`)} data-chip={label} data-kind={kind}>
      <Play className="size-3 fill-current" aria-hidden />{label}
    </button>
  );
}

/** Up to 24 chips, then "+N more". */
function Chips({ children }: { children: React.ReactNode[] }) {
  const [all, setAll] = useState(false);
  const cut = all ? children : children.slice(0, 24);
  return (
    <div className="flex flex-wrap gap-1.5" data-chips>
      {cut}
      {children.length > cut.length && (
        <button type="button" onClick={() => setAll(true)} className={cn("inline-flex min-h-8 items-center rounded-md border border-line px-2 text-xs font-medium text-text-muted hover:text-text-base", TOUCH)}>+{n(children.length - cut.length)} more</button>
      )}
    </div>
  );
}

/** The video's picture, or a film icon when the event has none. */
function Thumb({ videoId }: { videoId: string | null }) {
  return (
    <div className="aspect-video w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-muted sm:w-32">
      {videoId ? <img src={thumbnailUrl(videoId)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        : <div className="grid size-full place-items-center text-text-muted"><Film className="size-5" aria-hidden /></div>}
    </div>
  );
}

/** Matches the video showed with no clip, and pulled clips: one card per event, a chip per match. Never reviewed. */
function Findings({ findings, only }: { findings: CoverageFinding[]; only: MissKind | null }) {
  const by = useMemo(() => {
    const m = new Map<string, CoverageFinding[]>();
    for (const f of findings) (m.get(eventKey(f)) ?? m.set(eventKey(f), []).get(eventKey(f))!).push(f);
    return [...m.values()];
  }, [findings]);
  const kind = (f: CoverageFinding): MissKind => (f.kind === "pulled" ? "pulled" : "seen");
  const shown = by.map((fs) => fs.filter((f) => !only || kind(f) === only)).filter((fs) => fs.length);
  if (only && !shown.length) return null;
  return (
    <Section title={`Found in the video (${n(findings.length)})`} description="The video's own frames show these matches, but they have no clip. Press one to see it.">
      {shown.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" data-coverage-findings>
          {shown.map((fs) => {
            const f0 = fs[0];
            return (
              <li key={eventKey(f0)} className="flex gap-3 rounded-xl border border-line bg-card p-2.5" data-coverage-finding-event={eventKey(f0)}>
                <Thumb videoId={f0.videoId} />
                <div className="grid min-w-0 flex-1 content-start gap-1.5">
                  <Link to={`/events/${f0.season}/${encodeURIComponent(f0.code)}`} className="truncate text-sm font-medium hover:underline">{f0.name}</Link>
                  <span className="text-xs text-muted-foreground">{f0.season} · {f0.code}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {fs.map((f) => (
                      <span key={`${f.kind}/${f.label}`} data-coverage-finding={`${eventKey(f)}/${f.label}`} data-finding-kind={f.kind} title={f.why}>
                        <MatchChip label={f.label} kind={kind(f)} videoId={f.videoId} t={f.at} title={`${f.season} ${f.code}`} />
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted-foreground" data-coverage-findings>None: every match the video showed has its clip, and no clip was pulled.</p>}
    </Section>
  );
}

/** A list's first page, then "Show more" for the next ones (50 at a time), so no event is out of reach. */
function Pages({ first, total, list, gone, only, findings, onReview }: {
  first: OwnerClipCoverage; total: number; list: List; gone: ReadonlyMap<string, string>; only: MissKind | null; findings: CoverageFinding[]; onReview: (e: OwnerCoverageEvent) => void;
}) {
  const [more, setMore] = useState<OwnerCoverageEvent[]>([]);
  const [busy, setBusy] = useState(false);
  // An event that moved between lists while paging (reviewed elsewhere) is shown once.
  const all = [...first.events, ...more].filter((e, i, a) => a.findIndex((x) => x.season === e.season && x.code === e.code) === i);
  const byLabel = useMemo(() => new Map(findings.map((f) => [`${eventKey(f)}/${f.label}`, f])), [findings]);
  const shown = list === "reviewed" ? all : all.filter((e) => gone.get(eventKey(e)) !== e.version);
  const next = async () => {
    setBusy(true);
    const last = all[all.length - 1];
    try { const r = await apiFetch<OwnerClipCoverage>(`${listPath(list)}&after=${last.season}/${encodeURIComponent(last.code)}`); setMore((m) => [...m, ...r.events]); }
    catch (err) { toast.error((err as ApiError).message); }
    setBusy(false);
  };
  const visible = only ? shown.filter((e) => hasKind(e, only, byLabel)) : shown;
  return (
    <>
      {visible.length ? <ul className="grid gap-3 lg:grid-cols-2">{visible.map((e) => <EventCard key={eventKey(e)} e={e} only={only} byLabel={byLabel} onReview={onReview} />)}</ul>
        : <p className="text-sm text-muted-foreground">{only ? `No event shown here has a ${KIND[only].name} match.` : "Every event shown here is marked reviewed."}</p>}
      {all.length < total && (
        <Button variant="outline" className={cn("mt-3 w-full", TOUCH)} onClick={next} disabled={busy} data-coverage-more>Show more ({n(total - all.length)} left)</Button>
      )}
    </>
  );
}

const hasKind = (e: OwnerCoverageEvent, k: MissKind, byLabel: Map<string, CoverageFinding>) =>
  e.missing.some((m) => !m.clip && kindOf(m, byLabel.get(`${eventKey(e)}/${m.label}`)?.kind === "pulled") === k);

function EventCard({ e, only, byLabel, onReview }: { e: OwnerCoverageEvent; only: MissKind | null; byLabel: Map<string, CoverageFinding>; onReview: (e: OwnerCoverageEvent) => void }) {
  const [open, setOpen] = useState(false);
  const missing = e.missing.filter((m) => !m.clip).map((m) => {
    const f = byLabel.get(`${eventKey(e)}/${m.label}`);
    return { m, f, kind: kindOf(m, f?.kind === "pulled") };
  });
  const order = (k: MissKind) => MISS_KINDS.findIndex((x) => x.kind === k);
  const kinds = [...new Set(missing.map((x) => x.kind))].sort((a, b) => order(a) - order(b));
  const chips = missing.filter((x) => !only || x.kind === only);
  const video = e.videos[0]?.videoId ?? missing.find((x) => x.m.videoId)?.m.videoId ?? null;
  const title = `${e.season} ${e.code}`;
  const canReview = !e.reviewedAt && e.triage !== "unchecked";
  return (
    <li className="grid content-start gap-2.5 rounded-xl border border-line bg-card p-3 text-sm" data-coverage-event={eventKey(e)} data-triage={e.triage}>
      <div className="flex gap-3">
        <Thumb videoId={video} />
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <Link to={`/events/${e.season}/${encodeURIComponent(e.code)}`} className="line-clamp-2 font-medium hover:underline">{e.name}</Link>
          <span className="text-xs text-muted-foreground">{e.season} · {e.code}</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden><span className={cn("block h-full", P.yes.bar)} style={{ width: `${pc(e.withClip, e.played)}%` }} /></span>
            <span className="tabular-nums text-muted-foreground"><span className="font-medium text-text-base">{e.withClip}</span>/{e.played} clipped</span>
          </div>
        </div>
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Kinds">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1" title={KIND[k].about}>
              <span className={cn("size-2.5 rounded-sm", KIND[k].swatch.bar)} aria-hidden />{KIND[k].name} <span className="tabular-nums">{missing.filter((x) => x.kind === k).length}</span>
            </span>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <Chips>{chips.map(({ m, f, kind }) => <MatchChip key={m.key} label={m.label} kind={kind} videoId={f?.videoId ?? m.videoId} t={secondOf(m, f)} title={title} />)}</Chips>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canReview && <Button size="sm" className={TOUCH} onClick={() => onReview(e)} data-coverage-reviewed><Check /> Reviewed</Button>}
        {e.reviewedAt && <span className="text-xs text-muted-foreground">Reviewed by {e.reviewedBy}</span>}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn("inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-text-muted hover:text-text-base", TOUCH)} data-coverage-details>
          Details <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        <span className="ml-auto text-xs text-muted-foreground">checked {ago(e.checkedAt)}</span>
      </div>
      {open && <Details e={e} />}
    </li>
  );
}

/** A card's long words, opened on request: its category and why, its videos and days, the matches by reason. */
function Details({ e }: { e: OwnerCoverageEvent }) {
  const groups = missingGroups(e.missing);
  return (
    <div className="grid gap-2 border-t border-line pt-2 text-xs">
      <p data-triage-why><span className="mr-1.5 inline-flex items-center rounded-full border border-line px-2 py-0.5 font-medium">{TRIAGE_LABEL[e.triage]}</span><span className="text-muted-foreground">{e.triageWhy}</span></p>
      <ul className="flex flex-wrap gap-1.5">
        {e.videos.map((v) => {
          const tone = chipTone(v);
          return (
            <li key={v.videoId}>
              <a href={watchUrl(v.videoId)} target="_blank" rel="noreferrer noopener" title={v.why ?? v.basis}
                className={cn("inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 hover:underline", TOUCH, tone === "short" ? "border-warning/50 bg-warning/[0.07]" : "border-line")}>
                {tone === "done" && <Check className="size-3.5 text-success" aria-hidden />}
                {v.label} <span className="tabular-nums">{v.clipped}/{v.matches}</span><ExternalLink className="size-3" aria-hidden />
              </a>
            </li>
          );
        })}
        {e.daysMissing.map((x) => (
          <li key={x.date} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-muted-foreground"><CircleSlash className="size-3.5" aria-hidden />{x.label} not recorded</li>
        ))}
      </ul>
      <ul className="space-y-1">
        {groups.map((g) => <li key={`${g.videoId}|${g.why}`} className="break-words"><span className="font-medium tabular-nums">{labelRanges(g.labels)}</span> <span className="text-muted-foreground">· {g.why}</span></li>)}
      </ul>
    </div>
  );
}

/** The frame checks of clips placed from the clock, in numbers. */
function ClipChecks({ c }: { c: ClipCheckTotals }) {
  const tiles: [string, number, string][] = [["Checked", c.checked, P.reference.text], ["Confirmed", c.ok, P.yes.text], ["Pulled", c.pulled, P.pen.text], ["Read again", c.unconfirmed, P.upcoming.text], ["No overlay", c.noOverlayVideos, P.no.text]];
  return (
    <div className="grid gap-1.5" data-coverage-clip-checks>
      <h4 className="text-xs font-semibold">Clips checked by their first frame</h4>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {tiles.map(([label, x, tone]) => (
          <div key={label} className="rounded-lg border border-line px-2 py-1.5"><div className={cn("text-lg font-semibold tabular-nums", tone)}>{n(x)}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>
        ))}
      </div>
    </div>
  );
}

/** Bulk Reviewed and the check pass in numbers, folded: the everyday review needs neither. */
function More({ d, onBulk }: { d: OwnerClipCoverage; onBulk: (b: Bulk) => void }) {
  const [season, setSeason] = useState<number | null>(null);
  // A season's Actionable events are marked with it only when the owner ticks this.
  const [withActionable, setWithActionable] = useState(false);
  // A pending video check is never marked reviewed: it's not in any bulk.
  const other = d.categories["no-timing"] + d.categories["early-start"] + d.categories.unplayable + d.categories["old-season"];
  const seasonOpen = d.seasons.find((s) => s.season === season) ?? d.seasons[0];
  const seasonCount = seasonOpen ? (withActionable ? seasonOpen.open : seasonOpen.open - seasonOpen.actionable) : 0;
  return (
    <Section title="Bulk review and check details" collapsible summary={`Mark many reviewed at once${other ? ` (${n(other)} not actionable)` : ""}, and the last check in numbers.`}>
      <div className="grid gap-4">
        <p className="text-xs text-muted-foreground" data-coverage-summary>
          {TRIAGE_ORDER.map((k) => `${TRIAGE_LABEL[k]} ${n(d.categories[k])}`).join(" · ")} · Reviewed {n(d.reviewed)}
        </p>
        {other > 0 && (
          <div>
            <Button size="sm" variant="outline" className={cn("h-auto min-h-9 whitespace-normal py-1.5 text-left", TOUCH)} onClick={() => onBulk({ category: "non-actionable", count: other, what: "every event that isn't Actionable (No timing, Early start / unsafe, Can't be played, Old season)" })} data-coverage-bulk="non-actionable">
              <Check /> Mark all non-actionable as reviewed ({n(other)})
            </Button>
          </div>
        )}
        {d.seasons.length > 0 && seasonOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="coverage-season">Season</label>
            <select id="coverage-season" className={cn("min-h-9 rounded-lg border border-line bg-card px-2 text-sm text-text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}
              value={seasonOpen.season} onChange={(e) => setSeason(Number(e.target.value))} data-coverage-season>
              {d.seasons.map((s) => <option key={s.season} value={s.season}>{seasonLabel(s.season)} ({n(s.open)}, {n(s.actionable)} Actionable)</option>)}
            </select>
            <label className={cn("inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm", TOUCH)}>
              <input type="checkbox" checked={withActionable} onChange={(e) => setWithActionable(e.target.checked)} className="size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" data-coverage-season-actionable />
              Include Actionable ({n(seasonOpen.actionable)})
            </label>
            <Button size="sm" variant="outline" className={TOUCH} disabled={!seasonCount} onClick={() => onBulk({
              category: withActionable ? undefined : "non-actionable", season: seasonOpen.season, count: seasonCount,
              what: withActionable
                ? `every ${seasonLabel(seasonOpen.season)} event not reviewed yet, including its ${n(seasonOpen.actionable)} Actionable`
                : `every ${seasonLabel(seasonOpen.season)} event not reviewed yet that isn't Actionable (${n(seasonOpen.actionable)} Actionable ${seasonOpen.actionable === 1 ? "event stays" : "events stay"} under To review)`,
            })} data-coverage-bulk="season">
              <Check /> Mark {seasonLabel(seasonOpen.season)} reviewed ({n(seasonCount)})
            </Button>
          </div>
        )}
        <ClipChecks c={d.clipChecks} />
        {d.lastPass && (
          <p className="text-xs text-muted-foreground" data-coverage-last-pass>
            Last check {ago(d.lastPass.at)}: {events(d.lastPass.checked)} checked · {n(d.lastPass.full)} fully clipped · {n(d.lastPass.clipped)} matches clipped · {n(d.lastPass.missing)} missing{d.lastPass.unplayable ? <> · {n(d.lastPass.unplayable)} whose recording can't be played (not counted as missing)</> : null}.
          </p>
        )}
      </div>
    </Section>
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
