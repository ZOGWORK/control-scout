// The one connection indicator: a small pill in the top bar, in one of three states (lib/connection.ts networkState).
// "Offline" only when the connection check found no internet; "Slow connection" while a request has waited long (the
// server's answers still arrive: a weak phone signal, a laptop line full of downloads), or while anything on screen came
// from data saved on this device before the check found the line gone (src/lib/api.ts: the server's answer replaces it
// when it comes); nothing while everything answers. Gone the moment the server answers again. "Offline · updated 8:09 PM" (the time of the saved data on screen, else of the newest thing saved), or "No
// internet on this Wi-Fi" when the Wi-Fi answers with something that isn't us (a sign-in page). Tapping it opens a
// small panel: what's on this device, Try again, and the Download page.
//
// It never moves anything: on a phone it takes the centred logo's place; on a wider screen it sits over the bar's
// spare space just left of the bar's right-hand buttons.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, SignalLow, WifiOff } from "lucide-react";
import { useOfflineAsOf, useOfflineMode } from "../lib/api";
import { checkInternet, shownOffline, useConnection, useNetworkState, type ConnectionState } from "../lib/connection";
import { useSavedSeasons, type SavedSeason } from "../lib/offline/saved";
import { useSavedBundles } from "../lib/offline/bundleMeta";
import { packStatus, type PackMeta } from "../lib/packPolicy";
import { bundleTime, type SavedBundle } from "../shared/eventBundle";
import { dayDate, seasonLabel } from "../lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { Button } from "./ui/button";
import { cn } from "./cn";

/** Show the pill: no internet (or a sign-in page), a slow connection, or saved data on screen. */
export function useShowOffline(): boolean {
  return usePillState() !== null;
}

/** What the pill shows: offline (the check found no internet, or a sign-in page), slow (a request waiting long, or saved
 *  data on screen while the check hasn't found the line gone), or nothing. */
export function usePillState(): "offline" | "slow" | null {
  const conn = useConnection();
  const net = useNetworkState();
  const saved = useOfflineMode();
  if (shownOffline(conn)) return "offline";
  return net === "slow" || saved ? "slow" : null;
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

/** The pill's words: what it says, and the full sentence for screen readers. `slow`: the line works, only slowly (never
 *  said as offline). */
export function pillText(conn: Pick<ConnectionState, "internet">, asOf: string | null, now = new Date(), slow = false): { short: string; long: string; time: string | null } {
  if (conn.internet === "portal") return { short: "No internet on this Wi-Fi", long: "No internet on this Wi-Fi. It may need you to sign in", time: null };
  const time = asOf ? updatedLabel(asOf, now) || null : null;
  if (slow && conn.internet !== "no") return { short: "Slow connection", long: time ? `Slow connection, showing saved data from ${time} while it loads` : "Slow connection, still loading", time };
  return { short: "Offline", long: time ? `Offline, data updated ${time}` : "Offline", time };
}

export function ConnectionPill({ place }: { place: "phone" | "wide" }) {
  const pill = usePillState();
  const show = pill !== null;
  const slow = pill === "slow";
  const conn = useConnection();
  const onScreen = useOfflineAsOf();
  const seasons = useSavedSeasons();
  const bundles = useSavedBundles();
  const [open, setOpen] = useState(false);
  // Hidden means gone: the next offline spell starts with the panel closed (the wide pill stays mounted).
  useEffect(() => { if (!show) setOpen(false); }, [show]);
  // Always in the tree, so screen readers hear it appear and go.
  if (!show) return <span role="status" className="sr-only" />;
  const lite = packStatus();
  // Slow: only the time of saved data actually on screen (nothing saved shows while it merely loads slowly).
  const text = pillText(conn, slow ? onScreen : onScreen ?? newestSaved(seasons, bundles, lite), undefined, slow);
  const portal = conn.internet === "portal";
  return (
    <span role="status" className={cn("flex", place === "phone" ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:hidden" : "max-md:hidden xl:pointer-events-none xl:absolute xl:right-full xl:top-1/2 xl:mr-2 xl:-translate-y-1/2")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={slow ? `${text.long}. More about this` : `${text.long}. Show what's on this device`} data-connection-pill={portal ? "portal" : slow ? "slow" : "offline"}
            className="tap-44 pointer-events-auto inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-info/30 bg-primary px-2.5 text-xs font-medium text-info shadow-sm outline-none transition-colors hover:bg-info/[0.08] v8:border-ink/15 v8:bg-ink/[0.06] v8:text-text-base v8:shadow-none v8:hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-ring/60">
            {slow ? <SignalLow className="size-3.5 shrink-0" aria-hidden /> : <WifiOff className="size-3.5 shrink-0" aria-hidden />}
            {/* Tablet and small laptop widths: the icon alone, in the bar's own flow (the centred search box leaves
                no spare room beside it); the words from xl up, floating in the space left of the bar's buttons. */}
            <span aria-hidden className={cn(place === "wide" && "max-xl:hidden")}>{text.short}</span>
            {/* The time: "updated" from a laptop up; just the time on a phone, and nothing on the narrowest. */}
            {text.time && <span aria-hidden className={cn("text-info/80 v8:text-text-muted", place === "phone" ? "max-[359px]:hidden" : "max-xl:hidden")}>· {place === "wide" && "updated "}{text.time}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align={place === "phone" ? "center" : "end"} className="w-[min(92vw,20rem)] space-y-3 text-sm">
          {slow ? <SlowPanel saved={!!onScreen} onDone={() => setOpen(false)} />
            : <ConnectionPanel portal={portal} seasons={seasons} bundles={bundles} lite={lite} onDone={() => setOpen(false)} />}
        </PopoverContent>
      </Popover>
    </span>
  );
}

/** Slow, not offline: nothing is held back, and what loads late replaces anything saved shown meanwhile. */
function SlowPanel({ saved, onDone }: { saved: boolean; onDone: () => void }) {
  return (
    <>
      <div>
        <p className="font-display font-semibold text-foreground">Slow connection</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {saved
            ? "The server is taking a while to answer, so data saved on this device shows meanwhile. The live data replaces it as soon as it arrives."
            : "The server is taking a while to answer. Pages keep loading by themselves."}
          {" "}Saving, sending and signing in still work as usual, just slower.
        </p>
      </div>
      <Link to="/settings#network" onClick={onDone} className="tap-44 inline-flex min-h-8 items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Network &amp; offline settings</Link>
    </>
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
      <Link to="/settings#network" onClick={onDone} className="tap-44 inline-flex min-h-8 items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Network &amp; offline settings</Link>
    </>
  );
}
