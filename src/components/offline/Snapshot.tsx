// Frozen snapshots from an event-day bundle (docs/event-bundle.md), and the banner that goes with them
// everywhere: "Snapshot from 07:12, may be stale", with its age, ticking. A confident stale pick list is worse
// than none, so past STALE_AFTER_MS the banner says plainly to check the live one first.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, WifiOff } from "lucide-react";
import { STALE_AFTER_MS, snapshotAge, snapshotClock } from "../../shared/eventBundle";
import { cn } from "../cn";

/** Now, updated every minute (ages on screen keep up). */
export function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  return now;
}

export function SnapshotBanner({ at, children, className, compact }: { at: string; children?: ReactNode; className?: string;
  /** One quiet line: when it was saved, how old, and (past STALE_AFTER_MS) to check live first. */
  compact?: boolean }) {
  const now = useMinuteNow();
  const old = now - new Date(at).getTime() > STALE_AFTER_MS;
  const age = snapshotAge(at, now);
  const ageText = age === "just now" ? "saved just now" : `${age} old`;
  if (compact) return (
    <p role="status" data-snapshot-banner className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground", className)}>
      <WifiOff className={cn("size-3.5 shrink-0", old ? "text-danger" : "text-warning")} aria-hidden />
      <span>Saved <span className="font-medium text-foreground tabular-nums">{snapshotClock(at, new Date(now))}</span></span>
      <span aria-hidden>·</span>
      <span className={cn("tabular-nums", old && "font-medium text-danger")}>{age === "just now" ? age : ageText}{old ? ", check live data first" : ""}</span>
    </p>
  );
  return (
    <div role="status" data-snapshot-banner className={cn("mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm",
      old ? "border-danger/40 bg-danger/[0.07]" : "border-warning/40 bg-warning/[0.08]", className)}>
      <WifiOff className={cn("mt-0.5 size-4 shrink-0", old ? "text-danger" : "text-warning")} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">
          Snapshot from <span className="tabular-nums">{snapshotClock(at, new Date(now))}</span>, may be stale
          <span className={cn("ml-2 inline-flex items-center gap-1 rounded-full px-2 py-px align-middle text-xs font-medium tabular-nums", old ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning")}>
            <Clock className="size-3" aria-hidden />{ageText}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {old ? "Over 2 hours old: results, rankings and picks have likely moved. Check the live version before you rely on it. " : "Saved in your event-day bundle for when there's no signal. "}
          {children}
        </p>
      </div>
    </div>
  );
}

/** A frozen report: the bundle's static HTML in a sandboxed frame (no scripts run; it fetches nothing), as tall as its page. */
export function SnapshotFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(480);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const fit = () => { const d = frame.contentDocument?.documentElement; if (d) setH(d.scrollHeight + 2); };
    frame.addEventListener("load", fit);
    window.addEventListener("resize", fit);
    fit();
    return () => { frame.removeEventListener("load", fit); window.removeEventListener("resize", fit); };
  }, [html]);
  // allow-same-origin without allow-scripts: the page can't run anything, and this page can read its height.
  return <iframe ref={ref} title={title} srcDoc={html} sandbox="allow-same-origin" className="block w-full rounded-xl border border-border bg-card" style={{ height: h }} data-snapshot-frame />;
}
