// An event-day bundle on this device (docs/event-bundle.md): /bundle/:season/:code. Everything here comes from
// the device, so it opens with no signal: the venue card, what time the data is from, your match reports and
// the pick list (frozen snapshots), and links into the event page (answered from the bundle when there's no
// signal, live otherwise). /bundle/:season/:code/picklist shows the frozen pick list, unless the live one loads:
// then the live one takes over.
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { BookOpen, CalendarDays, ClipboardList, ExternalLink, HardDriveDownload, ListOrdered, MapPin, Swords, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTitle } from "../lib/meta";
import { useBundle } from "../lib/offline/useBundle";
import { fmtBytes } from "../lib/recordings";
import { matchReportHref } from "../shared/matchReport";
import { bundleTime, type EventBundle, type SavedBundle, type VenueCard } from "../shared/eventBundle";
import { Page, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
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

/** The venue card: where and when, from the event's own data. */
export function VenueCardView({ v }: { v: VenueCard }) {
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
        {when && <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span><span className="font-medium">{when}</span>{v.timezone && <span className="block text-xs text-muted-foreground">Times in {v.timezone}</span>}</span></p>}
      </div>
      {(mapQ || v.website) && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {mapQ && <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQ)}`} target="_blank" rel="noreferrer">Directions <ExternalLink className="size-3" /></a>}
          {v.website && <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={v.website} target="_blank" rel="noreferrer">Event site <ExternalLink className="size-3" /></a>}
        </p>
      )}
    </section>
  );
}

function BundleView({ meta, b }: { meta: SavedBundle; b: EventBundle }) {
  const nav = useNavigate();
  const at = bundleTime(meta);
  const eventHref = `/events/${meta.season}/${encodeURIComponent(meta.code)}`;
  const remove = () => import("../lib/offline/bundles").then((m) => m.removeBundle(meta.season, meta.code)).then(() => { toast(`${meta.name} bundle removed from this device`); nav("/download"); }, (e: Error) => toast.error(e.message));
  return (
    <div className="space-y-5 max-sm:space-y-4">
      <VenueCardView v={b.venue} />
      <SnapshotBanner at={at}>Pages open live whenever there's signal; this bundle answers only when there isn't.</SnapshotBanner>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-matches">
          <h2 id="b-matches" className="flex items-center gap-2 font-display text-lg font-semibold"><Swords className="size-4 text-red-alliance" />{meta.team ? `Team ${meta.team}'s matches` : "Your matches"}</h2>
          {b.reports.length ? (
            <ul className="mt-3 divide-y divide-border">
              {b.reports.map((r) => (
                <li key={r.key}>
                  <Link to={matchReportHref({ season: meta.season, code: meta.code, key: r.key })} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-accent">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{r.time ? r.time.slice(11, 16) : "Time not set"} · Know your match</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">{b.manifest.sections.find((x) => x.id === "reports")?.note ?? "No match reports in this bundle."}</p>}
        </section>
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-pick">
            <h2 id="b-pick" className="flex items-center gap-2 font-display text-lg font-semibold"><ListOrdered className="size-4 text-accent" />Pick list</h2>
            {b.picklist ? (
              <p className="mt-2 text-sm text-muted-foreground">{b.picklist.count} {b.picklist.count === 1 ? "team" : "teams"} from {meta.workspace?.name ?? "your workspace"}, frozen at the snapshot time.{" "}
                <Link to={`/bundle/${meta.season}/${encodeURIComponent(meta.code)}/picklist`} className="font-medium text-foreground underline underline-offset-4">Open the pick list</Link></p>
            ) : <p className="mt-2 text-sm text-muted-foreground">{b.manifest.sections.find((x) => x.id === "picklist")?.note}</p>}
          </section>
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-event">
            <h2 id="b-event" className="flex items-center gap-2 font-display text-lg font-semibold"><ClipboardList className="size-4 text-blue-alliance" />Event</h2>
            <p className="mt-2 text-sm text-muted-foreground">{b.event.field.length} teams, {b.event.matches.length} matches scheduled, rankings and predictions as of the snapshot. With no signal the event page answers from this bundle.{" "}
              <Link to={eventHref} className="font-medium text-foreground underline underline-offset-4">Open the event</Link></p>
          </section>
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="b-rules">
            <h2 id="b-rules" className="flex items-center gap-2 font-display text-lg font-semibold"><BookOpen className="size-4 text-success" />{b.rules?.title ?? "Rules reference"}</h2>
            {b.rules ? <div className="mt-3"><SnapshotFrame html={b.rules.html} title={b.rules.title} /></div>
              : <p className="mt-2 text-sm text-muted-foreground">{b.manifest.sections.find((x) => x.id === "rules")?.note ?? "Not in this bundle."}</p>}
          </section>
        </div>
      </div>
      <BundleContents b={b} meta={meta} onRemove={remove} />
    </div>
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

/** /bundle/:season/:code/picklist: the live pick list when it loads, else the frozen one. */
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
    apiFetch(`/api/scout/workspaces/${encodeURIComponent(ws)}/picklist?season=${s}`).then(() => on && setLive("loaded"), () => on && setLive("unavailable"));
    return () => { on = false; };
  }, [ws, s]);
  if (live === "loaded" && ws) return <Navigate to={`/scout?space=${encodeURIComponent(ws)}&view=picklist`} replace />;
  if (!meta) return <Page><NoBundle season={s} code={code ?? ""} /></Page>;
  if (loading || live === "trying") return <Page><div className="skeleton h-72 rounded-2xl" /></Page>;
  if (!bundle?.picklist) return <Page><EmptyState icon={ListOrdered} title="No pick list in this bundle" description="Bundles made while signed in with a scouting workspace hold its pick list." /></Page>;
  return (
    <Page>
      <Link to={`/bundle/${meta.season}/${encodeURIComponent(meta.code)}`} className="mb-3 inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-foreground">← {meta.name} bundle</Link>
      <SnapshotBanner at={bundleTime(meta)}>Couldn't load the live pick list, so this is the one from your bundle. Picks made since aren't in it.</SnapshotBanner>
      <SnapshotFrame html={bundle.picklist.html} title="Pick list, snapshot" />
    </Page>
  );
}
