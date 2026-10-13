// Download: versioned offline data packs. The lite pack runs predictions on
// this device with no connection; full packs are SQLite files with every
// event, match and team of a season.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Database, Download, HardDriveDownload, Loader2, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { useTitle } from "../lib/meta";
import { ManifestError, downloadLite, fetchManifest, packStatus, removeLite, type PackFile, type PackManifest, type PackMeta } from "../lib/packs";
import { fmtBytes } from "../lib/recordings";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { Progress } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { ago, seasonLabel } from "../lib/format";

export default function DownloadPage() {
  useTitle("Download");
  const [m, setM] = useState<PackManifest | null>(null);
  const [err, setErr] = useState<ManifestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState<PackMeta | null>(packStatus());
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    setErr(null);
    fetchManifest().then(setM, (e) => setErr(e instanceof ManifestError ? e : new ManifestError("failed", e.message)));
  }, [attempt]);
  const getLite = async (f: PackFile) => {
    if (!m) return;
    setProgress(0);
    try { const meta = await downloadLite(f, m, (d, t) => setProgress(t ? d / t : 0)); setLocal(meta); toast.success("Lite pack saved — predictions now work offline"); }
    catch (e: any) { toast.error(e.message); }
    finally { setProgress(null); }
  };
  const outdated = local && m && local.version !== m.version;
  return (
    <div>
      <PageHeader title="Download" description="Take Control Scout to a venue with no signal. Packs are versioned; the app tells you when a newer one is out." />
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
          {outdated && <p className="mb-4 rounded-xl border border-accent/40 bg-accent/[0.06] px-4 py-3 text-sm">New data available: version {m.version} (you have {local!.version}).</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {m.lite && (
              <section className="rounded-2xl border border-accent/30 bg-card p-6">
                <div className="flex items-center gap-2"><Badge variant="soft">Recommended</Badge><Badge variant="secondary">v{m.version}</Badge></div>
                <h2 className="mt-3 font-display text-xl font-semibold">Lite pack</h2>
                <p className="mt-1 text-sm text-muted-foreground">{m.lite.contents}</p>
                <PackFacts f={m.lite} builtAt={m.builtAt} />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {progress != null ? (
                    <div className="w-full space-y-1.5"><Progress value={progress * 100} /><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Downloading and verifying… {Math.round(progress * 100)}%</p></div>
                  ) : local && !outdated ? (
                    <>
                      <Badge variant="success"><CheckCircle2 /> On this device · saved {ago(new Date(local.savedAt).toISOString())}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => removeLite().then(() => { setLocal(null); toast("Removed"); })}><Trash2 /> Remove</Button>
                    </>
                  ) : <Button onClick={() => getLite(m.lite!)}><Download /> {outdated ? "Update" : "Save to this device"} ({fmtBytes(m.lite.bytes)})</Button>}
                </div>
              </section>
            )}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-display text-xl font-semibold">Full packs</h2>
              <p className="mt-1 text-sm text-muted-foreground">One SQLite file per season with every event, team, match (scores and breakdowns, penalties, alliances), ranking, award and advancement list. Open them with any SQLite tool — great for your own analysis.</p>
              {!m.full.length ? <p className="mt-4 text-sm text-muted-foreground">No full packs in this release.</p> : (
                <ul className="mt-4 space-y-3">
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
          </div>
          <Section title="How offline mode works" className="mt-8">
            <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-card p-4"><WifiOff className="mb-2 size-5 text-accent" /><span className="text-foreground">Save the lite pack</span> while you have a connection. It's checked against its published SHA-256 and stored in this browser.</li>
              <li className="rounded-xl border border-border bg-card p-4"><HardDriveDownload className="mb-2 size-5 text-accent" /><span className="text-foreground">At the venue</span>, the <Link to="/predict" className="underline">prediction lab</Link> falls back to the pack when the server can't be reached — same engine, same numbers as of the pack's date.</li>
              <li className="rounded-xl border border-border bg-card p-4"><CheckCircle2 className="mb-2 size-5 text-accent" /><span className="text-foreground">Updates</span>: this page compares your copy with the latest manifest and offers the new version. Scouting notes keep working offline too and sync when you're back online.</li>
            </ol>
          </Section>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">Manifest: <a href="/packs/latest.json" className="underline">/packs/latest.json</a> · engine v{m.engineVersion} · data as of {m.dataAsOf ? new Date(m.dataAsOf).toLocaleString() : "—"}</p>
        </>
      )}
    </div>
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
