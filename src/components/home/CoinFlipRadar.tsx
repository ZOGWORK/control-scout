// The home page's coin-flip radar: today's closest calls across every event on today at its venue
// (server/api/coinFlips.ts). Still to play first, as cards with a zoomed 40–60% meter so a 52:48 call
// reads at a glance; then the ones already decided, with their results. Each opens its match page.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Coins, RefreshCw } from "lucide-react";
import { useApi } from "../../lib/api";
import { useMediaQuery } from "../../lib/meta";
import { ago, oddsPct } from "../../lib/format";
import { coinFlipHref, type CoinFlipRadar, type CoinFlipRow } from "../../shared/coinFlips";
import { Button } from "../ui/button";
import { TierMark } from "../predict";
import { cn } from "../cn";

/** Cards shown before "Show all" (fewer on a phone, where they stack), and decided rows before "All decided". */
const FIRST_UPCOMING = 6;
const FIRST_UPCOMING_PHONE = 3;
const FIRST_DECIDED = 3;

/** "10:05 AM" at the venue, from the event-local wall time FIRST reports. */
export function venueClock(time: string | null): string | null {
  if (!time) return null;
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
  for (const r of rows) if (!best || Math.abs(r.pRed - 0.5) < Math.abs(best.pRed - 0.5)) best = r;
  return best ? `${best.code}|${best.key}` : null;
}

/** What the section says when it has no cards (null: it has some). */
export function emptyLine(r: CoinFlipRadar): string | null {
  if (r.upcoming.length) return null;
  if (r.decided.length) return "Every coin flip on today’s schedules has been played. The results are below.";
  if (!r.events) return "No event has matches scheduled for today at its venue, so there are no coin flips to watch. They show here on event days, once a schedule is out.";
  const pool = `${r.calls.toLocaleString()} ${r.calls === 1 ? "call" : "calls"} on today’s schedules at ${r.events} ${r.events === 1 ? "event" : "events"}`;
  if (!r.thin) return `None of the ${pool} is between ${pctBand(r)}.`;
  return `Of the ${pool}, ${r.thin} ${r.thin === 1 ? "is" : "are"} between ${pctBand(r)} but left out: a robot in ${r.thin === 1 ? "it has" : "them has"} played fewer than 3 matches this season, so the call rests on thin data.`;
}

const pctBand = (r: CoinFlipRadar) => `${Math.round(r.band.lo * 100)}% and ${Math.round(r.band.hi * 100)}%`;

/** Red's odds on a scale from 40% to 60%, so the difference between 52 and 48 is plain to see. */
function CoinMeter({ pRed }: { pRed: number }) {
  const at = Math.max(0, Math.min(1, (pRed - 0.4) / 0.2)) * 100;
  return (
    <div aria-hidden className="relative h-2.5 w-full">
      <div className="absolute inset-0 flex overflow-hidden rounded-full">
        <div className="h-full flex-1 bg-red-alliance/30" />
        <div className="h-full flex-1 bg-blue-alliance/30" />
      </div>
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-text-base/40" />
      <div className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow", pRed > 0.5 ? "bg-red-alliance" : pRed < 0.5 ? "bg-blue-alliance" : "bg-accent")} style={{ left: `${at}%` }} />
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
  const clock = venueClock(r.time), due = dueIn(r.startsAt);
  const label = `${r.label} at ${r.eventName}${clock ? `, ${clock} at the venue` : ""}: red ${r.red.join(" and ")} ${oddsPct(r.pRed)} to win, blue ${r.blue.join(" and ")} ${oddsPct(1 - r.pRed)}, ${r.tier} confidence`;
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
              <span className="text-red-alliance">{oddsPct(r.pRed)}</span>
              <span className="text-blue-alliance">{oddsPct(1 - r.pRed)}</span>
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
  const fav = r.pRed > 0.5 ? "red" : r.pRed < 0.5 ? "blue" : null;
  const call = fav ? `${fav === "red" ? "Red" : "Blue"} ${oddsPct(fav === "red" ? r.pRed : 1 - r.pRed)}` : "50:50";
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
        <span className="text-xs text-text-muted">called {call} before the match · {verdict}</span>
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

export function CoinFlipRadarSection() {
  const state = useApi<CoinFlipRadar>("/api/home/coin-flips");
  useRadarRefresh(state.reload);
  const [allUp, setAllUp] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const first = useMediaQuery("(max-width: 639px)") ? FIRST_UPCOMING_PHONE : FIRST_UPCOMING;
  const r = state.data;
  const closest = useMemo(() => (r ? closestKey(r.upcoming) : null), [r]);
  const empty = r ? emptyLine(r) : null;
  const up = r ? (allUp ? r.upcoming : r.upcoming.slice(0, first)) : [];
  const done = r ? (allDone ? r.decided : r.decided.slice(0, FIRST_DECIDED)) : [];
  return (
    <section aria-labelledby="radar-title" className="@container/radar min-w-0">
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
        {r && (r.upcoming.length > 0 || r.decided.length > 0) && (
          <span className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium tabular-nums text-accent-text">
            {r.upcoming.length} to play{r.decided.length ? ` · ${r.decided.length} decided` : ""}
          </span>
        )}
      </div>
      <div className="mt-3">
        {state.error && !r ? (
          <p className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line px-4 py-4 text-sm text-text-muted">
            Today’s coin flips couldn’t load. <Button variant="secondary" size="sm" onClick={state.reload}><RefreshCw /> Try again</Button>
          </p>
        ) : !r ? (
          <ul aria-busy="true" className="grid gap-3 @2xl/radar:grid-cols-2 @5xl/radar:grid-cols-3">{[0, 1, 2].map((i) => <li key={i} className="h-[7.5rem] rounded-xl border border-line" />)}</ul>
        ) : (
          <>
            {empty && <p className="rounded-xl border border-dashed border-line px-4 py-4 text-sm text-text-muted">{empty}</p>}
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
            {(r.upcoming.length > 0 || r.decided.length > 0) && <p className="mt-3 text-xs text-text-muted">
              Each call is the one on its match page: logged before the match (and scored in the public record) or, until it’s logged, from today’s ratings. Updated {ago(r.generatedAt)}.
            </p>}
          </>
        )}
      </div>
    </section>
  );
}
