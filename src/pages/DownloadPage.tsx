// Offline (/download): save data on this device so Control Scout works at a meet with no Wi-Fi and no signal.
// Three choices at the top, each with its download size: this event (the event-day pack, EventBundles), a
// season (one SQLite pack per season), or the whole current season (its season pack plus every team's
// ratings for predictions). Below, "On this device": every pack with its size here, when its data is from,
// what a newer release brings, Update and Delete, and half-finished downloads as "Paused at 40%", never as
// saved. Every download goes through lib/offline/download.ts: real MB progress, resumes after a dropped
// connection, and keeps nothing until the whole file matches its published SHA-256.
//
// The lite pack (every team's ratings) also downloads itself in the background for returning visitors
// (LitePackSync, packPolicy.ts); opening this page fetches it at once. Updates to saved seasons are found in the
// background (lib/offline/updateWatcher) and follow the two update settings below the list.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Database, HardDriveDownload, Layers, Loader2, Pause, RefreshCw, Trash2, Trophy, WifiOff } from "lucide-react";
import { ManifestError, PACK_EVENT, fetchManifest, packStatus, syncLite, transferOf, type PackFile, type PackManifest, type PackMeta } from "../lib/packs";
import type { ConnectionInfo } from "../lib/packPolicy";
import { removeSeason, useSavedSeasons, type SavedSeason } from "../lib/offline/seasons";
import { runSeasonBatch, useSeasonBatch } from "../lib/offline/seasonBatch";
import { planSeasons, type SeasonRow } from "../lib/offline/seasonPlan";
import { useSavedBundles } from "../lib/offline/bundleMeta";
import { dropPartial, type ActiveDownload } from "../lib/offline/download";
import { useActiveDownloads, usePartials } from "../lib/offline/useDownloads";
import { dataFrom, deviceItems, pausedItems, totalBytes, whatChanged, type DeviceItem, type PausedItem } from "../lib/offline/storage";
import { fmtBytes } from "../lib/recordings";
import { PageHeader, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { dayDate, seasonLabel } from "../lib/format";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { TapTooltip } from "../components/ui/overlay";
import { cn } from "../components/cn";
import { useFlag } from "../lib/flags";
import { netKind, updateStatus } from "../lib/offline/updatePolicy";
import { EventBundles, useEventOptions } from "../components/offline/EventBundles";
import { UpdateModeToggle, UpdateNetworkToggle, connectionNote, useConnection, useUpdatePrefs } from "../components/offline/UpdateSettings";
import { useMinuteNow } from "../components/offline/Snapshot";
import { bundleFinished, type BundleManifest } from "../shared/eventBundle";

const bundles = () => import("../lib/offline/bundles");
type Choice = "event" | "season" | "whole";

export default function DownloadPage() {
  useTitle("Offline");
  const rulesOn = useFlag("rulesReference");
  const [sp, setSp] = useSearchParams();
  const [m, setM] = useState<PackManifest | null>(null);
  const [err, setErr] = useState<ManifestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState<PackMeta | null>(packStatus());
  const { network } = useUpdatePrefs();
  const connection = useConnection();
  const pickParam = sp.get("pick");
  const pick: Choice = pickParam === "event" || pickParam === "season" || pickParam === "whole" ? pickParam : sp.get("event") ? "event" : "whole";
  const choose = (p: Choice) => { const q = new URLSearchParams(sp); q.set("pick", p); setSp(q, { replace: true }); };
  // Wi-Fi only on mobile data: opening the page doesn't fetch the lite pack either (Download does). Only
  // that: Data Saver or a slow link still fetches here, as before (the visit asks for it).
  const liteOk = !(network === "wifi" && netKind(connection) === "cellular");
  useEffect(() => {
    setErr(null);
    fetchManifest().then(setM, (e) => setErr(e instanceof ManifestError ? e : new ManifestError("failed", e.message)));
  }, [attempt]);
  useEffect(() => {
    // A newer pack was saved (maybe newer than the manifest this page read), or deleted: show it, and re-read the manifest.
    const onChange = () => { setLocal(packStatus()); setAttempt((n) => n + 1); };
    window.addEventListener(PACK_EVENT, onChange);
    return () => window.removeEventListener(PACK_EVENT, onChange);
  }, []);
  const netRef = useRef(network);
  netRef.current = network;
  // Opening the page gets the lite pack (re-checked right before the download, the connection may change).
  useEffect(() => {
    if (!m?.lite || local?.version === m.version || !liteOk) return;
    void syncLite({ allowed: () => !(netRef.current === "wifi" && netKind((navigator as Navigator & { connection?: ConnectionInfo }).connection) === "cellular") });
  }, [m, local?.version, liteOk]);

  return (
    <div>
      <PageHeader title="Offline" description="Save Control Scout's data on this device, and it works at a meet with no Wi-Fi and no signal." />
      {err ? (<>
        <EmptyState
          icon={err.reason === "none" ? HardDriveDownload : WifiOff}
          title={err.reason === "none" ? "No packs yet" : err.reason === "paused" ? "Offline packs are paused" : "Couldn't check for packs"}
          description={err.message}
          action={err.reason !== "none" ? <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw /> Try again</Button> : undefined}
        />
        {/* Event packs are built on request (/api/bundles): they don't need the season packs' list. */}
        <div className="mt-4"><EventBundles showSaved={false} /></div>
      </>) : !m ? <div className="skeleton h-48 rounded-2xl" /> : (
        <>
          <Choices m={m} pick={pick} onPick={choose} local={local} />
          <div className="mt-3" data-pick-panel={pick}>
            {pick === "event" ? <EventBundles showSaved={false} />
              : pick === "season" ? <SeasonsSection m={m} />
              : <WholeSeason m={m} local={local} />}
          </div>
        </>
      )}
      <OnDevice m={m} local={local} />
      {m && <UpdatePrefs />}
      <section className="mt-8 max-sm:mt-5" aria-labelledby="how-title">
        <h2 id="how-title" className="font-display text-lg font-semibold">How offline works</h2>
        <ol className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <li className="rounded-xl border border-border bg-card p-4"><HardDriveDownload className="mb-2 size-5 text-accent" /><span className="text-foreground">Before the meet</span>, on Wi-Fi, save the event or the season. If the connection drops, the download picks up where it stopped. Nothing is kept until the whole file checks out.</li>
          <li className="rounded-xl border border-border bg-card p-4"><WifiOff className="mb-2 size-5 text-accent" /><span className="text-foreground">At the meet</span>, with no connection, team pages, event pages and search answer from what you saved, marked "Offline" with the time the data is from. <Link to="/predict?mode=match" className="underline">Predictions</Link> use every team's ratings, saved with the season.</li>
          <li className="rounded-xl border border-border bg-card p-4"><CheckCircle2 className="mb-2 size-5 text-accent" /><span className="text-foreground">Updates</span> are checked in the background. Until a new copy checks out, the saved one keeps working. Scouting notes work offline too and sync when you're back online{rulesOn ? <>, and the <Link to="/rules" className="underline">rules quick reference</Link> is built in</> : null}.</li>
        </ol>
      </section>
      {m && <p className="mt-4 font-mono text-[11px] text-muted-foreground">Manifest: <a href="/packs/latest.json" className="underline">/packs/latest.json</a> · engine v{m.engineVersion} · {dataFrom(m.dataAsOf ?? m.builtAt).toLowerCase()}</p>}
    </div>
  );
}

/** ", 2023–24 to 2026–27" (or one season) for the seasons a pack covers; nothing for none (a pack built before any ratings). */
export const seasonSpan = (seasons: number[]) => !seasons.length ? "" : seasons.length === 1 ? `, ${seasonLabel(seasons[0])}` : `, ${seasonLabel(Math.min(...seasons))} to ${seasonLabel(Math.max(...seasons))}`;

/** What a pack costs to download (the .gz twin when there is one). */
const transferBytes = (f: PackFile) => transferOf(f).bytes;
const currentFile = (m: PackManifest, season: number) => m.full.find((f) => f.kind === "full" && f.seasons.length === 1 && f.seasons[0] === season)
  ?? [...m.full].filter((f) => f.kind === "full" && f.seasons.length === 1).sort((a, b) => b.seasons[0] - a.seasons[0])[0] ?? null;

/** "12.4 MB of 44.4 MB" and a bar, for a download going now. */
function Downloading({ a, label }: { a: ActiveDownload; label: string }) {
  return (
    <div role="status" className="min-w-0">
      <Progress value={Math.min(100, (a.done / Math.max(1, a.total)) * 100)} aria-label={label} />
      <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">{label}… {fmtBytes(a.done)} of {fmtBytes(a.total)}</p>
    </div>
  );
}

/** The three choices, each with what it costs to download. */
function Choices({ m, pick, onPick, local }: { m: PackManifest; pick: Choice; onPick: (p: Choice) => void; local: PackMeta | null }) {
  const season = useCurrentSeason();
  const options = useEventOptions();
  const first = options[0] ?? null;
  const [eventBytes, setEventBytes] = useState<{ key: string; bytes: number } | null>(null);
  const eventKey = first ? `${first.season}:${first.code}` : "";
  useEffect(() => {
    if (!first) return;
    let live = true;
    // The event data alone (no team's reports, no pick list): what the event pack costs at least.
    void bundles().then((b) => b.fetchBundleManifest({ season: first.season, code: first.code, team: null, workspace: null }))
      .then((bm) => { if (live) setEventBytes({ key: eventKey, bytes: bm.bytes }); }, () => {});
    return () => { live = false; };
  }, [eventKey]);
  const singles = m.full.filter((f) => f.kind === "full" && f.seasons.length === 1);
  const sizes = singles.map(transferBytes);
  const cur = currentFile(m, season);
  const whole = (cur ? transferBytes(cur) : 0) + (m.lite && local?.version !== m.version ? m.lite.bytes : 0);
  const choices: { id: Choice; icon: typeof Trophy; title: string; line: string; size: string }[] = [
    { id: "event", icon: Trophy, title: "This event", line: first ? first.name : "Your team's next event", size: eventBytes?.key === eventKey ? fmtBytes(eventBytes.bytes) : first ? "…" : "" },
    { id: "season", icon: CalendarDays, title: "A season", line: singles.length ? `${singles.length} seasons to pick from` : "None published", size: sizes.length ? (sizes.length === 1 ? fmtBytes(sizes[0]) : `${fmtBytes(Math.min(...sizes))} to ${fmtBytes(Math.max(...sizes))}`) : "" },
    { id: "whole", icon: Layers, title: "Whole current season", line: `${seasonLabel(cur?.seasons[0] ?? season)}: every event, team and prediction`, size: fmtBytes(whole) },
  ];
  return (
    <div role="radiogroup" aria-label="What to save" className="grid gap-2 sm:grid-cols-3">
      {choices.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} onClick={() => onPick(c.id)} data-choice={c.id}
          className={cn("flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex-col sm:items-start sm:gap-1.5 sm:p-4",
            pick === c.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent/50")}>
          <c.icon className={cn("size-5 shrink-0", pick === c.id ? "text-accent" : "text-muted-foreground")} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{c.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{c.line}</span>
          </span>
          {c.size && <span className="shrink-0 text-sm font-semibold tabular-nums sm:mt-1">{c.size}</span>}
        </button>
      ))}
    </div>
  );
}

/** The current season's pack plus every team's ratings: one button for both. */
function WholeSeason({ m, local }: { m: PackManifest; local: PackMeta | null }) {
  const season = useCurrentSeason();
  const saved = useSavedSeasons();
  const active = useActiveDownloads();
  const { busy, queue } = useSeasonBatch();
  const [running, setRunning] = useState(false);
  const file = currentFile(m, season);
  const have = file ? saved.find((s) => s.season === file.seasons[0]) : undefined;
  const seasonNeeded = !!file && have?.sha256 !== file.sha256;
  const liteNeeded = !!m.lite && local?.version !== m.version;
  const total = (seasonNeeded && file ? transferBytes(file) : 0) + (liteNeeded && m.lite ? m.lite.bytes : 0);
  const label = seasonLabel(file?.seasons[0] ?? season);
  const go = async () => {
    setRunning(true);
    try {
      if (seasonNeeded && file) {
        const r = await runSeasonBatch([file], m);
        if (!r) { toast.error("Another download is running. Try again when it's done."); return; }
        if (r.failed[0]) { toast.error(r.failed[0].error.message); return; }
      }
      if (liteNeeded) {
        const meta = await syncLite();
        if (meta?.version !== m.version) { toast.error("The predictions pack didn't download. Try again."); return; }
      }
      toast.success(`${label} season saved on this device`, { description: "Team pages, event pages, search and predictions now work with no connection." });
    } finally { setRunning(false); }
  };
  const seasonActive = file ? active[`season:${file.seasons[0]}`] : undefined;
  const liteActive = active["lite:lite"];
  const parts = [
    file && { key: "season", name: `${label} season`, what: "Every event, team, match, ranking and award", bytes: transferBytes(file), onDevice: file.bytes, done: !seasonNeeded, a: seasonActive },
    m.lite && { key: "lite", name: "Predictions for every team", what: `Ratings${seasonSpan(m.lite.seasons)}`, bytes: m.lite.bytes, onDevice: m.lite.bytes, done: !liteNeeded, a: liteActive },
  ].filter(Boolean) as { key: string; name: string; what: string; bytes: number; onDevice: number; done: boolean; a?: ActiveDownload }[];
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-6" aria-labelledby="whole-title">
      <h2 id="whole-title" className="font-display text-lg font-semibold">Whole {label} season</h2>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border" aria-label="In this download">
        {parts.map((p) => (
          <li key={p.key} className="grid gap-2 px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.what} · {fmtBytes(p.onDevice)} on this device</p>
              </div>
              {p.done ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" />Saved</span>
                : <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtBytes(p.bytes)}</span>}
            </div>
            {p.a && <Downloading a={p.a} label="Downloading" />}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {total > 0
          ? <Button size="lg" className="w-full sm:w-auto" onClick={() => void go()} disabled={running || busy != null || queue.length > 0} data-whole-download>
              {running ? <Loader2 className="animate-spin" /> : <HardDriveDownload />} Download · {fmtBytes(total)}
            </Button>
          : <p className="inline-flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" />All of {label} is on this device and current.</p>}
      </div>
    </section>
  );
}

/**
 * The seasons, as a list: what's on this device, what has a newer release, what isn't saved; with Download all
 * and Update all. Saving runs one season at a time (each is MBs), whether started from a row or in bulk.
 */
function SeasonsSection({ m }: { m: PackManifest }) {
  const saved = useSavedSeasons();
  const currentSeason = useCurrentSeason();
  const plan = planSeasons(m.full, saved);
  const { mode, network } = useUpdatePrefs();
  const connection = useConnection();
  const active = useActiveDownloads();
  // The save run is the app's, not this page's (lib/offline/seasonBatch): its progress survives leaving and
  // coming back, and a second run can't start beside it.
  const { busy, queue } = useSeasonBatch();

  const run = async (rows: SeasonRow[], bulk: string | null) => {
    const r = await runSeasonBatch(rows.map((x) => x.file), m);
    if (!r) return; // already saving
    if (!bulk) {
      if (r.saved.length) toast.success(`${seasonLabel(r.saved[0])} saved on this device`, { description: "Its team and event pages now work with no connection." });
      else if (r.failed[0]) toast.error(r.failed[0].error.message);
    } else if (r.failed.length) {
      toast.error(`${bulk}: ${r.saved.length} of ${rows.length} saved. Couldn't save ${r.failed.map((f) => seasonLabel(f.season)).join(", ")}; try again.`);
    } else toast.success(`${bulk}: ${r.saved.length} ${r.saved.length === 1 ? "season" : "seasons"} saved on this device`);
  };
  const working = busy != null || queue.length > 0;
  const sum = (rows: SeasonRow[]) => rows.reduce((n, r) => n + transferBytes(r.file), 0);

  return (
    <section className="rounded-2xl border border-border bg-card" aria-labelledby="seasons-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4 sm:p-6">
        <div className="min-w-0 max-w-2xl">
          <h2 id="seasons-title" className="font-display text-lg font-semibold">Pick a season</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every event, team, match, ranking, alliance and award of the season{m.dataAsOf ? `, results up to ${dayDate(m.dataAsOf)}` : ""}. The size on each button is the download.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
            <span><span className="font-semibold tabular-nums">{plan.savedCount}</span> of {plan.rows.length} saved</span>
            {plan.toUpdate.length > 0 && <span className="inline-flex items-center gap-1 text-warning"><RefreshCw className="size-3.5" />{plan.toUpdate.length} {plan.toUpdate.length === 1 ? "update" : "updates"} available</span>}
          </p>
          {plan.savedCount > 0 && <p className="mt-1.5 text-xs text-muted-foreground" data-update-status>{updateStatus(mode, network, connection)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.toUpdate.length > 0 && (
            <Button variant="secondary" onClick={() => void run(plan.toUpdate, "Update all")} disabled={working}>
              <RefreshCw /> Update all ({plan.toUpdate.length})
            </Button>
          )}
          {plan.toDownload.length > 0 && (
            <Button onClick={() => void run(plan.toDownload, "Download all")} disabled={working}>
              <HardDriveDownload /> Download all · {fmtBytes(sum(plan.toDownload))}
            </Button>
          )}
          {!plan.toUpdate.length && !plan.toDownload.length && plan.rows.length > 0 && (
            <span className="inline-flex h-11 items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" /> Every season is saved and current</span>
          )}
        </div>
      </div>
      {!plan.rows.length ? <p className="p-6 max-sm:p-4 text-sm text-muted-foreground">No season packs in this release.</p> : (
        <ul className="divide-y divide-border" aria-label="Seasons">
          {plan.rows.map((r) => (
            <SeasonRowView key={r.file.name} r={r} version={m.version} dataAsOf={m.dataAsOf ?? m.builtAt} current={r.season === currentSeason}
              active={busy?.season === r.season ? active[`season:${r.season}`] ?? { owner: { kind: "season", id: String(r.season), label: "" }, done: 0, total: transferBytes(r.file) } : null}
              queued={queue.includes(r.season)} disabled={working} onSave={() => void run([r], null)} />
          ))}
        </ul>
      )}
    </section>
  );
}

const STATE_CHIP: Record<SeasonRow["state"], { label: string; cls: string }> = {
  update: { label: "Update available", cls: "border-warning/40 bg-warning/10 text-warning" },
  saved: { label: "Saved", cls: "border-success/40 bg-success/10 text-success" },
  available: { label: "Not saved", cls: "border-border text-muted-foreground" },
};

/** One season: its status, sizes and release, and Download / Update (with progress while saving). The raw file stays a small link for analysts. */
function SeasonRowView({ r, version, dataAsOf, current, active, queued, disabled, onSave }: {
  r: SeasonRow; version: string; dataAsOf: string; current: boolean; active: ActiveDownload | null; queued: boolean; disabled: boolean; onSave: () => void;
}) {
  const label = seasonLabel(r.season);
  const chip = STATE_CHIP[r.state];
  return (
    <li className="grid items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:px-6">
      <div className="flex flex-wrap items-center gap-2 sm:block">
        <p className="font-display text-lg font-semibold tabular-nums">{label}</p>
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium sm:mt-1", chip.cls)}>{chip.label}</span>
        {current && <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text sm:ml-1 sm:mt-1">This season</span>}
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {active ? <Downloading a={active} label={`Saving ${label}`} />
          : queued ? <p>Waiting to save…</p> : (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span><span className="text-foreground tabular-nums">{fmtBytes(r.file.bytes)}</span> on this device</span>
            <span>Version {version}</span>
            {r.saved && r.state === "update" && <span>{whatChanged(r.saved, { dataAsOf, stats: r.file.stats })}</span>}
            {/* The full hash on a tap too (a title needs a mouse), to check a download against. */}
            <TapTooltip className="max-w-72 break-all font-mono" trigger={<button type="button" className="tap-44 cursor-pointer font-mono underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`SHA-256 ${r.file.sha256}`}>SHA-256 {r.file.sha256.slice(0, 12)}…</button>}>
              SHA-256 {r.file.sha256}
            </TapTooltip>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {r.state !== "saved" && !active && !queued && <Button className="max-sm:h-11" variant={r.state === "update" ? "secondary" : "default"} onClick={onSave} disabled={disabled}><HardDriveDownload /> {r.state === "update" ? "Update" : "Download"} · {fmtBytes(transferBytes(r.file))}</Button>}
        <a href={r.file.url} download className="tap-44 inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" title="The raw SQLite file, for your own analysis">
          <Database className="size-3.5" />SQLite
        </a>
      </div>
    </li>
  );
}

/**
 * Everything on this device: half downloads ("Paused at 40%", never as saved), then every pack with its size
 * here, when its data is from, what a newer release brings, Update and Delete. One total, and the browser's
 * own figure for the whole site.
 */
function OnDevice({ m, local }: { m: PackManifest | null; local: PackMeta | null }) {
  const saved = useSavedSeasons();
  const savedBundles = useSavedBundles();
  const partials = usePartials();
  const active = useActiveDownloads();
  const { busy, queue } = useSeasonBatch();
  const now = useMinuteNow();
  const packsOn = useFlag("offlinePacks");
  const bundlesOn = useFlag("eventBundle") && packsOn;
  const items = useMemo(() => deviceItems(local, saved, savedBundles), [local, saved, savedBundles]);
  const paused = pausedItems(partials, new Set(Object.keys(active)));
  const total = totalBytes(items, paused);
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  useEffect(() => { navigator.storage?.estimate?.().then(setEst, () => setEst({})); }, [total]);
  const [working, setWorking] = useState<string | null>(null);
  const seasonRun = busy != null || queue.length > 0;

  // Newer event packs: asked once per look, like the season packs' manifest.
  const [latest, setLatest] = useState<Record<string, BundleManifest>>({});
  const bundleKey = savedBundles.map((b) => `${b.season}:${b.code}@${b.version}`).join(",");
  useEffect(() => {
    if (!bundlesOn) { setLatest({}); return; }
    let live = true;
    void bundles().then(async (b) => {
      for (const s of savedBundles) {
        if (bundleFinished(s)) continue;
        const bm = await b.fetchBundleManifest(b.requestOf(s)).catch(() => null);
        if (live && bm) setLatest((x) => ({ ...x, [`${s.season}:${s.code}`]: bm }));
      }
    });
    return () => { live = false; };
  }, [bundleKey, bundlesOn]);

  const freed = (what: string, bytes: number) => toast.success(`Freed ${fmtBytes(bytes)}`, { description: `${what} deleted from this device.` });
  const act = async (key: string, fn: () => Promise<void>) => {
    setWorking(key);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setWorking(null); }
  };

  const update = (it: DeviceItem) => act(it.key, async () => {
    if (it.kind === "lite") { await syncLite(); return; }
    if (it.kind === "season" && m) {
      const f = currentFile(m, it.season!);
      if (!f || f.seasons[0] !== it.season) return;
      const r = await runSeasonBatch([f], m, { replaceOnly: true });
      if (r?.failed[0]) throw r.failed[0].error;
      if (r?.saved.length) toast.success(`${it.label} updated`);
      return;
    }
    if (it.kind === "bundle" && it.bundle) {
      const b = await bundles();
      await b.downloadBundle(b.requestOf(it.bundle), undefined, latest[`${it.bundle.season}:${it.bundle.code}`]);
      toast.success(`${it.label} updated`);
    }
  });
  const remove = (it: DeviceItem) => act(it.key, async () => {
    const n = it.kind === "lite" ? await (await import("../lib/packs")).removeLite()
      : it.kind === "season" ? await removeSeason(it.season!)
      : await (await bundles()).removeBundle(it.bundle!.season, it.bundle!.code);
    freed(it.label, n || it.bytes);
  });
  const resume = (p: PausedItem) => act(p.key, async () => {
    if (p.kind === "lite") { await syncLite(); return; }
    const f = m && currentFile(m, Number(p.partial.owner.id));
    if (!m || !f || f.seasons[0] !== Number(p.partial.owner.id)) throw new Error("This season isn't offered any more. Delete the paused download.");
    const r = await runSeasonBatch([f], m);
    if (r?.failed[0]) throw r.failed[0].error;
    if (r?.saved.length) toast.success(`${p.label} saved on this device`);
  });
  const drop = (p: PausedItem) => act(p.key, async () => { await dropPartial(p.partial.sha256); freed(`The paused ${p.label} download`, p.have); });

  /** Plain words for a newer release of this pack, or null when it's current (or nothing says). */
  const newer = (it: DeviceItem): string | null => {
    if (it.kind === "lite") return m?.lite && local && local.version !== m.version ? `Ratings updated · ${whatChanged({ dataAsOf: it.dataAsOf }, { dataAsOf: m.dataAsOf, builtAt: m.builtAt }, new Date(now))}` : null;
    if (it.kind === "season" && m) {
      const f = currentFile(m, it.season!);
      const s = saved.find((x) => x.season === it.season) as SavedSeason;
      return f && f.seasons[0] === it.season && f.sha256 !== s.sha256 ? whatChanged(s, { dataAsOf: m.dataAsOf, builtAt: m.builtAt, stats: f.stats }, new Date(now)) : null;
    }
    if (it.kind === "bundle" && it.bundle) {
      const bm = latest[`${it.bundle.season}:${it.bundle.code}`];
      return bm && bm.version !== it.bundle.version ? whatChanged({ dataAsOf: it.dataAsOf }, { dataAsOf: bm.dataAsOf, builtAt: bm.builtAt }, new Date(now)) : null;
    }
    return null;
  };

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card max-sm:mt-5" aria-labelledby="device-title" data-on-device>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border p-4 sm:px-6">
        <h2 id="device-title" className="font-display text-lg font-semibold">On this device</h2>
        <p className="text-sm tabular-nums text-muted-foreground" data-device-total>{items.length || paused.length ? <>Packs use <span className="font-semibold text-foreground">{fmtBytes(total)}</span></> : "Nothing saved yet"}</p>
      </div>
      {(items.length > 0 || paused.length > 0) && (
        <ul className="divide-y divide-border" aria-label="Saved on this device">
          {paused.map((p) => (
            <li key={`paused:${p.key}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6" data-paused>
              <div className="min-w-0">
                <p className="font-medium">{p.label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-warning"><Pause className="size-3.5" />Paused at {p.pct}% · <span className="tabular-nums">{fmtBytes(p.have)} of {fmtBytes(p.total)}</span> · not saved yet</p>
              </div>
              <div className="flex gap-2">
                <Button className="h-11 sm:h-10" variant="secondary" onClick={() => void resume(p)} disabled={working != null || (p.kind === "season" && seasonRun) || !m}><HardDriveDownload /> Resume</Button>
                <Button className="h-11 sm:h-10" variant="outline" onClick={() => void drop(p)} disabled={working != null} aria-label={`Delete the paused ${p.label} download`}><Trash2 /> Delete</Button>
              </div>
            </li>
          ))}
          {items.map((it) => {
            const a = it.kind === "lite" ? active["lite:lite"] : it.kind === "season" ? active[`season:${it.season}`] : it.bundle ? active[`bundle:${it.bundle.season}:${it.bundle.code.toUpperCase()}`] : undefined;
            const change = newer(it);
            const over = it.bundle && bundleFinished(it.bundle, new Date(now));
            const busyHere = working === it.key || !!a;
            return (
              <li key={it.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6" data-device-item={it.kind}>
                <div className="min-w-0">
                  <p className="font-medium">{it.bundle ? <Link to={`/bundle/${it.bundle.season}/${encodeURIComponent(it.bundle.code)}`} className="hover:text-accent">{it.label}</Link> : it.label}
                    {it.kind === "bundle" && <span className="ml-2 text-xs font-normal text-muted-foreground">Event pack{over ? " · event over" : ""}</span>}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">{fmtBytes(it.bytes)}</span>
                    <span className="tabular-nums">{dataFrom(it.dataAsOf, new Date(now))}</span>
                  </p>
                  {change && !a && <p className="mt-1 flex items-start gap-1.5 text-xs text-warning" data-newer><RefreshCw className="mt-px size-3.5 shrink-0" />{change}</p>}
                  {a && <div className="mt-2"><Downloading a={a} label="Updating" /></div>}
                </div>
                <div className="flex gap-2">
                  {change && <Button className="h-11 sm:h-10" variant="secondary" onClick={() => void update(it)} disabled={busyHere || working != null || (it.kind === "season" && seasonRun)}><RefreshCw /> Update</Button>}
                  <Button className="h-11 sm:h-10" variant="outline" onClick={() => void remove(it)} disabled={busyHere || working != null || (it.kind === "season" && seasonRun)} aria-label={`Delete ${it.label}`}><Trash2 /> Delete</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6" data-storage-estimate>
        {est?.usage != null ? `This site uses ${fmtBytes(est.usage)} on this device in all${est.quota ? `, of ${fmtBytes(est.quota)} the browser allows` : ""} (the browser's estimate).` : "The browser doesn't say how much storage this site uses."}
      </p>
    </section>
  );
}

/** The two update settings (synced with your account): ask or download automatically, and on which connections. */
function UpdatePrefs() {
  const { mode, network, setMode, setNetwork } = useUpdatePrefs();
  const connection = useConnection();
  return (
    <div className="mt-4 grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 sm:px-6" aria-label="Update settings" role="group">
      <div className="min-w-0">
        <p className="text-sm font-medium">When updates are out</p>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">Checked in the background. Ask me shows one pop-up per release, and a notification when you're signed in.</p>
        <UpdateModeToggle value={mode} onChange={setMode} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">Download updates on</p>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">{connectionNote(connection)}</p>
        <UpdateNetworkToggle value={network} onChange={setNetwork} />
      </div>
    </div>
  );
}

