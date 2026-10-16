// Download: save whole seasons on this device, so team and event pages and
// search work with no wifi (lib/offline). Each season is a full pack (every
// event, match and team of the season in one SQLite file, still offered as a
// plain file for analysts). The lite pack that runs predictions offline isn't
// offered here: it downloads itself in the background for returning visitors
// (LitePackSync, packPolicy.ts), and opening this page fetches it at once; this
// page only shows its status.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Database, HardDriveDownload, Loader2, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { useTitle } from "../lib/meta";
import { ManifestError, PACK_EVENT, fetchManifest, packStatus, syncLite, type PackFile, type PackManifest, type PackMeta } from "../lib/packs";
import { removeSeason, saveSeason, useSavedSeasons, type SavedSeason } from "../lib/offline/seasons";
import { fmtBytes } from "../lib/recordings";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { ago, seasonLabel } from "../lib/format";

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
          <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-display text-xl font-semibold">Save seasons for offline use</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each season holds every event, team, match (scores and breakdowns, penalties, lineups), ranking, alliance, award and advancement list.
                Once saved it lives in this browser: team pages, event pages and search keep working at a venue with no wifi, showing the data as it was when the season was published{m.dataAsOf ? ` (this release: results up to ${new Date(m.dataAsOf).toLocaleDateString()})` : ""}.
              </p>
              {!m.full.length ? <p className="mt-4 text-sm text-muted-foreground">No full packs in this release.</p> : (
                <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {m.full.map((f) => <SeasonCard key={f.name} f={f} m={m} saved={f.seasons.length === 1 ? saved.find((x) => x.season === f.seasons[0]) ?? null : null} />)}
                </ul>
              )}
              <StorageLine saved={saved} />
            </section>
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

/** One season: save it on this device (with progress), then update or remove it. The raw file stays a small link for analysts. */
function SeasonCard({ f, m, saved }: { f: PackFile; m: PackManifest; saved: SavedSeason | null }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const label = f.seasons.map(seasonLabel).join(", ");
  // A newer release of the same season: its file (and checksum) changed.
  const stale = !!saved && saved.sha256 !== f.sha256;
  const save = () => {
    setProgress(0);
    saveSeason(f, m, (done, total) => setProgress(total ? Math.min(100, (done / total) * 100) : 0))
      .then(() => toast.success(`${label} saved on this device`, { description: "Its team and event pages now work with no connection." }), (e) => toast.error(e.message))
      .finally(() => setProgress(null));
  };
  const remove = () => {
    if (!saved) return;
    setRemoving(true);
    removeSeason(saved.season).then(() => toast(`${label} removed from this device`), (e) => toast.error(e.message)).finally(() => setRemoving(false));
  };
  return (
    <li className="flex flex-col rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{label}</p>
        {saved && progress == null && (stale
          ? <span className="text-xs text-muted-foreground">Saved copy: {saved.version}</span>
          : <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" />Saved · {fmtBytes(saved.bytes)}</span>)}
      </div>
      <PackFacts f={f} builtAt={m.builtAt} compact />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {progress != null ? (
          <div className="w-full" role="status">
            <Progress value={progress} aria-label={`Saving ${label}`} />
            <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">Saving… {fmtBytes((progress / 100) * f.bytes)} of {fmtBytes(f.bytes)}</p>
          </div>
        ) : (
          <>
            {(!saved || stale) && f.seasons.length === 1 && <Button size="sm" onClick={save}><HardDriveDownload /> {stale ? "Update" : "Save offline"}</Button>}
            {saved && <Button variant="outline" size="sm" onClick={remove} disabled={removing}><Trash2 /> Remove</Button>}
          </>
        )}
        <a href={f.url} download className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" title="The raw SQLite file, for your own analysis">
          <Database className="size-3.5" />SQLite file
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

function PackFacts({ f, builtAt, compact }: { f: PackFile; builtAt: string; compact?: boolean }) {
  return (
    <dl className={compact ? "mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs" : "mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"}>
      <dt className="text-muted-foreground">Released</dt><dd>{new Date(builtAt).toLocaleDateString()}</dd>
      <dt className="text-muted-foreground">Size</dt><dd>{fmtBytes(f.bytes)}</dd>
      <dt className="text-muted-foreground">Seasons</dt><dd>{f.seasons.map(seasonLabel).join(", ")}</dd>
      <dt className="text-muted-foreground">SHA-256</dt><dd className="truncate font-mono" title={f.sha256}>{f.sha256.slice(0, 16)}…</dd>
    </dl>
  );
}
