// Download: the full season packs (SQLite files with every event, match and
// team of a season). The lite pack that runs predictions offline isn't offered
// here: it downloads itself in the background (LitePackSync); this page only
// shows its status.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Database, HardDriveDownload, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useTitle } from "../lib/meta";
import { ManifestError, PACK_EVENT, fetchManifest, packStatus, syncLite, type PackFile, type PackManifest, type PackMeta } from "../lib/packs";
import { fmtBytes } from "../lib/recordings";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { ago, seasonLabel } from "../lib/format";

export default function DownloadPage() {
  useTitle("Download");
  const [m, setM] = useState<PackManifest | null>(null);
  const [err, setErr] = useState<ManifestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState<PackMeta | null>(packStatus());
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    setErr(null);
    fetchManifest().then(setM, (e) => setErr(e instanceof ManifestError ? e : new ManifestError("failed", e.message)));
  }, [attempt]);
  // The lite pack downloads itself (LitePackSync); this page just nudges it and shows where it's at.
  useEffect(() => {
    const onChange = () => setLocal(packStatus());
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
      <PageHeader title="Download" description="Offline predictions are automatic. Full season packs are SQLite files for your own analysis." />
      {err ? (
        <EmptyState
          icon={err.reason === "none" ? HardDriveDownload : WifiOff}
          title={err.reason === "none" ? "No packs yet" : "Couldn't check for packs"}
          description={<>
            {err.message}
            {local && <span className="mt-2 block">Already on this device: lite pack {local.version}, saved {ago(new Date(local.savedAt).toISOString())}. Offline predictions use it.</span>}
          </>}
          action={err.reason !== "none" ? <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}><RefreshCw /> Try again</Button> : undefined}
        />
      ) : !m ? <div className="skeleton h-48 rounded-2xl" /> : (
        <>
          <LiteStatus local={local} m={m} syncing={syncing} />
          <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-display text-xl font-semibold">Full season packs</h2>
              <p className="mt-1 text-sm text-muted-foreground">One SQLite file per season with every event, team, match (scores and breakdowns, penalties, alliances), ranking, award and advancement list. Open them with any SQLite tool — great for your own analysis.</p>
              {!m.full.length ? <p className="mt-4 text-sm text-muted-foreground">No full packs in this release.</p> : (
                <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {m.full.map((f) => (
                    <li key={f.name} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{f.seasons.map(seasonLabel).join(", ")}</p>
                        <Button variant="secondary" size="sm" asChild><a href={f.url} download><Database /> {fmtBytes(f.bytes)}</a></Button>
                      </div>
                      <PackFacts f={f} builtAt={m.builtAt} compact />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          <Section title="How offline mode works" className="mt-8">
            <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-card p-4"><WifiOff className="mb-2 size-5 text-accent" /><span className="text-foreground">Nothing to save</span>: whenever you open Control Scout online, it keeps a small lite pack of every team's ratings in this browser, checked against its published SHA-256.</li>
              <li className="rounded-xl border border-border bg-card p-4"><HardDriveDownload className="mb-2 size-5 text-accent" /><span className="text-foreground">At the venue</span>, the <Link to="/predict?mode=match" className="underline">what-if lab</Link> falls back to the pack when the server can't be reached — same engine, same numbers as of the pack's date.</li>
              <li className="rounded-xl border border-border bg-card p-4"><CheckCircle2 className="mb-2 size-5 text-accent" /><span className="text-foreground">Updates</span> happen on their own: when a newer pack is published, the next visit fetches it in the background. Scouting notes keep working offline too and sync when you're back online.</li>
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
      {current ? <CheckCircle2 className="size-4 text-success" /> : syncing ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <WifiOff className="size-4 text-muted-foreground" />}
      {current
        ? <span>Offline predictions are ready on this device: lite pack {local!.version}, saved automatically {ago(new Date(local!.savedAt).toISOString())}.</span>
        : syncing
          ? <span>Getting offline predictions ready on this device ({local ? `updating ${local.version} → ${m.version}` : fmtBytes(m.lite.bytes)})…</span>
          : <span>Offline predictions aren't on this device yet. They download on their own next time you're online{local ? ` (you have ${local.version})` : ""}.</span>}
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
