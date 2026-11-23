// Owner console › Clip coverage (server/videos/coverageCheck.ts), as a review screen where every block is something
// to act on: Waiting for approval on top (./AutoReadsPanel.tsx, the clip autopilot's reads that broke a rule), a
// progress meter (events fully clipped, matches with a clip, and matches with a clip out of those that could have one:
// the kinds no clip can come from left out, clipReview.ts CANT_CLIP), then Found in the video: each match a frame read
// saw with no clip served, with Clip from that second or Not this match right on it (optimistic: it goes at once, and
// comes back if the server says no). Why matches have no clip, as coloured tiles that filter the chips below (split into
// still workable and can't be clipped). Then To review: one card per actionable event, its missing matches as chips
// coloured by kind, each opening the app's video dialog at the second worth seeing, and Reviewed right on the card.
// The lists with nothing to do (not yet checked, no timing, early start, can't be played, old season, reviewed), a
// season's To review marked at once, and the check pass in numbers are folded under "Other lists and check details".
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
import { labelRanges, missingGroups, TRIAGE_ABOUT, TRIAGE_LABEL } from "../../shared/coverage";
import type { ClipCheckTotals, CoverageFinding, CoveragePass, CoverageTriage, OwnerAutoReads, OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { chipTone } from "../contributors/RecordingGaps";
import { SEARCH_PALETTE } from "../../lib/textTones";
import { CANT_CLIP, clippable, hms, KIND, kindOf, kindTotals, MISS_KINDS, secondOf, type MissKind } from "./clipReview";
import { cn } from "../cn";
import { AUTO_READS_PATH, AutoReadsPanel } from "./AutoReadsPanel";

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

/** The folded lists' tiles: each triage list with nothing to do (and Reviewed), its colour and a two-word name. */
const OTHER_LISTS: { list: List; name: string; swatch: (typeof P)[keyof typeof P] }[] = [
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

/** A finding's key: its event, match and second. */
const findingKey = (f: CoverageFinding) => `${eventKey(f)}/${f.label}/${f.at}`;

/** The missing matches by kind over every stored event (the pass's `all`), else the pass's own (an older pass). */
const breakdown = (p: CoveragePass | null) => (p ? p.all ?? { missing: p.missing, unplayable: p.unplayable ?? 0, why: p.why } : null);

export function ClipCoveragePanel() {
  const state = useApi<OwnerClipCoverage>(listPath("actionable"));
  // Bumped after a bulk change: the list starts again from its first page.
  const [round, setRound] = useState(0);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  // Chips of one kind only (a reason tile pressed), or every kind.
  const [only, setOnly] = useState<MissKind | null>(null);
  // Events marked reviewed here, by the missing list's version they were marked at: off the open lists before the server
  // answers (back if it says no), and back on them if that list changes (a new version, opened again). Never off Reviewed.
  const [gone, setGone] = useState<ReadonlyMap<string, string>>(new Map());
  // Findings decided here: off the list before the server answers (back if it says no).
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
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
  // Clip from that second (approve) or Not this match (reject): the frames' review endpoints (server/videos/autoReads.ts).
  const decide = (f: CoverageFinding, how: "approve" | "reject") => {
    const k = findingKey(f);
    const what = how === "approve" ? `${f.code} ${f.label}: clip live from ${hms(f.at)}` : `${f.code} ${f.label}: not this match, off the list`;
    void optimistic<OwnerAutoReads>({
      key: `clip-finding/${k}`,
      what,
      apply: () => { setDecided((s) => new Set(s).add(k)); return () => setDecided((s) => { const x = new Set(s); x.delete(k); return x; }); },
      send: () => apiFetch<OwnerAutoReads>(`${AUTO_READS_PATH}/review/${how}`, { method: "POST", json: { videoId: f.videoId, code: f.code, label: f.label, t: f.at } }),
      reconcile: (r) => { prime(AUTO_READS_PATH, r); markStale(PATH); },
    }).then((r) => { if (r.ok) toast.success(what); else markStale(PATH); });
  };
  return (
    <Async state={state}>
      {(d) => (
        <div className="grid gap-5">
          <AutoReadsPanel />
          <Progress d={d} />
          {(!only || only === "seen") && <Findings findings={d.findings} decided={decided} onDecide={decide} />}
          <ReasonTiles p={d.lastPass} only={only} onOnly={setOnly} />
          <Section title={`To review (${n(d.open)})`} description={TRIAGE_ABOUT.actionable}>
            {d.open ? <Pages key={`actionable-${round}`} first={d} total={d.open} list="actionable" gone={gone} only={only} findings={d.findings} onReview={review} />
              : <EmptyState icon={Film} title="0 to review" description="Every match checked against the video has its clip or its reason. Matches not yet checked wait for the frame reader." />}
          </Section>
          <More d={d} round={round} gone={gone} only={only} findings={d.findings} onReview={review} onBulk={setBulk} />
          <BulkConfirm bulk={bulk} onClose={() => setBulk(null)} onDone={done} />
        </div>
      )}
    </Async>
  );
}

/** One big meter: a share as a percentage, a thick bar, its two numbers, and a line on what it leaves out. */
function Meter({ label, have, of, bar, testid, note }: { label: string; have: number; of: number; bar: string; testid: string; note?: string }) {
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
      {note && <p className="mt-0.5 text-xs text-muted-foreground" data-coverage-meter-note>{note}</p>}
    </div>
  );
}

function Progress({ d }: { d: OwnerClipCoverage }) {
  const p = d.lastPass, b = breakdown(p);
  const moved = p?.pending != null && p.pendingBefore != null ? p.pendingBefore - p.pending : null;
  // Matches with a clip out of those that could have one: no recording, outside its video, not in the video it holds,
  // or a video that can't be played are left out (clipReview.ts CANT_CLIP). Only once a pass has said why.
  const c = b ? clippable(d.totals.played, d.totals.withClip, b.why, b.unplayable) : null;
  return (
    <div className="grid gap-2" data-coverage-totals>
      <div className={cn("grid gap-3", c ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Meter testid="events" label="Events fully clipped" have={d.totals.full} of={d.totals.events} bar={P.yes.bar} />
        <Meter testid="matches" label="Matches with a clip" have={d.totals.withClip} of={d.totals.played} bar={P.auto.bar} />
        {c && <Meter testid="clippable" label="Clipped of what can be" have={c.have} of={c.of} bar={P.winning.bar}
          note={`${n(c.cant)} can't be clipped: no recording of them, outside their video, not in the video, or it can't be played`} />}
      </div>
      <p className="text-xs text-muted-foreground" data-coverage-pending>
        {p ? <>Checked {ago(p.at)}</> : "No check pass yet: the next one runs within 5 minutes"}
        {p?.pending != null && <> · <span className="tabular-nums font-medium text-text-base">{n(p.pending)}</span> waiting for their video check
          {moved != null && moved !== 0 && <span className={cn("ml-1 font-medium tabular-nums", moved > 0 ? "text-success v8:text-emerald-400" : "text-text-muted")}>{moved > 0 ? `↓ ${n(moved)}` : `↑ ${n(-moved)}`}</span>}</>}
      </p>
    </div>
  );
}

/** Why matches are missing, over every stored event: a bar in each kind's colour, and a tile per kind that shows only
 *  its chips below, the kinds a clip can still come from first, then the ones no clip can (left out of the clippable
 *  share). */
function ReasonTiles({ p, only, onOnly }: { p: CoveragePass | null; only: MissKind | null; onOnly: (k: MissKind | null) => void }) {
  const b = breakdown(p);
  const kinds = b ? kindTotals(b.why) : [];
  if (!b || !kinds.length) return null;
  const total = kinds.reduce((s, k) => s + k.n, 0);
  const workable = kinds.filter((k) => !CANT_CLIP.has(k.kind)), cant = kinds.filter((k) => CANT_CLIP.has(k.kind));
  const sum = (ks: typeof kinds) => ks.reduce((s, k) => s + k.n, 0);
  const tiles = (ks: typeof kinds) => (
    <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Show only">
      {ks.map((k) => {
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
  );
  return (
    <div className="grid gap-2" data-coverage-pass>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Why <span className="tabular-nums">{n(b.missing)}</span> matches have no clip{b.unplayable ? <span className="font-normal text-muted-foreground"> · {n(b.unplayable)} more whose recording can't be played</span> : null}</h3>
        {only && <Button size="sm" variant="ghost" className={TOUCH} onClick={() => onOnly(null)} data-coverage-only-clear><X /> Show every kind</Button>}
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
        {[...workable, ...cant].map((k) => <span key={k.kind} className={cn("h-full", KIND[k.kind].swatch.bar, only && only !== k.kind && "opacity-25")} style={{ width: `${(k.n / total) * 100}%` }} />)}
      </div>
      {workable.length > 0 && <div className="grid gap-1" data-coverage-workable><p className="text-xs text-muted-foreground">A clip can still come from these ({n(sum(workable))})</p>{tiles(workable)}</div>}
      {cant.length > 0 && <div className="grid gap-1" data-coverage-cant><p className="text-xs text-muted-foreground">No clip can come from these ({n(sum(cant) + b.unplayable)} with the unplayable): left out of the clippable share</p>{tiles(cant)}</div>}
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

/** Events shown in Found in the video before "Show all". */
const FINDING_EVENTS = 12;

/** Matches a frame read saw at a second with no clip served there: one card per event, a row per match with its second
 *  to play, why it isn't a clip, and the owner's two answers: Clip from that second (it goes live, owner-approved) or
 *  Not this match (off the list; a re-read that sees it at another second lists it again). Pulled clips aren't here:
 *  nothing for the owner to decide (their chips say so under To review). */
function Findings({ findings, decided, onDecide }: { findings: CoverageFinding[]; decided: ReadonlySet<string>; onDecide: (f: CoverageFinding, how: "approve" | "reject") => void }) {
  const [all, setAll] = useState(false);
  const open = useMemo(() => findings.filter((f) => f.kind === "seen" && f.source), [findings]);
  const by = useMemo(() => {
    const m = new Map<string, CoverageFinding[]>();
    for (const f of open) (m.get(eventKey(f)) ?? m.set(eventKey(f), []).get(eventKey(f))!).push(f);
    return [...m.values()];
  }, [open]);
  const shown = by.map((fs) => fs.filter((f) => !decided.has(findingKey(f)))).filter((fs) => fs.length);
  const left = shown.reduce((s, fs) => s + fs.length, 0);
  const cut = all ? shown : shown.slice(0, FINDING_EVENTS);
  return (
    <Section title={`Found in the video (${n(left)})`} description="A frame read saw each of these matches at that second, but it isn't a clip. Play it, then Clip from that second, or Not this match.">
      {cut.length ? (
        <>
          <ul className="grid gap-2 lg:grid-cols-2" data-coverage-findings>
            {cut.map((fs) => {
              const f0 = fs[0];
              return (
                <li key={eventKey(f0)} className="grid content-start gap-2 rounded-xl border border-line bg-card p-2.5" data-coverage-finding-event={eventKey(f0)}>
                  <div className="flex gap-3">
                    <Thumb videoId={f0.videoId} />
                    <div className="grid min-w-0 flex-1 content-start gap-1">
                      <Link to={`/events/${f0.season}/${encodeURIComponent(f0.code)}`} className="line-clamp-2 text-sm font-medium hover:underline">{f0.name}</Link>
                      <span className="text-xs text-muted-foreground">{f0.season} · {f0.code} · {fs.length === 1 ? "1 match" : `${fs.length} matches`}</span>
                    </div>
                  </div>
                  <ul className="grid gap-2">
                    {fs.map((f) => <FindingRow key={findingKey(f)} f={f} onDecide={onDecide} />)}
                  </ul>
                </li>
              );
            })}
          </ul>
          {!all && shown.length > cut.length && (
            <Button variant="outline" className={cn("mt-2 w-full", TOUCH)} onClick={() => setAll(true)} data-coverage-findings-all>Show all ({n(shown.length - cut.length)} more events)</Button>
          )}
        </>
      ) : <p className="text-sm text-muted-foreground" data-coverage-findings>None: every match a frame read saw is a clip or was answered.</p>}
    </Section>
  );
}

/** One match a frame read saw: its second to play, why it isn't a clip, and the owner's two answers. */
function FindingRow({ f, onDecide }: { f: CoverageFinding; onDecide: (f: CoverageFinding, how: "approve" | "reject") => void }) {
  const title = `${f.season} ${f.code} ${f.label}`;
  return (
    <li className="grid gap-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0" data-coverage-finding={`${eventKey(f)}/${f.label}`} data-finding-source={f.source}>
      <div className="flex min-w-0 items-start gap-2">
        <button type="button" onClick={() => watch(f.videoId, f.at, `${title} · seen at ${hms(f.at)}`)} data-finding-play
          className={cn("inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold tabular-nums transition-transform hover:brightness-110 active:scale-95 motion-reduce:transform-none", TOUCH, KIND.seen.swatch.fill)}
          aria-label={`Play ${title} at ${hms(f.at)} in the app's player`}>
          <Play className="size-3 fill-current" aria-hidden />{f.label} at {hms(f.at)}
        </button>
        <span className="min-w-0 break-words pt-1 text-xs text-muted-foreground" data-finding-why>{f.why || "Seen in the video, kept off the site"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className={TOUCH} onClick={() => onDecide(f, "approve")} data-finding-approve><Check /> Clip from {hms(f.at)}</Button>
        <Button size="sm" variant="outline" className={TOUCH} onClick={() => onDecide(f, "reject")} data-finding-reject><X /> Not {f.label}</Button>
      </div>
    </li>
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
  // Only an actionable event's review means anything: the other lists never show under To review, reviewed or not.
  const canReview = !e.reviewedAt && e.triage === "actionable";
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
  // A match its video's frames were read for says what they showed; the clock's own reason (a video shorter than its
  // broadcast …) is kept beside it, so the owner still sees why the clock alone couldn't place it.
  const groups = missingGroups(e.missing.map((m) => (m.clock && m.clock !== m.why ? { ...m, why: `${m.why}. The clock: ${m.clock}` } : m)));
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
                {tone === "done" && <Check className="size-3.5 text-success v8:text-emerald-400" aria-hidden />}
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

/** The lists with nothing to do, a season's To review marked at once, and the check pass in numbers, folded: the
 *  everyday review needs none of them. A list opens only when its tile is pressed. */
function More({ d, round, gone, only, findings, onReview, onBulk }: {
  d: OwnerClipCoverage; round: number; gone: ReadonlyMap<string, string>; only: MissKind | null; findings: CoverageFinding[];
  onReview: (e: OwnerCoverageEvent) => void; onBulk: (b: Bulk) => void;
}) {
  const [list, setList] = useState<List | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  // Only seasons with events To review: marking a season's other events reviewed changes nothing the owner sees.
  const seasons = d.seasons.filter((s) => s.actionable > 0);
  const seasonOpen = seasons.find((s) => s.season === season) ?? seasons[0];
  const others = OTHER_LISTS.reduce((s, l) => s + (l.list === "reviewed" ? 0 : d.categories[l.list]), 0);
  return (
    <Section title="Other lists and check details" collapsible summary={`${n(others)} events missing a clip with nothing to do, ${n(d.reviewed)} reviewed, a season's To review at once, and the last check in numbers.`}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Show" data-coverage-triage>
          {OTHER_LISTS.map(({ list: k, name, swatch }) => {
            const count = k === "reviewed" ? d.reviewed : d.categories[k];
            const on = list === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setList(on ? null : k)} data-coverage-list={k}
                title={k === "reviewed" ? "Seen already" : TRIAGE_ABOUT[k]}
                className={cn("flex min-h-[60px] flex-col items-start justify-center rounded-xl border border-l-4 px-3 py-2 text-left transition-colors", swatch.edge, swatch.tint,
                  on ? "border-text-base/40 ring-2 ring-text-base/25" : "border-line hover:border-text-base/30")}>
                <span className={cn("text-2xl font-semibold tabular-nums leading-tight", swatch.text)}>{n(count)}</span>
                <span className="text-xs font-medium text-text-base">{name}</span>
              </button>
            );
          })}
        </div>
        {list && <OtherList key={`${list}-${round}`} list={list} gone={gone} only={only} findings={findings} onReview={onReview} />}
        {seasonOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="coverage-season">Mark a season's To review reviewed</label>
            <select id="coverage-season" className={cn("min-h-9 rounded-lg border border-line bg-card px-2 text-sm text-text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}
              value={seasonOpen.season} onChange={(e) => setSeason(Number(e.target.value))} data-coverage-season>
              {seasons.map((s) => <option key={s.season} value={s.season}>{seasonLabel(s.season)} ({n(s.actionable)})</option>)}
            </select>
            <Button size="sm" variant="outline" className={TOUCH} onClick={() => onBulk({
              category: "actionable", season: seasonOpen.season, count: seasonOpen.actionable,
              what: `every ${seasonLabel(seasonOpen.season)} event under To review`,
            })} data-coverage-bulk="season">
              <Check /> Mark {n(seasonOpen.actionable)} reviewed
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

/** One folded list, asked for when its tile is pressed. */
function OtherList({ list, gone, only, findings, onReview }: { list: List; gone: ReadonlyMap<string, string>; only: MissKind | null; findings: CoverageFinding[]; onReview: (e: OwnerCoverageEvent) => void }) {
  const state = useApi<OwnerClipCoverage>(listPath(list));
  return (
    <Async state={state}>
      {(d) => {
        const total = list === "reviewed" ? d.reviewed : d.categories[list];
        return (
          <div className="grid gap-2" data-coverage-other={list}>
            <p className="text-sm text-muted-foreground">{list === "reviewed" ? "Seen already: back under To review only if the missing list changes to an actionable one." : TRIAGE_ABOUT[list]}</p>
            {total ? <Pages first={d} total={total} list={list} gone={gone} only={only} findings={findings} onReview={onReview} /> : <p className="text-sm text-muted-foreground">None.</p>}
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
