// The event page's one tap to take the event offline (docs/event-bundle.md): the event pack (every team, match and
// Compare of the event, plus your team's match reports) downloads from here, its real size on the button. Already
// saved: says so, with its size, and links to the Download page (update, remove, the workspace pick list).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, HardDriveDownload, Loader2 } from "lucide-react";
import { usePersonal } from "../../lib/personal";
import { bundleFor, useSavedBundles } from "../../lib/offline/bundleMeta";
import type { BundleRequest } from "../../lib/offline/bundles";
import { fmtBytes } from "../../lib/recordings";
import type { BundleManifest } from "../../shared/eventBundle";
import { toast } from "../ui/sonner";
import { cn } from "../cn";

const bundles = () => import("../../lib/offline/bundles");
const CHIP = "mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.07] px-2.5 text-sm font-medium hover:border-accent max-sm:min-h-11";

export function EventPackButton({ season, code, field }: { season: number; code: string; field: number[] }) {
  useSavedBundles(); // re-render when a bundle is saved or removed
  const found = bundleFor(season, code);
  // A bundle saved before the event pack (no team or match pages inside) isn't the offline event: it's updated.
  const saved = found?.apiPaths?.length ? found : null;
  const older = found && !saved ? found : null;
  const { state, user } = usePersonal();
  const team = state.myTeam != null && field.includes(state.myTeam) ? state.myTeam : null;
  // An older bundle is updated with what it was made for (its team, its workspace's pick list).
  const req: BundleRequest = older
    ? { season, code, team: older.team, workspace: older.workspace?.id ?? null, account: user?.id ?? null }
    : { season, code, team, workspace: null, account: user?.id ?? null };
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  // Its size, asked once the page is idle (only while the event pack isn't saved). Leaving the page first asks
  // nothing (the idle callback is cancelled) and stops a manifest still being prepared.
  useEffect(() => {
    if (saved) return;
    let live = true;
    const ctrl = new AbortController();
    setManifest(null); setFailed(false);
    const go = () => { void bundles().then((b) => b.fetchBundleManifest(req, ctrl.signal)).then((m) => live && setManifest(m), () => live && setFailed(true)); };
    const w = window as { requestIdleCallback?: (f: () => void) => number; cancelIdleCallback?: (h: number) => void };
    const idle = !!w.requestIdleCallback && !!w.cancelIdleCallback;
    const h = idle ? w.requestIdleCallback!(go) : window.setTimeout(go, 300);
    return () => { live = false; ctrl.abort(); if (idle) w.cancelIdleCallback!(h); else clearTimeout(h); };
  }, [season, code, req.team, req.workspace, !!saved]);

  if (saved) {
    return (
      <Link to={`/download?event=${season}:${encodeURIComponent(code)}`} className={CHIP} data-bundle-link data-pack-saved>
        <CheckCircle2 className="size-4 text-success" aria-hidden />Saved for offline · {fmtBytes(saved.bytes)}
      </Link>
    );
  }
  // The size couldn't be checked (switched off, no signal): the Download page says why.
  if (failed) {
    return <Link to={`/download?event=${season}:${encodeURIComponent(code)}`} className={CHIP} data-bundle-link><HardDriveDownload className="size-4 text-accent" aria-hidden />Download for offline</Link>;
  }
  const download = async () => {
    if (!manifest || done != null) return;
    setDone(0);
    try {
      const b = await (await bundles()).downloadBundle(req, (d) => setDone(d), manifest);
      toast.success(`${b.name} saved for offline`, { description: `${fmtBytes(b.bytes)}. Its team pages, match pages and Compare work with no connection.` });
    } catch (e) { toast.error((e as Error).message); }
    finally { setDone(null); }
  };
  return (
    <button type="button" onClick={() => void download()} disabled={!manifest || done != null} className={cn(CHIP, "disabled:opacity-70")} data-bundle-link data-pack-download
      aria-label={`${older ? "Update" : "Download"} this event for offline${manifest ? `, ${fmtBytes(manifest.bytes)}` : ""}`}>
      {done != null ? <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> : <HardDriveDownload className="size-4 text-accent" aria-hidden />}
      {done != null && manifest ? <span className="tabular-nums">Downloading · {fmtBytes(done)} of {fmtBytes(manifest.bytes)}</span>
        : <>{older ? "Update for offline" : "Download for offline"}{manifest ? <span className="tabular-nums"> · {fmtBytes(manifest.bytes)}</span> : <span className="text-muted-foreground"> · checking size…</span>}</>}
    </button>
  );
}
