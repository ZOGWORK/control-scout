// The Events page's coin-flip radar: today's closest calls across every event on today at its venue
// (server/api/coinFlips.ts). Still to play first, as cards with a zoomed 40–60% meter so a 52:48 call
// reads at a glance; then the ones already decided, with their results. Each opens its match page.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Coins, PowerOff } from "lucide-react";
import { isFeatureDisabled, useApi } from "../../lib/api";
import { useFlag } from "../../lib/flags";
import { featureOffMessage } from "../../shared/flags";
import { useMediaQuery } from "../../lib/meta";
import { ago } from "../../lib/format";
import { COIN_FLIPS_META, coinFlipHref, hasFlips, type CoinFlipRadar, type CoinFlipRow } from "../../shared/coinFlips";
import { Button } from "../ui/button";
import { TierMark } from "../predict";
import { cn } from "../cn";
import { tierPhrase } from "../../shared/tierWords";

/** Cards shown before "Show all" (fewer on a phone, where they stack), and decided rows before "All decided". */
const FIRST_UPCOMING = 6;
const FIRST_UPCOMING_PHONE = 3;
const FIRST_DECIDED = 3;

/** "10:05 AM" at the venue: FIRST's event-local wall time as it reads; a zoned timestamp (as the fallback
 *  source stores them) is read in the venue's zone. */
export function venueClock(time: string | null, zone: string): string | null {
  if (!time) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/.test(time)) {
    const at = Date.parse(time);
    if (!Number.isFinite(at)) return null;
    try { return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }); } catch { return null; }
  }
  const m = /T(\d\d):(\d\d)/.exec(time);
  if (!m) return null;
  return new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** When a match still to play is due, from its real start: "in 25 min", "in 2 h", or "awaiting result" once past. */
export function dueIn(startsAt: string | null, now = Date.now()): string | null {
  if (!startsAt) return null;
  const min = Math.round((Date.parse(startsAt) - now) / 60_000);
  if (!Number.isFinite(min)) return null;
  if (min < -5) return "awaiting result";
  if (min <= 1) return "starting now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}

/** The upcoming row with the closest call (the first of them on a tie): marked "Closest call". */
export function closestKey(rows: CoinFlipRow[]): string | null {
  let best: CoinFlipRow | null = null;
  // By the printed odds, so of two cards that both read 51% the mark goes to the sooner, never to the one
  // whose hidden decimals happen to be nearer 50.
  const gap = (p: number) => Math.abs(printedOdds(p).red - 50);
  for (const r of rows) if (!best || gap(r.pRed) < gap(best.pRed)) best = r;
  return best ? `${best.code}|${best.key}` : null;
}

export { hasFlips };

/** What the page's first HTML said about today: false when it had no coin flips (server/seo.ts), else true (it had
 *  some, or it didn't say: another page loaded first, a slow answer, the dev server). */
export const flipsExpected = () => typeof document === "undefined"
  || document.querySelector<HTMLMetaElement>(`meta[name="${COIN_FLIPS_META}"]`)?.content !== "0";

const pctBand = (r: CoinFlipRadar) => `${Math.round(r.band.lo * 100)}% and ${Math.round(r.band.hi * 100)}%`;

/** Where the meter's marker sits, as % from the left: red's half is drawn on the left (as red's teams and odds
 *  are), so the marker leans into the favourite's half: red 55% → 25%, 50:50 → 50%, red 45% → 75%. Scaled
 *  from 40% to 60%, so the difference between 52 and 48 is plain to see. */
export const meterAt = (pRed: number) => Math.max(0, Math.min(1, (60 - printedOdds(pRed).red) / 20)) * 100;

/** The side the printed odds favour: none when both read 50% (a 50.3% call prints "50% · 50%", so nothing
 *  else on the card may call it red's). Every visual takes its side from this, so none can disagree with the numbers. */
export const favourite = (pRed: number): "red" | "blue" | null => {
  const { red } = printedOdds(pRed);
  return red > 50 ? "red" : red < 50 ? "blue" : null;
};

/** The pair of whole percentages a card prints, from one rounding so they always add up to 100 (rounding each
 *  side on its own can print 50 · 51 for 0.495). Kept off a flat 0 or 100 like oddsPct, though the band never
 *  comes near. Every number and visual on a card, and the closest-call mark, reads this pair. */
export function printedOdds(pRed: number): { red: number; blue: number } {
  const red = Math.min(99, Math.max(1, Math.round(pRed * 100)));
  return { red, blue: 100 - red };
}

function CoinMeter({ pRed }: { pRed: number }) {
  const at = meterAt(pRed), fav = favourite(pRed);
  return (
    <div aria-hidden className="relative h-2.5 w-full">
      <div className="absolute inset-0 flex overflow-hidden rounded-full">
        <div className="h-full flex-1 bg-red-alliance/30" />
        <div className="h-full flex-1 bg-blue-alliance/30" />
      </div>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-text-base/40" />
      <div data-testid="coin-marker" className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow", fav === "red" ? "bg-red-alliance" : fav === "blue" ? "bg-blue-alliance" : "bg-accent")} data-side={fav ?? "even"} style={{ left: `${at}%` }} />
    </div>
  );
}

function Teams({ teams, side }: { teams: number[]; side: "red" | "blue" }) {
  return (
    <span className={cn("flex min-w-0 flex-col font-mono text-sm font-semibold tabular-nums leading-tight", side === "red" ? "items-start text-red-alliance" : "items-end text-blue-alliance")}>
      {teams.map((t) => <span key={t}>{t}</span>)}
    </span>
  );
}

function FlipCard({ r, closest }: { r: CoinFlipRow; closest: boolean }) {
  const clock = venueClock(r.time, r.timezone), due = dueIn(r.startsAt);
  const odds = printedOdds(r.pRed);
  const label = `${r.label} at ${r.eventName}${clock ? `, ${clock} at the venue` : ""}: red ${r.red.join(" and ")} ${odds.red}% to win, blue ${r.blue.join(" and ")} ${odds.blue}%, ${tierPhrase(r.tier)}`;
  return (
    <li className="min-w-0">
      <Link to={coinFlipHref(r)} aria-label={label}
        className={cn("lift group flex h-full flex-col gap-2.5 rounded-xl border bg-card p-3.5 focus-visible:outline-2 focus-visible:outline-accent", closest ? "border-accent/60 bg-accent/[0.05]" : "border-line")}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded-md bg-text-base/10 px-1.5 py-0.5 font-mono font-semibold text-text-base">{r.label}</span>
          {clock && <span className="text-text-muted">{clock} venue time</span>}
          {due && <span className={cn("font-medium", due === "awaiting result" ? "text-text-muted" : "text-accent-text")}>· {due}</span>}
          <span className="ml-auto flex items-center gap-2">
            {closest && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink">Closest call</span>}
            <TierMark tier={r.tier} />
          </span>
        </span>
        <span className="block truncate text-sm font-medium group-hover:text-accent-text">{r.eventName}{r.place && <span className="font-normal text-text-muted"> · {r.place}</span>}</span>
        <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <Teams teams={r.red} side="red" />
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-baseline justify-between font-display text-lg font-semibold tabular-nums leading-none">
              <span className="text-red-alliance">{odds.red}%</span>
              <span className="text-blue-alliance">{odds.blue}%</span>
            </span>
            <CoinMeter pRed={r.pRed} />
          </span>
          <Teams teams={r.blue} side="blue" />
        </span>
      </Link>
    </li>
  );
}

function DecidedRow({ r }: { r: CoinFlipRow }) {
  const res = r.result!;
  const winner = res.red > res.blue ? "red" : res.blue > res.red ? "blue" : null;
  const fav = favourite(r.pRed), odds = printedOdds(r.pRed);
  const call = fav ? `${fav === "red" ? "Red" : "Blue"} ${odds[fav]}%` : "50:50";
  const verdict = !winner ? "a tie" : !fav ? "a true coin flip" : winner === fav ? "the call held" : "the other side won";
  return (
    <li>
      <Link to={coinFlipHref(r)} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-accent">
        <span className="rounded-md bg-text-base/10 px-1.5 py-0.5 font-mono text-xs font-semibold">{r.label}</span>
        <span className="min-w-0 flex-1 basis-40 truncate group-hover:text-accent-text">{r.eventName}</span>
        <span className="flex items-center gap-1.5 font-mono font-semibold tabular-nums">
          <span className={cn("text-red-alliance", winner === "blue" && "opacity-60")}>{res.red}</span>
          <span className="text-text-muted">–</span>
          <span className={cn("text-blue-alliance", winner === "red" && "opacity-60")}>{res.blue}</span>
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
          called {call} before the match <TierMark tier={r.tier} /> · {verdict}
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-text-muted group-hover:text-accent-text" aria-hidden />
      </Link>
    </li>
  );
}

/** An open home page keeps up: results come in and the next match moves up while someone watches. */
export const REFRESH_MS = 60_000;

/** Reload every REFRESH_MS while the tab is showing, and at once when it comes back after a while away. */
function useRadarRefresh(reload: () => void) {
  useEffect(() => {
    let last = Date.now();
    const again = () => { last = Date.now(); reload(); };
    const every = setInterval(() => { if (document.visibilityState === "visible") again(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === "visible" && Date.now() - last >= REFRESH_MS) again(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(every); document.removeEventListener("visibilitychange", onShow); };
  }, [reload]);
}

/** Nothing renders on a day with no coin flips, or when they couldn't load (a stale radar stays up through a
 *  failed refresh); the skeleton holds the place while loading, unless the page's HTML said today has none. `className` (the page's spacing) goes on the
 *  section, so a hidden section leaves no gap. */
export function CoinFlipRadarSection({ className }: { className?: string }) {
  // Switched off by the owner (the coinFlips feature toggle): not asked for, and a short note in its place.
  const on = useFlag("coinFlips");
  const state = useApi<CoinFlipRadar>(on ? "/api/home/coin-flips" : null);
  useRadarRefresh(state.reload);
  const [allUp, setAllUp] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const first = useMediaQuery("(max-width: 639px)") ? FIRST_UPCOMING_PHONE : FIRST_UPCOMING;
  const r = state.data;
  const closest = useMemo(() => (r ? closestKey(r.upcoming) : null), [r]);
  const up = r ? (allUp ? r.upcoming : r.upcoming.slice(0, first)) : [];
  const done = r ? (allDone ? r.decided : r.decided.slice(0, FIRST_DECIDED)) : [];
  if (!on || isFeatureDisabled(state.error)) {
    return (
      <p role="status" className={cn("flex items-center gap-2 text-sm text-text-muted", className)}>
        <PowerOff className="size-4 shrink-0" aria-hidden /> {featureOffMessage("coinFlips")}
      </p>
    );
  }
  if ((state.error && !r) || (r && !hasFlips(r))) return null;
  // A day the page already knows has none: no placeholder while it loads, so the page below doesn't jump up after.
  if (!r && !flipsExpected()) return null;
  return (
    <section aria-labelledby="radar-title" className={cn("@container/radar min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="radar-title" className="flex items-center gap-2 font-display text-2xl font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink"><Coins className="size-[18px]" aria-hidden /></span>
            Today’s coin flips
          </h2>
          <p className="mt-1 max-w-[44rem] text-sm text-text-muted">
            The matches the model can barely split: {r ? pctBand(r) : "45% and 55%"} for either side, at every event on today at its venue. Calls on thin data are left out.
          </p>
        </div>
        {r && (
          <span className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium tabular-nums text-accent-text">
            {r.upcoming.length} to play{r.decided.length ? ` · ${r.decided.length} decided` : ""}
          </span>
        )}
      </div>
      <div className="mt-3">
        {!r ? (
          <ul aria-busy="true" className="grid gap-3 @2xl/radar:grid-cols-2 @5xl/radar:grid-cols-3">{[0, 1, 2].map((i) => <li key={i} className="h-[7.5rem] rounded-xl border border-line" />)}</ul>
        ) : (
          <>
            {!up.length && <p className="rounded-xl border border-dashed border-line px-4 py-4 text-sm text-text-muted">Every coin flip on today’s schedules has been played. The results are below.</p>}
            {up.length > 0 && (
              <ul className="grid gap-3 @2xl/radar:grid-cols-2 @5xl/radar:grid-cols-3">
                {up.map((x) => <FlipCard key={`${x.code}|${x.key}`} r={x} closest={r.upcoming.length > 1 && closest === `${x.code}|${x.key}`} />)}
              </ul>
            )}
            {r.upcoming.length > first && (
              <Button variant="secondary" size="sm" className="mt-3 max-sm:h-10" aria-expanded={allUp} onClick={() => setAllUp((v) => !v)}>
                {allUp ? "Show fewer" : `Show all ${r.upcoming.length} to play`}
              </Button>
            )}
            {r.decided.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">Decided today</h3>
                <ul className="mt-1 divide-y divide-line border-y border-line">{done.map((x) => <DecidedRow key={`${x.code}|${x.key}`} r={x} />)}</ul>
                {r.decided.length > FIRST_DECIDED && (
                  <Button variant="secondary" size="sm" className="mt-3 max-sm:h-10" aria-expanded={allDone} onClick={() => setAllDone((v) => !v)}>
                    {allDone ? "Show fewer" : `All ${r.decided.length} decided`}
                  </Button>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-text-muted">
              Each call is the one on its match page: logged before the match (and scored in the public record) or, until it’s logged, from today’s ratings. Updated {ago(r.generatedAt)}.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
