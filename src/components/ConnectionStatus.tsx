// The one offline indicator: a small pill in the top bar, there whenever there's no internet (src/lib/connection.ts)
// or anything on screen came from data saved on this device (src/lib/api.ts), and gone the moment the server answers
// again. "Offline · updated 8:09 PM" (the time of the saved data on screen, else of the newest thing saved), or "No
// internet on this Wi-Fi" when the Wi-Fi answers with something that isn't us (a sign-in page). Tapping it opens a
// small panel: what's on this device, Try again, and the Download page.
//
// It never moves anything: on a phone it takes the centred logo's place; on a wider screen it sits over the bar's
// spare space just left of the bar's right-hand buttons.
import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, WifiOff } from "lucide-react";
import { useOfflineAsOf, useOfflineMode } from "../lib/api";
import { checkInternet, shownOffline, useConnection, type ConnectionState } from "../lib/connection";
import { useSavedSeasons, type SavedSeason } from "../lib/offline/saved";
import { useSavedBundles } from "../lib/offline/bundleMeta";
import { packStatus, type PackMeta } from "../lib/packPolicy";
import { bundleTime, type SavedBundle } from "../shared/eventBundle";
import { dayDate, seasonLabel } from "../lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { Button } from "./ui/button";
import { cn } from "./cn";

/** Show the pill: no internet (or a sign-in page), or saved data on screen. */
export function useShowOffline(): boolean {
  const conn = useConnection();
  const saved = useOfflineMode();
  return shownOffline(conn) || saved;
}

/** The newest data time among what's saved here (seasons, event bundles, the lite pack), or null. */
export function newestSaved(seasons: SavedSeason[], bundles: SavedBundle[], lite: PackMeta | null): string | null {
  const times = [
    ...seasons.map((s) => s.dataAsOf ?? new Date(s.savedAt).toISOString()),
    ...bundles.map(bundleTime),
    ...(lite?.builtAt ? [lite.builtAt] : []),
  ];
  return times.length ? times.reduce((a, b) => (b > a ? b : a)) : null;
}

/** "8:09 PM" today, else the day ("Nov 12, 2026"). */
export function updatedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : dayDate(d);
}

/** The pill's words: what it says, and the full sentence for screen readers. */
export function pillText(conn: Pick<ConnectionState, "internet">, asOf: string | null, now = new Date()): { short: string; long: string; time: string | null } {
  if (conn.internet === "portal") return { short: "No internet on this Wi-Fi", long: "No internet on this Wi-Fi. It may need you to sign in.", time: null };
  const time = asOf ? updatedLabel(asOf, now) || null : null;
  return { short: "Offline", long: time ? `Offline, data updated ${time}` : "Offline", time };
}

export function ConnectionPill({ place }: { place: "phone" | "wide" }) {
  const show = useShowOffline();
  const conn = useConnection();
  const onScreen = useOfflineAsOf();
  const seasons = useSavedSeasons();
  const bundles = useSavedBundles();
  const [open, setOpen] = useState(false);
  // Always in the tree, so screen readers hear it appear and go.
  if (!show) return <span role="status" className="sr-only" />;
  const lite = packStatus();
  const text = pillText(conn, onScreen ?? newestSaved(seasons, bundles, lite));
  const portal = conn.internet === "portal";
  return (
    <span role="status" className={cn("flex", place === "phone" ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:hidden" : "pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 max-md:hidden")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${text.long}. Show what's on this device`} data-connection-pill={portal ? "portal" : "offline"}
            className="tap-44 pointer-events-auto inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-info/30 bg-primary px-2.5 text-xs font-medium text-info shadow-sm outline-none transition-colors hover:bg-info/[0.08] focus-visible:ring-2 focus-visible:ring-ring/60">
            <WifiOff className="size-3.5 shrink-0" aria-hidden />
            <span aria-hidden>{text.short}</span>
            {/* The time: "updated" from a laptop up; just the time on a phone, and nothing on the narrowest. */}
            {text.time && <span aria-hidden className={cn("text-info/80", place === "phone" ? "max-[359px]:hidden" : "max-lg:hidden")}>· {place === "wide" && "updated "}{text.time}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align={place === "phone" ? "center" : "end"} className="w-[min(92vw,20rem)] space-y-3 text-sm">
          <ConnectionPanel portal={portal} seasons={seasons} bundles={bundles} lite={lite} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </span>
  );
}

function ConnectionPanel({ portal, seasons, bundles, lite, onDone }: { portal: boolean; seasons: SavedSeason[]; bundles: SavedBundle[]; lite: PackMeta | null; onDone: () => void }) {
  const [checking, setChecking] = useState(false);
  const [still, setStill] = useState(false);
  const retry = async () => {
    setChecking(true);
    setStill(false);
    const now = await checkInternet();
    setChecking(false);
    if (now === "yes") onDone(); // the pill goes as the pages refresh in the background
    else setStill(true);
  };
  const items = [
    ...bundles.map((b) => ({ key: `b:${b.season}:${b.code}`, name: b.name, at: bundleTime(b) })),
    ...seasons.map((s) => ({ key: `s:${s.season}`, name: `${seasonLabel(s.season)} season`, at: s.dataAsOf ?? new Date(s.savedAt).toISOString() })),
    ...(lite ? [{ key: "lite", name: "Predictions (lite pack)", at: lite.builtAt }] : []),
  ];
  return (
    <>
      <div>
        <p className="font-display font-semibold text-foreground">{portal ? "No internet on this Wi-Fi" : "You're offline"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {portal ? "This Wi-Fi isn't giving internet. It may need you to sign in: open any website to see its sign-in page."
            : "Anything saved on this device opens straight away. The rest needs a connection, and pages refresh by themselves when it's back."}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-foreground">On this device</p>
        {items.length ? (
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {items.map((i) => <li key={i.key} className="flex justify-between gap-3"><span className="min-w-0 truncate">{i.name}</span><span className="shrink-0 tabular-nums">{updatedLabel(i.at)}</span></li>)}
          </ul>
        ) : <p className="mt-1 text-xs text-muted-foreground">Nothing saved yet. Download an event or a season while you have a connection.</p>}
      </div>
      {still && <p role="status" className="text-xs text-muted-foreground">Still no internet.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={retry} disabled={checking}>
          <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} /> {checking ? "Checking" : "Try again"}
        </Button>
        <Button size="sm" className="max-sm:h-11" asChild><Link to="/download" onClick={onDone}>Downloads</Link></Button>
      </div>
    </>
  );
}
