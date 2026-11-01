// An event-day bundle on this device (docs/event-bundle.md): /bundle/:season/:code. Everything here comes from
// the device, so it opens with no signal. It leads with what's useful at the venue: the event, when the data is
// from (one line), the schedule (your team's matches, or every match, with a team picker right there), and the
// pick list's top teams when there is one. The rules reference waits, closed, at the bottom. Links into the event
// page are answered from the bundle when there's no signal, live otherwise. /bundle/:season/:code/picklist shows the frozen pick list, unless the live one loads:
// then the live one takes over.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { BookOpen, CalendarDays, ChevronDown, ClipboardList, ExternalLink, HardDriveDownload, ListOrdered, MapPin, Swords, Trash2, Trophy } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTitle } from "../lib/meta";
import { useBundle } from "../lib/offline/useBundle";
import { usePersonal } from "../lib/personal";
import { fmtBytes } from "../lib/recordings";
import { matchReportHref } from "../shared/matchReport";
import { bundleTime, matchClock, snapshotClock, zoneAbbr, type EventBundle, type SavedBundle, type VenueCard } from "../shared/eventBundle";
import type { MatchView } from "../shared/api";
import { Page, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { SnapshotBanner, SnapshotFrame } from "../components/offline/Snapshot";

export default function BundlePage() {
  const { season, code } = useParams();
  const s = /^\d{4}$/.test(season ?? "") ? Number(season) : null;
  const { meta, bundle, loading } = useBundle(s, code ?? null);
  useTitle(meta ? `${meta.name} · event-day bundle` : "Event-day bundle");
  if (!meta) return <Page><NoBundle season={s} code={code ?? ""} /></Page>;
  if (loading) return <Page><div className="skeleton h-40 rounded-2xl" /><div className="skeleton mt-4 h-72 rounded-2xl" /></Page>;
  if (!bundle) return <Page><EmptyState icon={HardDriveDownload} title="This bundle can't be read" description="It may be from a newer version of Control Scout. Download it again from the Download page." action={<Button asChild variant="secondary"><Link to="/download">Download page</Link></Button>} /></Page>;
  return <Page><BundleView meta={meta} b={bundle} /></Page>;
}

function NoBundle({ season, code }: { season: number | null; code: string }) {
  return (
    <EmptyState icon={HardDriveDownload} title="No event-day bundle for this event on this device"
      description="Download one before you leave for the venue: the event, your match reports and your pick list, readable with no signal."
      action={<Button asChild><Link to={`/download${season ? `?event=${season}:${encodeURIComponent(code.toUpperCase())}` : ""}`}><HardDriveDownload /> Get the bundle</Link></Button>} />
  );
}

const dateRange = (v: VenueCard) => {
  const f = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (!v.start) return null;
  return v.end && v.end.slice(0, 10) !== v.start.slice(0, 10) ? `${f(v.start)} – ${f(v.end)}` : f(v.start);
};

/** How many of the pick list's teams show on the page (the rest are one tap away). */
const PICK_PREVIEW = 5;
const teamsOf = (m: MatchView) => [...m.red.teams, ...m.blue.teams].map((t) => t.number);
/** Played with a score to show (a row then shows the score, not its time). */
const scored = (m: MatchView) => m.played && !!m.red.score && !!m.blue.score;

/** The venue card: where and when, from the event's own data (times carry their zone where they're shown). */
export function VenueCardView({ v, children }: { v: VenueCard; children?: ReactNode }) {
  const place = [v.city, v.state, v.country].filter(Boolean).join(", ");
  const when = dateRange(v);
  const mapQ = v.address ?? [v.venue, place].filter(Boolean).join(", ");
  return (
    <section aria-label="Venue" className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-5 max-sm:p-4" data-venue-card>
      <p className="text-xs text-muted-foreground">{v.typeLabel}</p>
      <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{v.name}</h1>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>{v.venue && <span className="block font-medium">{v.venue}</span>}<span className="text-muted-foreground">{v.address ?? (place || "Venue not published yet")}</span></span>
        </p>
        {when && <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span className="font-medium">{when}</span></p>}
      </div>
      {(mapQ || v.website) && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {mapQ && <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQ)}`} target="_blank" rel="noreferrer">Directions <ExternalLink className="size-3" /></a>}
          {v.website && <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={v.website} target="_blank" rel="noreferrer">Event site <ExternalLink className="size-3" /></a>}
        </p>
      )}
      {children}
    </section>
  );
}

const ALL = "all";
const teamKey = (season: number, code: string) => `cs-bundle-team:${season}:${code.toUpperCase()}`;
const readTeam = (season: number, code: string): number | "all" | null => {
  try { const v = localStorage.getItem(teamKey(season, code)); return v == null ? null : v === ALL ? ALL : Number(v) || null; } catch { return null; }
};

/** The team whose matches lead the page: the one picked here, else the bundle's, else my team when it plays here; "all": every match. */
function useShownTeam(meta: SavedBundle, field: number[]): [number | "all", (v: number | "all") => void] {
  const { state } = usePersonal();
  const [picked, setPicked] = useState(() => readTeam(meta.season, meta.code));
  const here = (t: number | null | undefined) => (t != null && field.includes(t) ? t : null);
  const shown = picked === ALL ? ALL : here(picked) ?? here(meta.team) ?? here(state.myTeam) ?? ALL;
  const set = (v: number | "all") => {
    setPicked(v);
    try { localStorage.setItem(teamKey(meta.season, meta.code), String(v)); } catch { /* private window: this visit only */ }
  };
  return [shown, set];
}

function BundleView({ meta, b }: { meta: SavedBundle; b: EventBundle }) {
  const nav = useNavigate();
  const at = bundleTime(meta);
  const eventHref = `/events/${meta.season}/${encodeURIComponent(meta.code)}`;
  const remove = () => import("../lib/offline/bundles").then((m) => m.removeBundle(meta.season, meta.code)).then(() => { toast(`${meta.name} bundle removed from this device`); nav("/download"); }, (e: Error) => toast.error(e.message));
  const pick = b.picklist && b.picklist.count > 0 ? b.picklist : null;
  return (
    <div className="space-y-4">
      <VenueCardView v={b.venue}>
        <SnapshotBanner compact at={at} className="mt-3" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm"><Link to={eventHref}><ClipboardList /> Open the event</Link></Button>
          <Button asChild size="sm" variant="secondary"><Link to={`${eventHref}?tab=rankings`}><Trophy /> Rankings</Link></Button>
        </div>
      </VenueCardView>
      <div className={pick ? "grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : undefined}>
        <MatchesCard meta={meta} b={b} />
        {pick && <PickListCard meta={meta} b={b} pick={pick} at={at} />}
      </div>
      <RulesSection b={b} />
      <BundleContents b={b} meta={meta} onRemove={remove} />
    </div>
  );
}

/** The schedule from the bundle: one team's matches (the next one marked), or every match. Never empty for want of a team. */
function MatchesCard({ meta, b }: { meta: SavedBundle; b: EventBundle }) {
  const field = useMemo(() => [...b.event.field].sort((x, y) => x.team - y.team), [b.event.field]);
  const [shown, setShown] = useShownTeam(meta, field.map((f) => f.team));
  const reports = useMemo(() => new Set(b.reports.map((r) => r.key)), [b.reports]);
  const matches = shown === ALL ? b.event.matches : b.event.matches.filter((m) => teamsOf(m).includes(shown));
  const next = shown === ALL ? null : matches.find((m) => !m.played)?.key ?? null;
  const zone = zoneAbbr(b.venue.timezone);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-matches">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="b-matches" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Swords className="size-4 text-red-alliance" />{shown === ALL ? "Schedule" : `Team ${shown}'s matches`}
        </h2>
        {field.length > 0 && (
          <Select value={String(shown)} onValueChange={(v) => setShown(v === ALL ? ALL : Number(v))}>
            <SelectTrigger size="sm" aria-label="Show matches for" className="h-9 w-auto min-w-[9rem] max-w-[14rem] max-sm:h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All matches</SelectItem>
              {field.map((f) => <SelectItem key={f.team} value={String(f.team)}>{f.team}{f.name ? ` ${f.name}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {matches.length ? (
        <>
          {zone && matches.some((m) => !scored(m) && matchClock(m.time)) && <p className="mt-1 text-xs text-muted-foreground">Times in {zone}</p>}
          <ul className="mt-2 divide-y divide-border">
            {matches.map((m) => (
              <li key={m.key}>
                {/* Know your match: live when there's signal, the bundle's saved report when there isn't, and when
                    neither answers, the report page offers this match on the event page (from the bundle). */}
                <Link to={matchReportHref({ season: meta.season, code: meta.code, key: m.key })} data-bundle-match
                  className="grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm hover:text-accent max-sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
                  <span className="font-medium tabular-nums">{m.label}</span>
                  <span className="min-w-0 truncate font-mono text-xs">
                    <Side teams={m.red.teams} me={shown} red /> <span className="text-muted-foreground">vs</span> <Side teams={m.blue.teams} me={shown} />
                  </span>
                  <span className="flex items-center justify-end gap-2 text-xs tabular-nums text-muted-foreground">
                    {m.key === next && <Badge variant="outline" className="border-accent/50 text-accent">Next</Badge>}
                    {scored(m) && m.red.score && m.blue.score ? <span className="text-foreground">{m.red.score.total}–{m.blue.score.total}</span> : matchClock(m.time) ?? ""}
                  </span>
                  {reports.has(m.key) && <span className="sr-only">, report saved offline</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {!b.event.matches.length ? "No schedule published yet. Download the bundle again once FIRST posts it." : `Team ${shown} has no matches in the schedule yet.`}
        </p>
      )}
    </section>
  );
}

function Side({ teams, me, red }: { teams: MatchView["red"]["teams"]; me: number | "all"; red?: boolean }) {
  return (
    <span className={red ? "text-red-alliance-text" : "text-blue-alliance-text"}>
      {teams.map((t, i) => <span key={t.number}>{i > 0 && " "}<span className={t.number === me ? "font-bold underline underline-offset-2" : undefined}>{t.number}</span></span>)}
    </span>
  );
}

/** The workspace's pick list as it was saved: who it belongs to, how many, when, and the top few. */
function PickListCard({ meta, b, pick, at }: { meta: SavedBundle; b: EventBundle; pick: NonNullable<EventBundle["picklist"]>; at: string }) {
  const names = new Map(b.event.field.map((f) => [f.team, f.name]));
  const top = (pick.teams ?? []).slice(0, PICK_PREVIEW);
  const href = `/bundle/${meta.season}/${encodeURIComponent(meta.code)}/picklist`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-pick">
      <h2 id="b-pick" className="flex items-center gap-2 font-display text-lg font-semibold"><ListOrdered className="size-4 text-accent" />Your team's pick list</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {meta.workspace?.name ? `${meta.workspace.name}: ` : ""}{pick.count} {pick.count === 1 ? "team" : "teams"}, saved at <span className="tabular-nums">{snapshotClock(at)}</span>
      </p>
      {top.length > 0 && (
        <ol className="mt-3 space-y-1.5 text-sm">
          {top.map((t, i) => (
            <li key={t} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="font-medium tabular-nums">{t}</span>
              <span className="min-w-0 truncate text-muted-foreground">{names.get(t) ?? ""}</span>
            </li>
          ))}
        </ol>
      )}
      <Link to={href} className="mt-3 inline-flex min-h-9 items-center text-sm font-medium underline underline-offset-4 hover:text-accent">
        {pick.count > top.length ? `See all ${pick.count}` : "Open the full list"}
      </Link>
    </section>
  );
}

/** The rules reference: closed until asked for, and only rendered once opened (it's long). */
function RulesSection({ b }: { b: EventBundle }) {
  const [open, setOpen] = useState(false);
  if (!b.rules) return null;
  return (
    <details className="group rounded-2xl border border-border bg-card" onToggle={(e) => setOpen(e.currentTarget.open)} data-bundle-rules>
      <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-sm font-medium sm:px-5 [&::-webkit-details-marker]:hidden">
        <BookOpen className="size-4 text-success" aria-hidden />{b.rules.title}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {open && <div className="border-t border-border p-3 sm:p-4"><SnapshotFrame html={b.rules.html} title={b.rules.title} /></div>}
    </details>
  );
}

/** What's inside, from the manifest: each section, its version and size. */
function BundleContents({ b, meta, onRemove }: { b: EventBundle; meta: SavedBundle; onRemove: () => void }) {
  return (
    <details className="rounded-2xl border border-border bg-card">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium sm:px-5">What's in this bundle · {fmtBytes(meta.bytes)}</summary>
      <ul className="divide-y divide-border border-t border-border text-xs">
        {b.manifest.sections.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="font-mono text-muted-foreground">{s.items} · {fmtBytes(s.bytes)} · v{s.version}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <span className="font-mono">Bundle v{meta.version} · engine v{b.manifest.engineVersion}</span>
        <Button size="sm" variant="outline" onClick={onRemove}><Trash2 /> Remove from this device</Button>
      </div>
    </details>
  );
}

/** /bundle/:season/:code/picklist: the frozen pick list at once, while the live one is asked for; when the live
 *  one loads, it takes over (the same season). A request that never answers (venue wifi that carries nothing)
 *  never hides the snapshot. */
export function BundlePicklistPage() {
  const { season, code } = useParams();
  const s = /^\d{4}$/.test(season ?? "") ? Number(season) : null;
  const { meta, bundle, loading } = useBundle(s, code ?? null);
  const [live, setLive] = useState<"trying" | "loaded" | "unavailable">("trying");
  useTitle(meta ? `Pick list · ${meta.name}` : "Pick list");
  const ws = meta?.workspace?.id;
  useEffect(() => {
    if (!ws || s == null) { setLive("unavailable"); return; }
    let on = true;
    setLive("trying");
    apiFetch(`/api/scout/workspaces/${encodeURIComponent(ws)}/picklist?season=${s}`).then(() => on && setLive("loaded"), () => on && setLive("unavailable"));
    return () => { on = false; };
  }, [ws, s]);
  if (live === "loaded" && ws && s != null) return <Navigate to={`/scout?space=${encodeURIComponent(ws)}&view=picklist&season=${s}`} replace />;
  if (!meta) return <Page><NoBundle season={s} code={code ?? ""} /></Page>;
  if (loading) return <Page><div className="skeleton h-72 rounded-2xl" /></Page>;
  if (!bundle?.picklist) return <Page><EmptyState icon={ListOrdered} title="No pick list in this bundle" description="Bundles made while signed in with a scouting workspace hold its pick list." /></Page>;
  return (
    <Page>
      <Link to={`/bundle/${meta.season}/${encodeURIComponent(meta.code)}`} className="mb-3 inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-foreground">← {meta.name} bundle</Link>
      <SnapshotBanner at={bundleTime(meta)}>
        {live === "trying" ? "Checking for the live pick list; it replaces this as soon as it loads. " : "Couldn't load the live pick list, so this is the one from your bundle. "}
        Picks made since aren't in it.
      </SnapshotBanner>
      <SnapshotFrame html={bundle.picklist.html} title="Pick list, snapshot" />
    </Page>
  );
}
