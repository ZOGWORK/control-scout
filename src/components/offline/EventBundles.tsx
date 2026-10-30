// The Download page's event-day bundle (docs/event-bundle.md): pick the event (your team's, the events you
// track, or the one you came from), and one tap downloads one bundle, its size on the button. Below it, the
// bundles on this device with what time their data is from, Update / Update all when a newer one is out (the
// season packs' semantics: the manifest's version differs), and pruning once an event is over.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, HardDriveDownload, Loader2, Luggage, RefreshCw, Trash2 } from "lucide-react";
import { useApi } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { useFlag } from "../../lib/flags";
import { pickWorkspace } from "../../lib/consensus";
import { readRememberedSpace, workspacesOf, workspaceLabel } from "../../lib/scoutSpace";
import { useSavedBundles } from "../../lib/offline/bundleMeta";
import type { BundleRequest } from "../../lib/offline/bundles";
import { fmtBytes } from "../../lib/recordings";
import { bundleFinished, bundleTime, snapshotAge, snapshotClock, type BundleManifest, type SavedBundle } from "../../shared/eventBundle";
import type { TeamProfile } from "../../shared/api";
import { Button } from "../ui/button";
import { Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/controls";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { useMinuteNow } from "./Snapshot";

const bundles = () => import("../../lib/offline/bundles");
const evKey = (season: number, code: string) => `${season}:${code.toUpperCase()}`;
const today = () => new Date().toISOString().slice(0, 10);

interface EventOption { season: number; code: string; name: string; start: string | null }

/** The events worth offering: the one in the link, your team's this season (soonest first), and the ones you track. */
function useEventOptions(): EventOption[] {
  const [sp] = useSearchParams();
  const { state } = usePersonal();
  const team = useApi<TeamProfile>(state.myTeam ? `/api/teams/${state.myTeam}` : null);
  return useMemo(() => {
    const out = new Map<string, EventOption>();
    const add = (o: EventOption) => { const k = evKey(o.season, o.code); if (!out.has(k)) out.set(k, o); };
    const linked = /^(\d{4}):([A-Za-z0-9_-]{2,24})$/.exec(sp.get("event") ?? "");
    if (linked) add({ season: Number(linked[1]), code: linked[2].toUpperCase(), name: linked[2].toUpperCase(), start: null });
    const mine = (team.data?.events ?? []).filter((e) => (e.end ?? e.start ?? "9999") >= today()).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    for (const e of mine) add({ season: e.season, code: e.code, name: e.name, start: e.start });
    for (const t of state.tracked.events) { const [s, c] = t.split(":"); add({ season: Number(s), code: c, name: c, start: null }); }
    // The linked event's name, when another list knows it.
    if (linked) { const k = evKey(Number(linked[1]), linked[2]); const named = mine.find((e) => evKey(e.season, e.code) === k); if (named) out.set(k, { season: named.season, code: named.code, name: named.name, start: named.start }); }
    return [...out.values()];
  }, [sp, team.data, state.tracked.events]);
}

export function EventBundles() {
  const on = useFlag("offlinePacks");
  const saved = useSavedBundles();
  if (!on) return null;
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-accent/35 bg-card max-sm:mb-4" aria-labelledby="bundle-title" data-event-bundles>
      <div className="border-b border-border bg-accent/[0.07] p-4 sm:p-6">
        <h2 id="bundle-title" className="flex items-center gap-2 font-display text-xl font-semibold"><Luggage className="size-5 text-accent" />Event-day bundle</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          One tap before you leave for the venue. The event's teams, schedule, rankings and ratings, your matches' Know your match reports and your pick list,
          frozen with the time they're from, plus a venue card. Small enough for any phone; with no signal the event page and your reports answer from it.
        </p>
      </div>
      <Builder saved={saved} />
      {saved.length > 0 && <SavedList saved={saved} />}
    </section>
  );
}

function Builder({ saved }: { saved: SavedBundle[] }) {
  const options = useEventOptions();
  const { state, user } = usePersonal();
  const wsOn = useFlag("workspaceScouting");
  const workspace = useMemo(() => (wsOn && user ? pickWorkspace(workspacesOf(user).list, readRememberedSpace(), user.id ?? null) : null), [wsOn, user]);
  const [chosen, setChosen] = useState<string | null>(null);
  const ev = options.find((o) => evKey(o.season, o.code) === chosen) ?? options[0] ?? null;
  const [team, setTeam] = useState<number | null | undefined>(undefined);
  const [m, setM] = useState<{ key: string; manifest?: BundleManifest; error?: string } | null>(null);
  const [pct, setPct] = useState<number | null>(null);

  // Your team, when it's at this event; else the first pick stays "no team" until chosen.
  const field = m?.manifest?.field ?? [];
  const myHere = state.myTeam != null && field.some(([t]) => t === state.myTeam) ? state.myTeam : null;
  const teamNow = team === undefined ? myHere : team;
  const req: BundleRequest | null = ev ? { season: ev.season, code: ev.code, team: teamNow, workspace: workspace?.id ?? null } : null;
  const reqKey = req ? `${req.season}|${req.code}|${req.team ?? ""}|${req.workspace ?? ""}` : "";

  useEffect(() => {
    if (!req) return;
    let live = true;
    setM((x) => (x?.key === reqKey ? x : { key: reqKey, manifest: x?.manifest?.code === req.code ? x.manifest : undefined }));
    bundles().then((b) => b.fetchBundleManifest(req)).then((manifest) => live && setM({ key: reqKey, manifest }), (e: Error) => live && setM({ key: reqKey, error: e.message }));
    return () => { live = false; };
  }, [reqKey]);

  if (!options.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground sm:p-6">
        Set <Link to="/my-team" className="underline">your team</Link> or track an event, or open an event and tap Event-day bundle, and its bundle is one tap away here.
      </p>
    );
  }
  const manifest = m?.key === reqKey ? m.manifest : undefined;
  const have = ev ? saved.find((b) => evKey(b.season, b.code) === evKey(ev.season, ev.code)) : undefined;
  const upToDate = !!have && !!manifest && have.version === manifest.version;
  const download = async () => {
    if (!req || !manifest) return;
    setPct(0);
    try {
      const b = await (await bundles()).downloadBundle(req, (d, t) => setPct(Math.min(100, (d / Math.max(1, t)) * 100)), manifest);
      toast.success(`${b.name} bundle saved on this device`, { description: `${fmtBytes(b.bytes)}, data from ${snapshotClock(bundleTime(b))}. It works with no signal.` });
    } catch (e) { toast.error((e as Error).message); }
    finally { setPct(null); }
  };

  return (
    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <label className="grid gap-1 text-sm"><span className="font-medium">Event</span>
          <Select value={ev ? evKey(ev.season, ev.code) : undefined} onValueChange={(v) => { setChosen(v); setTeam(undefined); }}>
            <SelectTrigger aria-label="Event" className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{options.map((o) => <SelectItem key={evKey(o.season, o.code)} value={evKey(o.season, o.code)}>{o.name}{o.start ? ` · ${new Date(`${o.start.slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-sm"><span className="font-medium">Your team <span className="font-normal text-muted-foreground">(whose match reports go in)</span></span>
          <Select value={teamNow == null ? "none" : String(teamNow)} onValueChange={(v) => setTeam(v === "none" ? null : Number(v))} disabled={!field.length}>
            <SelectTrigger aria-label="Your team" className="h-10"><SelectValue placeholder="Loading teams…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No team: event data only</SelectItem>
              {field.map(([t, name]) => <SelectItem key={t} value={String(t)}>{t}{name ? ` ${name}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs text-muted-foreground">
          {workspace ? <>Pick list and scouting from <span className="font-medium text-foreground">{workspaceLabel(workspace)}</span> (members only, kept on this device).</> : "Sign in with a scouting workspace to add its pick list and scouting to the reports."}
        </p>
      </div>
      <div className="grid content-start gap-3 rounded-xl border border-border bg-background/40 p-3.5">
        {m?.key === reqKey && m.error ? <p className="text-sm text-danger" role="alert">{m.error}</p>
          : !manifest ? <div className="space-y-2" aria-label="Checking the bundle"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-4 w-1/2 rounded" /><div className="skeleton h-10 rounded-lg" /></div>
          : (
            <>
              <ul className="grid gap-1 text-xs" aria-label="Bundle contents">
                {manifest.sections.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3">
                    <span className={cn(s.items ? "text-foreground" : "text-muted-foreground")}>{s.items ? <CheckCircle2 className="mr-1.5 inline size-3.5 text-success" /> : <span className="mr-1.5 inline-block size-3.5" />}{s.label}{s.id === "reports" && s.items ? ` (${s.items})` : ""}</span>
                    <span className="shrink-0 text-muted-foreground">{s.items ? fmtBytes(s.bytes) : s.note ?? "none"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Data from <span className="font-medium text-foreground tabular-nums">{snapshotClock(manifest.dataAsOf ?? manifest.builtAt)}</span> · engine v{manifest.engineVersion}</p>
              {pct != null ? (
                <div role="status"><Progress value={pct} aria-label="Downloading the bundle" /><p className="mt-1 text-xs tabular-nums text-muted-foreground">Downloading… {fmtBytes((pct / 100) * manifest.bytes)} of {fmtBytes(manifest.bytes)}</p></div>
              ) : upToDate ? (
                <p className="inline-flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" />On this device and current. <Link to={`/bundle/${have!.season}/${encodeURIComponent(have!.code)}`} className="underline">Open it</Link></p>
              ) : (
                <Button size="lg" onClick={() => void download()} data-bundle-download><HardDriveDownload /> {have ? "Update" : "Download"} bundle · {fmtBytes(manifest.bytes)}</Button>
              )}
            </>
          )}
      </div>
    </div>
  );
}

/** The bundles on this device: data time and age, update state, and pruning. */
function SavedList({ saved }: { saved: SavedBundle[] }) {
  const now = useMinuteNow();
  const [latest, setLatest] = useState<Record<string, BundleManifest | "error">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const savedKey = saved.map((b) => `${evKey(b.season, b.code)}@${b.version}`).join(",");
  // Asked once per look, like the season packs' manifest: a different version means an update is out.
  useEffect(() => {
    let live = true;
    void bundles().then(async (b) => {
      for (const s of saved) {
        if (bundleFinished(s)) continue;
        const m = await b.fetchBundleManifest(b.requestOf(s)).catch(() => "error" as const);
        if (live) setLatest((x) => ({ ...x, [evKey(s.season, s.code)]: m }));
      }
    });
    return () => { live = false; };
  }, [savedKey]);
  const updatable = saved.filter((b) => { const m = latest[evKey(b.season, b.code)]; return m && m !== "error" && m.version !== b.version; });
  const finished = saved.filter((b) => bundleFinished(b, new Date(now)));

  const update = async (list: SavedBundle[]) => {
    const b = await bundles();
    let ok = 0;
    for (const s of list) {
      setBusy(evKey(s.season, s.code));
      const m = latest[evKey(s.season, s.code)];
      try { await b.downloadBundle(b.requestOf(s), undefined, m && m !== "error" ? m : undefined); ok++; } catch (e) { toast.error(`${s.name}: ${(e as Error).message}`); }
    }
    setBusy(null);
    if (ok) toast.success(ok === 1 ? "Bundle updated" : `${ok} bundles updated`);
  };
  const prune = async () => { const n = await (await bundles()).pruneFinished(); toast(`${n} finished ${n === 1 ? "event's bundle" : "events' bundles"} removed`); };
  const remove = (s: SavedBundle) => void bundles().then((b) => b.removeBundle(s.season, s.code)).then(() => toast(`${s.name} bundle removed from this device`));

  return (
    <div className="border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
        <h3 className="text-sm font-medium">On this device <span className="text-muted-foreground">· {fmtBytes(saved.reduce((n, b) => n + b.bytes, 0))}</span></h3>
        <div className="flex flex-wrap gap-2">
          {updatable.length > 0 && <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => void update(updatable)}><RefreshCw /> Update all ({updatable.length})</Button>}
          {finished.length > 0 && <Button size="sm" variant="outline" onClick={() => void prune()}><Trash2 /> Remove finished ({finished.length})</Button>}
        </div>
      </div>
      <ul className="divide-y divide-border" aria-label="Saved bundles">
        {saved.map((s) => {
          const k = evKey(s.season, s.code);
          const m = latest[k];
          const at = bundleTime(s);
          const state = bundleFinished(s, new Date(now)) ? "finished" : busy === k ? "updating" : m && m !== "error" ? (m.version === s.version ? "current" : "update") : null;
          return (
            <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6" data-saved-bundle>
              <div className="min-w-0 flex-1">
                <Link to={`/bundle/${s.season}/${encodeURIComponent(s.code)}`} className="font-medium hover:text-accent">{s.name}</Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />Data from <span className="tabular-nums text-foreground">{snapshotClock(at, new Date(now))}</span> · {snapshotAge(at, now)} old</span>
                  <span className="tabular-nums">{fmtBytes(s.bytes)}</span>
                  {s.team && <span>Team {s.team} · {s.reports} {s.reports === 1 ? "report" : "reports"}</span>}
                  {s.picklist && <span>Pick list</span>}
                </p>
              </div>
              {state && <StateChip state={state} />}
              <div className="flex gap-2">
                {state === "update" && <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => void update([s])}><RefreshCw /> Update</Button>}
                <Button size="sm" variant="outline" onClick={() => remove(s)} aria-label={`Remove ${s.name} bundle`}><Trash2 /> Remove</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const CHIP = {
  current: { label: "Current", cls: "border-success/40 bg-success/10 text-success" },
  update: { label: "Update available", cls: "border-warning/40 bg-warning/10 text-warning" },
  updating: { label: "Updating…", cls: "border-border text-muted-foreground" },
  finished: { label: "Event over", cls: "border-border text-muted-foreground" },
} as const;

function StateChip({ state }: { state: keyof typeof CHIP }) {
  const c = CHIP[state];
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", c.cls)}>{state === "updating" && <Loader2 className="size-3 animate-spin" />}{c.label}</span>;
}
