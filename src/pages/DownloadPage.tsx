// Download: save whole seasons on this device, so team and event pages and
// search work with no wifi (lib/offline). Each season is a full pack (every
// event, match and team of the season in one SQLite file, still offered as a
// plain file for analysts). The lite pack that runs predictions offline isn't
// offered here: it downloads itself in the background for returning visitors
// (LitePackSync, packPolicy.ts), and opening this page fetches it at once; this
// page only shows its status.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Database, HardDriveDownload, Loader2, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { useTitle } from "../lib/meta";
import { ManifestError, PACK_EVENT, fetchManifest, packStatus, syncLite, type PackManifest, type PackMeta } from "../lib/packs";
import { removeSeason, saveSeason, useSavedSeasons, type SavedSeason } from "../lib/offline/seasons";
import { bytesOf, planSeasons, type SeasonRow } from "../lib/offline/seasonPlan";
import { fmtBytes } from "../lib/recordings";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { ago, seasonLabel } from "../lib/format";
import { cn } from "../components/cn";

export default function DownloadPage() {
  useTitle("Download");
  const [m, setM] = useState<PackManifest | null>(null);
  const [err, setErr] = useState<ManifestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState<PackMeta | null>(packStatus());
  const [syncing, setSyncing] = useState(false);
  const saved = useSavedSeasons();
  useEffect(() => {
    setErr(null);
    fetchManifest().then(setM, (e) => setErr(e instanceof ManifestError ? e : new ManifestError("failed", e.message)));
  }, [attempt]);
  // The lite pack downloads itself (LitePackSync); this page just nudges it and shows where it's at.
  useEffect(() => {
    // A newer pack was saved (maybe newer than the manifest this page read): show it, and re-read the manifest.
    const onChange = () => { setLocal(packStatus()); setAttempt((n) => n + 1); };
    window.addEventListener(PACK_EVENT, onChange);
    return () => window.removeEventListener(PACK_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (!m?.lite || local?.version === m.version) return;
    setSyncing(true);
    syncLite().then((meta) => { setLocal(meta); setSyncing(false); });
  }, [m, local?.version]);
  return (
    <div>
      <PageHeader title="Download" description="Save a season on this device and its team pages, event pages and search work with no wifi. Offline predictions are automatic." />
      {err ? (
        <EmptyState
          icon={err.reason === "none" ? HardDriveDownload : WifiOff}
          title={err.reason === "none" ? "No packs yet" : err.reason === "paused" ? "Offline packs are paused" : "Couldn't check for packs"}
          description={<>
            {err.message}
            {local && <span className="mt-2 block">Already on this device: lite pack {local.version}, saved {ago(new Date(local.savedAt).toISOString())}. Offline predictions use it.</span>}
            {saved.length > 0 && <span className="mt-2 block">Saved seasons on this device: {saved.map((x) => `${seasonLabel(x.season)} (${fmtBytes(x.bytes)})`).join(", ")}. Their team and event pages work offline.</span>}
          </>}
          action={err.reason !== "none" ? <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw /> Try again</Button> : undefined}
        />
      ) : !m ? <div className="skeleton h-48 rounded-2xl" /> : (
        <>
          <LiteStatus local={local} m={m} syncing={syncing} />
          <SeasonsSection m={m} saved={saved} />
          <Section title="How offline mode works" className="mt-8">
            <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-card p-4"><HardDriveDownload className="mb-2 size-5 text-accent" /><span className="text-foreground">Before the event</span>, on wifi, save the season above. It's checked against its published SHA-256 and kept in this browser. Predictions need nothing: a small lite pack of every team's ratings saves itself whenever you're online.</li>
              <li className="rounded-xl border border-border bg-card p-4"><WifiOff className="mb-2 size-5 text-accent" /><span className="text-foreground">At the venue</span>, with no connection, team pages, event pages (rankings, matches, alliances, awards) and search answer from the saved season, marked "Offline" with the date the data is from. Upcoming matches and the <Link to="/predict?mode=match" className="underline">what-if lab</Link> get win odds from the lite pack: same engine, ratings as of the pack's date.</li>
              <li className="rounded-xl border border-border bg-card p-4"><CheckCircle2 className="mb-2 size-5 text-accent" /><span className="text-foreground">Updates</span>: the lite pack updates on its own. A saved season shows <span className="text-foreground">Update</span> here when a newer release is out. Remove seasons here or in Settings › Offline data. Scouting notes keep working offline too and sync when you're back online.</li>
            </ol>
          </Section>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">Manifest: <a href="/packs/latest.json" className="underline">/packs/latest.json</a> · engine v{m.engineVersion} · data as of {m.dataAsOf ? new Date(m.dataAsOf).toLocaleString() : "—"}</p>
        </>
      )}
    </div>
  );
}

function LiteStatus({ local, m, syncing }: { local: PackMeta | null; m: PackManifest; syncing: boolean }) {
  if (!m.lite) return null;
  const current = local?.version === m.version;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm" role="status">
      {current || (local && !syncing) ? <CheckCircle2 className="size-4 text-success" /> : syncing ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <WifiOff className="size-4 text-muted-foreground" />}
      {current
        ? <span>Offline predictions are ready on this device: lite pack {local!.version}, saved automatically {ago(new Date(local!.savedAt).toISOString())}.</span>
        : syncing
          ? <span>Getting offline predictions ready on this device ({local ? `updating ${local.version} → ${m.version}` : fmtBytes(m.lite.bytes)})…</span>
          : local
            ? <span>Offline predictions work on this device from lite pack {local.version}. Version {m.version} downloads on its own next time you're online.</span>
            : <span>Offline predictions aren't on this device yet. They download on their own next time you're online.</span>}
    </p>
  );
}

/**
 * The seasons, as a list: what's on this device, what has a newer release, what isn't saved; with Download all
 * and Update all. Saving runs one season at a time (each is tens of MB), whether started from a row or in bulk.
 */
function SeasonsSection({ m, saved }: { m: PackManifest; saved: SavedSeason[] }) {
  const plan = planSeasons(m.full, saved);
  // The season being saved now and its progress (0–100), and the ones waiting behind it.
  const [busy, setBusy] = useState<{ season: number; pct: number } | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [removing, setRemoving] = useState<number | null>(null);
  const running = useRef(false);

  const run = async (rows: SeasonRow[], bulk: string | null) => {
    if (running.current || !rows.length) return;
    running.current = true;
    setQueue(rows.map((r) => r.season));
    const failed: string[] = [];
    let done = 0;
    for (const r of rows) {
      setQueue((q) => q.filter((x) => x !== r.season));
      setBusy({ season: r.season, pct: 0 });
      try {
        await saveSeason(r.file, m, (got, total) => setBusy({ season: r.season, pct: total ? Math.min(100, (got / total) * 100) : 0 }));
        done++;
        if (!bulk) toast.success(`${seasonLabel(r.season)} saved on this device`, { description: "Its team and event pages now work with no connection." });
      } catch (e) {
        failed.push(seasonLabel(r.season));
        if (!bulk) toast.error((e as Error).message);
      }
    }
    setBusy(null); setQueue([]); running.current = false;
    if (bulk) {
      if (failed.length) toast.error(`${bulk}: ${done} of ${rows.length} saved. Couldn't save ${failed.join(", ")}; try again.`);
      else toast.success(`${bulk}: ${done} ${done === 1 ? "season" : "seasons"} saved on this device`);
    }
  };
  const remove = (season: number) => {
    setRemoving(season);
    removeSeason(season).then(() => toast(`${seasonLabel(season)} removed from this device`), (e) => toast.error(e.message)).finally(() => setRemoving(null));
  };
  const working = busy != null || queue.length > 0;

  return (
    <section className="rounded-2xl border border-border bg-card" aria-labelledby="seasons-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
        <div className="min-w-0 max-w-2xl">
          <h2 id="seasons-title" className="font-display text-xl font-semibold">Save seasons for offline use</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each season holds every event, team, match, ranking, alliance, award and advancement list. Saved in this browser, team pages, event pages and search keep working at a venue with no wifi{m.dataAsOf ? ` (this release: results up to ${new Date(m.dataAsOf).toLocaleDateString()})` : ""}.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
            <span><span className="font-semibold tabular-nums">{plan.savedCount}</span> of {plan.rows.length} saved</span>
            {plan.toUpdate.length > 0 && <span className="inline-flex items-center gap-1 text-warning"><RefreshCw className="size-3.5" />{plan.toUpdate.length} {plan.toUpdate.length === 1 ? "update" : "updates"} available</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.toUpdate.length > 0 && (
            <Button variant="secondary" onClick={() => void run(plan.toUpdate, "Update all")} disabled={working}>
              <RefreshCw /> Update all ({plan.toUpdate.length})
            </Button>
          )}
          {plan.toDownload.length > 0 && (
            <Button onClick={() => void run(plan.toDownload, "Download all")} disabled={working}>
              <HardDriveDownload /> Download all · {fmtBytes(bytesOf(plan.toDownload))}
            </Button>
          )}
          {!plan.toUpdate.length && !plan.toDownload.length && plan.rows.length > 0 && (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" /> Every season is saved and current</span>
          )}
        </div>
      </div>
      {!plan.rows.length ? <p className="p-6 text-sm text-muted-foreground">No full packs in this release.</p> : (
        <ul className="divide-y divide-border" aria-label="Seasons">
          {plan.rows.map((r) => (
            <SeasonRowView key={r.file.name} r={r} builtAt={m.builtAt}
              progress={busy?.season === r.season ? busy.pct : null} queued={queue.includes(r.season)} disabled={working}
              removing={removing === r.season} onSave={() => void run([r], null)} onRemove={() => remove(r.season)} />
          ))}
        </ul>
      )}
      <div className="border-t border-border px-5 py-3 sm:px-6"><StorageLine saved={saved} /></div>
    </section>
  );
}

const STATE_CHIP: Record<SeasonRow["state"], { label: string; cls: string }> = {
  update: { label: "Update available", cls: "border-warning/40 bg-warning/10 text-warning" },
  saved: { label: "Saved", cls: "border-success/40 bg-success/10 text-success" },
  available: { label: "Not saved", cls: "border-border text-muted-foreground" },
};

/** One season: its status, size and release, and Save / Update / Remove (with progress while saving). The raw file stays a small link for analysts. */
function SeasonRowView({ r, builtAt, progress, queued, disabled, removing, onSave, onRemove }: {
  r: SeasonRow; builtAt: string; progress: number | null; queued: boolean; disabled: boolean; removing: boolean; onSave: () => void; onRemove: () => void;
}) {
  const label = seasonLabel(r.season);
  const chip = STATE_CHIP[r.state];
  return (
    <li className="grid items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:px-6">
      <div className="flex items-center gap-2 sm:block">
        <p className="font-display text-lg font-semibold tabular-nums">{label}</p>
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium sm:mt-1", chip.cls)}>{chip.label}</span>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {progress != null ? (
          <div role="status">
            <Progress value={progress} aria-label={`Saving ${label}`} />
            <p className="mt-1.5 tabular-nums">Saving… {fmtBytes((progress / 100) * r.file.bytes)} of {fmtBytes(r.file.bytes)}</p>
          </div>
        ) : queued ? <p>Waiting to save…</p> : (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="text-foreground tabular-nums">{fmtBytes(r.file.bytes)}</span>
            <span>Released {new Date(builtAt).toLocaleDateString()}</span>
            {r.saved && <span>{r.state === "update" ? `On this device: ${r.saved.version}` : `On this device · ${fmtBytes(r.saved.bytes)}`}</span>}
            <span className="font-mono" title={`SHA-256 ${r.file.sha256}`}>SHA-256 {r.file.sha256.slice(0, 12)}…</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {r.state !== "saved" && <Button size="sm" variant={r.state === "update" ? "secondary" : "default"} onClick={onSave} disabled={disabled}><HardDriveDownload /> {r.state === "update" ? "Update" : "Save offline"}</Button>}
        {r.saved && <Button variant="outline" size="sm" onClick={onRemove} disabled={removing || progress != null}><Trash2 /> Remove</Button>}
        <a href={r.file.url} download className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" title="The raw SQLite file, for your own analysis">
          <Database className="size-3.5" />SQLite
        </a>
      </div>
    </li>
  );
}

/** How much this device holds: the saved seasons, and the site's whole share of storage. */
function StorageLine({ saved }: { saved: SavedSeason[] }) {
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const total = saved.reduce((n, s) => n + s.bytes, 0);
  useEffect(() => { navigator.storage?.estimate?.().then(setEst, () => setEst({})); }, [total]);
  return (
    <p className="mt-4 text-xs text-muted-foreground">
      {saved.length ? `Saved seasons use ${fmtBytes(total)} on this device.` : "No seasons saved on this device yet."}
      {est?.usage != null && ` This site uses ${fmtBytes(est.usage)}${est.quota ? ` of ${fmtBytes(est.quota)} available` : ""} in all.`}
    </p>
  );
}
