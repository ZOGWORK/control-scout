// Pit display (/events/:season/:code/display): a fullscreen, zero-interaction screen for a pit TV or
// laptop. No site chrome (the Shell steps aside for this route), no sign-in needed, everything on one
// 16:9 screen with no scrolling at 1920×1080 and 1366×768 (type scales with the screen: --u is 1% of the
// height, or of a 16:9 box when the screen is narrower). The panels' rules live in lib/pitDisplay.ts.
//
// Fresh data comes the way the event page's live mode gets it (lib/liveMode.ts: the same request, its
// ETag making a quiet poll a 304), every 20–30 s while the event is live and every 5 minutes otherwise.
// A failed fetch shows a small "Reconnecting…" dot and retries sooner (5, 10, 20, 30 s), never a silent
// frozen screen. The screen asks to stay awake where the browser allows it.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { formatCountdown, venueClock } from "../lib/liveMode";
import { qrPath, useDisplayPoll, type PollState } from "../lib/pitPoll";
import { displayModel, verdict, type DisplayModel } from "../lib/pitDisplay";
import { useLiveTarget } from "../components/LivePanel";
import { NotFoundView } from "../components/NotFoundView";
import { cn } from "../components/cn";
import { oddsPct, tierWords } from "../shared/share";
import type { EventDetail, MatchView } from "../shared/api";

const VOLT = "text-[#ffc700]";
const RED = "#f43f5e", BLUE = "#38bdf8";
/** Sizes in --u (1% of the screen's height in a 16:9 frame; a fixed size on phones, where the page scrolls). */
const u = (n: number) => ({ fontSize: `calc(var(--u) * ${n})` });

export default function EventDisplayPage() {
  const { season, code } = useParams();
  const path = `/api/events/${season}/${code}`;
  const valid = /^\d+$/.test(season ?? "");
  const state = useApi<EventDetail>(valid ? path : null);
  const status = valid ? (state.error as ApiError | undefined)?.status : 400;
  useTitle(state.data ? `Pit display: ${state.data.event.name}` : "Pit display");
  // No polling for an address that can't be an event, or one the server says doesn't exist.
  const gone = !valid || (state.error as ApiError | undefined)?.status === 404;
  const poll = useDisplayPoll(state.data, gone ? null : path);
  useWakeLock();
  if (status === 404 || status === 400) return <div className="p-6"><NotFoundView title={`No event ${code} in ${season}`} description="The event code may be mistyped or from another season." /></div>;
  return (
    <div className="min-h-dvh bg-[#0a0a0b] text-zinc-100 [--u:7px] lg:fixed lg:inset-0 lg:overflow-hidden lg:[--u:min(1vh,0.5625vw)]" data-pit-display>
      {state.data ? <Display d={state.data} poll={poll} /> : (
        <div className="grid min-h-dvh place-items-center text-zinc-400" style={u(3)} role="status">{state.error ? "Can't reach Control Scout. Retrying…" : "Loading the event…"}</div>
      )}
    </div>
  );
}

function Display({ d, poll }: { d: EventDetail; poll: PollState }) {
  const e = d.event;
  const { user } = usePersonal();
  // Personal highlights only when signed in: my team, assigned and tracked teams at this event. Highlight only, never other data.
  const target = useLiveTarget(d, !!user);
  const mine = useMemo(() => (user ? new Set(target.teams.keys()) : new Set<number>()), [user, target.teams]);
  const now = useNow(15_000);
  const m = useMemo(() => displayModel(d, now, mine), [d, now, mine]);
  const eventHref = `/events/${e.season}/${encodeURIComponent(e.code)}`;
  return (
    <div className="flex min-h-dvh flex-col gap-[calc(var(--u)*1.6)] p-[calc(var(--u)*2.2)] lg:h-full lg:min-h-0">
      <header className="flex items-start gap-[calc(var(--u)*2)]">
        <div className="min-w-0 flex-1">
          <Link to={eventHref} className="text-zinc-500 opacity-60 hover:opacity-100" style={u(1.6)}>← Back to event</Link>
          <h1 className="truncate font-display font-semibold leading-tight tracking-tight" style={u(4.6)}>{e.name}</h1>
          <p className="text-zinc-400" style={u(2.2)}>
            <span className="font-mono">{e.code}</span>
            {m.progress && <> · <span className="text-zinc-100">{m.progress}</span></>}
            {e.status === "live" && poll === "ok" && <> · <span className="font-semibold text-[#f43f5e]">● Live</span></>}
          </p>
        </div>
        <div className="text-right">
          <Clock timezone={e.timezone} />
          {poll !== "ok" && <p className="flex items-center justify-end gap-2 text-amber-400" style={u(1.6)} role="status"><span className="inline-block size-[calc(var(--u)*1)] rounded-full bg-amber-400" aria-hidden /> {poll === "saved" ? "Offline: showing saved results" : "Reconnecting…"}</p>}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 gap-[calc(var(--u)*1.6)] lg:grid-cols-12">
        <section className="flex min-h-0 flex-col gap-[calc(var(--u)*1.6)] lg:col-span-5">
          <NowPanel d={d} m={m} mine={mine} />
          <Countdown m={m} />
        </section>
        <UpNext d={d} m={m} mine={mine} />
        <section className="flex min-h-0 flex-col gap-[calc(var(--u)*1.6)] lg:col-span-3">
          <Rankings m={m} mine={mine} />
          <Corner href={eventHref} />
        </section>
      </div>
    </div>
  );
}

const panel = "rounded-[calc(var(--u)*1.4)] border border-white/10 bg-white/[0.035] p-[calc(var(--u)*1.8)]";
const heading = "font-semibold uppercase tracking-[0.12em] text-zinc-400";

function Team({ n, mine, size }: { n: number; mine: ReadonlySet<number>; size: number }) {
  return <span className={cn("font-display font-bold tabular-nums leading-none", mine.has(n) ? VOLT : "text-zinc-50")} style={u(size)}>{n}</span>;
}

function teamsOf(side: MatchView["red"], played: boolean): number[] {
  const on = played ? side.teams.filter((t) => t.onField) : side.teams;
  return (on.length ? on : side.teams).map((t) => t.number);
}

function WinBar({ pRed, height = 1 }: { pRed: number; height?: number }) {
  const r = Math.max(0.02, Math.min(0.98, pRed));
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-white/10" style={{ height: `calc(var(--u) * ${height})` }} role="img" aria-label={`Red ${oddsPct(pRed)} to win, blue ${oddsPct(1 - pRed)}`}>
      <div className="h-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${r * 100}%`, background: RED }} />
      <div className="h-full flex-1" style={{ background: BLUE }} />
    </div>
  );
}

function NowPanel({ d, m, mine }: { d: EventDetail; m: DisplayModel; mine: ReadonlySet<number> }) {
  if (!m.now) {
    return (
      <div className={cn(panel, "flex flex-1 flex-col justify-center")}>
        <p className={heading} style={u(1.7)}>{m.noSchedule ? "Schedule" : "First match"}</p>
        <p className="mt-[calc(var(--u)*1)] font-display font-semibold" style={u(4)}>{m.noSchedule ? "Schedule not posted yet" : "Waiting for the first match"}</p>
        {m.noSchedule && <p className="mt-[calc(var(--u)*0.8)] text-zinc-400" style={u(2)}>This screen fills in by itself once FIRST posts it.</p>}
      </div>
    );
  }
  const { match, kind } = m.now;
  const played = kind === "result";
  const final = m.rankings.final && played;
  const p = match.prediction;
  const v = played ? verdict(match) : null;
  const side = (c: "red" | "blue") => {
    const s = match[c];
    const score = s.score?.total;
    const other = match[c === "red" ? "blue" : "red"].score?.total;
    return (
      <div className="flex items-center gap-[calc(var(--u)*2)] rounded-[calc(var(--u)*1)] px-[calc(var(--u)*1.6)] py-[calc(var(--u)*1.2)]" style={{ background: `color-mix(in srgb, ${c === "red" ? RED : BLUE} 16%, transparent)` }}>
        <div className="flex flex-1 flex-wrap gap-x-[calc(var(--u)*3)] gap-y-[calc(var(--u)*0.6)]">
          {teamsOf(s, played).map((t) => <Team key={t} n={t} mine={mine} size={6.2} />)}
        </div>
        {played && score != null && <span className={cn("font-display font-bold tabular-nums", other != null && score > other ? "text-zinc-50" : "text-zinc-400")} style={u(6.2)}>{score}</span>}
      </div>
    );
  };
  return (
    <div className={cn(panel, "flex min-h-0 flex-1 flex-col gap-[calc(var(--u)*1.2)]")}>
      <p className={heading} style={u(1.7)}>{final ? "Final result" : played ? "Last result" : "Up now"} · <span className="text-zinc-100">{match.label}</span></p>
      {side("red")}
      {side("blue")}
      <div className="mt-auto flex flex-wrap items-center gap-x-[calc(var(--u)*2)] gap-y-[calc(var(--u)*0.6)]" style={u(2.2)}>
        {p && !played && (
          <div className="w-full">
            <WinBar pRed={p.pRed} height={1.4} />
            <p className="mt-[calc(var(--u)*0.6)] flex justify-between text-zinc-300">
              <span><b className="text-[#f43f5e]">Red {oddsPct(p.pRed)}</b>{!p.noScoreBasis && <> · {Math.round(p.redMean)}–{Math.round(p.blueMean)}</>}</span>
              <span className="text-zinc-500">{tierWords(p.tier)}</span>
              <b className="text-[#38bdf8]">Blue {oddsPct(1 - p.pRed)}</b>
            </p>
          </div>
        )}
        {p && played && (
          <>
            {v && <span className={cn("rounded-full px-[calc(var(--u)*1.2)] py-[calc(var(--u)*0.3)] font-semibold", v === "called" ? "bg-emerald-400/15 text-emerald-300" : "bg-orange-400/15 text-orange-300")}>{v === "called" ? "✓ Called it" : "Upset"}</span>}
            <span className="text-zinc-400">Predicted {p.pRed === 0.5 ? "an even match" : p.pRed > 0.5 ? `red ${oddsPct(p.pRed)}` : `blue ${oddsPct(1 - p.pRed)}`} · {tierWords(p.tier)}{p.kind === "backtest" ? " (replayed)" : ""}</span>
          </>
        )}
        {final && m.winners && (
          <p className="w-full">
            <span className="text-zinc-400">Winning alliance{m.winners.alliance ? ` ${m.winners.alliance}` : ""}: </span>
            {m.winners.teams.map((t, i) => <span key={t}>{i > 0 && " · "}<Team n={t} mine={mine} size={2.6} /></span>)}
          </p>
        )}
        {played && !p && !final && <span className="text-zinc-500">No prediction was logged for this match.</span>}
        {d.forecastUnsupported && !p && !played && <span className="text-zinc-500">{d.forecastUnsupported}</span>}
      </div>
    </div>
  );
}

function Countdown({ m }: { m: DisplayModel }) {
  const c = m.countdown;
  const now = useNow(c?.start ? 1000 : 0);
  if (!c) return m.rankings.final ? null : null;
  const left = c.start ? formatCountdown(c.start - now) : null;
  return (
    <div className={cn(panel, "flex items-baseline justify-between gap-[calc(var(--u)*2)]")}>
      {left ? (
        <>
          <span className="text-zinc-300" style={u(2.6)}>{c.match.label} starts in</span>
          <span className="font-display font-bold tabular-nums text-[#ffc700]" style={u(7)} aria-live="off">{left}</span>
        </>
      ) : (
        <span className="font-display font-semibold" style={u(3.6)}>Up next: <span className="text-[#ffc700]">{c.match.label}</span></span>
      )}
    </div>
  );
}

function MatchRow({ m, d, mine, pin }: { m: MatchView; d: EventDetail; mine: ReadonlySet<number>; pin?: boolean }) {
  const clock = venueClock(m, d.event.timezone);
  const p = m.prediction;
  const group = (c: "red" | "blue") => (
    <div className="flex min-w-0 flex-1 flex-wrap justify-center gap-x-[calc(var(--u)*1.2)] gap-y-[calc(var(--u)*0.3)] rounded-[calc(var(--u)*0.8)] py-[calc(var(--u)*0.6)]" style={{ background: `color-mix(in srgb, ${c === "red" ? RED : BLUE} 16%, transparent)` }}>
      {/* A playoff alliance can list three: smaller numbers then, and they wrap rather than spill into the other group. */}
      {teamsOf(m[c], false).map((t, _i, all) => <Team key={t} n={t} mine={mine} size={all.length > 2 ? 2.5 : 3.4} />)}
    </div>
  );
  return (
    <li className={cn("flex flex-col gap-[calc(var(--u)*0.8)] rounded-[calc(var(--u)*1)] p-[calc(var(--u)*1.2)]", pin ? "border border-[#ffc700]/50 bg-[#ffc700]/[0.07]" : "bg-white/[0.03]")}>
      <div className="flex items-baseline justify-between" style={u(2)}>
        <span className="font-semibold">{pin && <span className="mr-[calc(var(--u)*1)] text-[#ffc700]">Your next match ·</span>}{m.label}</span>
        <span className="text-zinc-400 tabular-nums">{clock ?? ""}</span>
      </div>
      <div className="flex gap-[calc(var(--u)*1)]">{group("red")}{group("blue")}</div>
      {p && (
        <div className="flex items-center gap-[calc(var(--u)*1)] text-zinc-400" style={u(1.6)}>
          <span className="text-[#f43f5e]">{oddsPct(p.pRed)}</span>
          <WinBar pRed={p.pRed} height={0.8} />
          <span className="text-[#38bdf8]">{oddsPct(1 - p.pRed)}</span>
          <span className="whitespace-nowrap text-zinc-500">{tierWords(p.tier).replace(" confidence", "")}</span>
        </div>
      )}
    </li>
  );
}

function UpNext({ d, m, mine }: { d: EventDetail; m: DisplayModel; mine: ReadonlySet<number> }) {
  const rows = m.mine ? [m.mine, ...m.upNext.filter((x) => x.key !== m.mine!.key)].slice(0, 3) : m.upNext;
  return (
    <section className={cn(panel, "flex min-h-0 flex-col gap-[calc(var(--u)*1.2)] lg:col-span-4")}>
      <h2 className={heading} style={u(1.7)}>Up next</h2>
      {rows.length ? (
        <ol className="flex min-h-0 flex-col gap-[calc(var(--u)*1)]">{rows.map((x) => <MatchRow key={x.key} m={x} d={d} mine={mine} pin={x === m.mine} />)}</ol>
      ) : (
        <p className="text-zinc-400" style={u(2.2)}>{m.noSchedule ? "The schedule isn't posted yet." : m.unreported ? `The event is over. ${m.unreported} scheduled match${m.unreported === 1 ? " has" : "es have"} no posted result.` : m.rankings.final ? "Every scheduled match has been played." : "Every posted match is played. The next ones show here as soon as they're posted."}</p>
      )}
    </section>
  );
}

function Rankings({ m, mine }: { m: DisplayModel; mine: ReadonlySet<number> }) {
  const { rows, final } = m.rankings;
  return (
    <section className={cn(panel, "min-h-0 flex-1")}>
      <h2 className={heading} style={u(1.7)}>{final ? "Final rankings" : "Rankings"}</h2>
      {rows.length ? (
        <table className="mt-[calc(var(--u)*0.8)] w-full tabular-nums" style={u(2)}>
          <thead className="text-zinc-500" style={u(1.4)}>
            <tr><th className="text-left font-medium">#</th><th className="text-left font-medium">Team</th><th className="text-right font-medium">W–L–T</th><th className="text-right font-medium">OPR</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team} className="border-t border-white/5">
                <td className="py-[calc(var(--u)*0.45)] text-zinc-400">{r.rank}</td>
                <td className={cn("font-semibold", mine.has(r.team) ? VOLT : "text-zinc-50")}>{r.team}</td>
                <td className="text-right text-zinc-300">{r.wins ?? 0}–{r.losses ?? 0}–{r.ties ?? 0}</td>
                <td className="text-right">{r.opr.np == null ? "—" : r.opr.np.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-[calc(var(--u)*1)] text-zinc-400" style={u(2)}>Rankings start after the first matches.</p>}
    </section>
  );
}

function Corner({ href }: { href: string }) {
  const url = `${location.origin}${href}`;
  const qr = useMemo(() => qrPath(url), [url]);
  return (
    <div className="flex items-center gap-[calc(var(--u)*1.6)]">
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="shrink-0 rounded-[calc(var(--u)*0.6)] bg-white" style={{ width: "calc(var(--u) * 13)", height: "calc(var(--u) * 13)" }} role="img" aria-label="QR code: open this event on your phone">
        <path d={qr.d} fill="#0a0a0b" shapeRendering="crispEdges" />
      </svg>
      <div style={u(1.7)}>
        <p className="text-zinc-400">Scan for this event</p>
        <p className="font-display font-bold tracking-tight text-[#ffc700]" style={u(2.6)}>controlscout.org</p>
      </div>
    </div>
  );
}

/** The venue's clock (the event's time zone when known), ticking each second. */
function Clock({ timezone }: { timezone: string | null }) {
  const now = useNow(1000);
  let text: string;
  try { text = new Date(now).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) }); } catch { text = new Date(now).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  return <p className="font-display font-semibold tabular-nums" style={u(4.6)}>{text}</p>;
}

/** The time, re-read every `every` ms (0: once). */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!every) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

/** Keep the screen on where the browser allows it, asking again when the page comes back to the front. Silent otherwise. */
function useWakeLock(): void {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen").then((l) => { if (gone) void l.release().catch(() => {}); else lock = l; }).catch(() => { /* not allowed: fine */ });
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => { gone = true; document.removeEventListener("visibilitychange", ask); void lock?.release().catch(() => {}); };
  }, []);
}
