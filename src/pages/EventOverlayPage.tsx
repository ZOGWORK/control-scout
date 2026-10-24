// Broadcast overlay (/events/:season/:code/overlay): a lower-third for an event's stream, added in OBS as a
// browser source (1920×1080) on top of the video. No site chrome (the Shell steps aside, as for the pit
// display), a transparent page OBS composites (or ?bg=green for a chroma key), and sizes that scale with
// the viewport like the pit display's (--u is 1% of the height in a 16:9 frame). What the bar shows lives in
// lib/overlay.ts, picked the way the Watch live rail picks (lib/watchRail.ts).
//
// Fresh data comes as the pit display gets it (lib/pitPoll.ts useDisplayPoll: the event's own request, its
// ETag making a quiet poll a 304; 20–30 s while live, else every 5 minutes; after a failure 5, 10, 20, 30 s and
// a small "Reconnecting…" in the corner bug).
import { useEffect, useLayoutEffect, useState, type CSSProperties, type HTMLAttributes } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { useDisplayPoll, type PollState } from "../lib/pitPoll";
import { useWatchRail } from "../lib/useWatchRail";
import { CHROMA_GREEN, callWords, overlayModel, overlayOptions, shortName, type OverlayModel, type OverlaySide } from "../lib/overlay";
import { venueClock } from "../lib/liveMode";
import { cn } from "../components/cn";
import { oddsPct, tierWords } from "../shared/share";
import type { EventDetail } from "../shared/api";

const GOLD = "#ffc700";
const RED = "#f43f5e", BLUE = "#38bdf8";
/** Sizes in --u (1% of a 16:9 frame's height); the bar's in --bu (--u times ?scale). */
const u = (n: number): CSSProperties => ({ fontSize: `calc(var(--u) * ${n})` });
const bu = (n: number) => `calc(var(--bu) * ${n})`;
const bf = (n: number): CSSProperties => ({ fontSize: bu(n) });

/** The page is see-through while the overlay is up: <html> and <body> lose their colour (index.css html.cs-overlay). */
function useTransparentPage(): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add("cs-overlay");
    return () => html.classList.remove("cs-overlay");
  }, []);
}

export default function EventOverlayPage() {
  const { season, code } = useParams();
  const opts = overlayOptions(useLocation().search);
  const path = `/api/events/${season}/${code}`;
  const valid = /^\d+$/.test(season ?? "");
  const state = useApi<EventDetail>(valid ? path : null);
  const status = valid ? (state.error as ApiError | undefined)?.status : 400;
  useTitle(state.data ? `Stream overlay: ${state.data.event.name}` : "Stream overlay");
  // No polling for an address that can't be an event, or one the server says doesn't exist.
  const gone = !valid || status === 404;
  const poll = useDisplayPoll(state.data, gone ? null : path);
  useTransparentPage();
  const frame: CSSProperties = {
    background: opts.bg === "green" ? CHROMA_GREEN : "transparent",
    ["--u" as string]: "min(1vh, 0.5625vw)",
    ["--bu" as string]: `calc(min(1vh, 0.5625vw) * ${opts.scale})`,
  };
  return (
    <div className="fixed inset-0 overflow-hidden font-sans text-zinc-100 antialiased" style={frame} data-overlay data-overlay-bg={opts.bg}>
      {status === 404 || status === 400 ? (
        <Card className="absolute left-[calc(var(--u)*3)] top-[calc(var(--u)*3)] px-[calc(var(--u)*2)] py-[calc(var(--u)*1.4)]" style={u(2)} role="alert">
          No event {code} in {season}. Check the overlay's address.
        </Card>
      ) : state.data ? <Overlay d={state.data} poll={poll} top={opts.pos === "top"} /> : (
        <p className="sr-only" role="status">{state.error ? "Can't reach Control Scout. Retrying…" : "Loading the event…"}</p>
      )}
    </div>
  );
}

/** Graphite, fully opaque (a see-through edge would let the chroma key eat into it); the shadow only on a
 *  transparent page (over the key green it would leave a dark halo once keyed). */
const SHADOW = "[[data-overlay-bg=transparent]_&]:shadow-[0_18px_48px_-16px_rgba(0,0,0,0.7)]";

function Card({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border border-white/10 bg-[#111113]", SHADOW, className)} style={{ borderRadius: "calc(var(--u) * 1.2)", ...style }} {...rest}>
      {children}
    </div>
  );
}

function Overlay({ d, poll, top }: { d: EventDetail; poll: PollState; top: boolean }) {
  const { rail, now: dataNow } = useWatchRail(d);
  // "On the field" turns on at a match's start time, so the clock is read again every 15 s, not only on new data.
  const tick = useNow(15_000);
  const m = overlayModel(d, rail, Math.max(dataNow, tick));
  return (
    <>
      {/* The corner bug: top left, or bottom left when the bar takes the top. */}
      <Bug d={d} poll={poll} className={top ? "bottom-[calc(var(--u)*3)]" : "top-[calc(var(--u)*3)]"} />
      <div className={cn("absolute left-1/2 -translate-x-1/2", top ? "top-[calc(var(--u)*4.5)]" : "bottom-[calc(var(--u)*4.5)]")} style={{ width: bu(150) }} aria-live="polite">
        <Bar d={d} m={m} />
      </div>
    </>
  );
}

function Bug({ d, poll, className }: { d: EventDetail; poll: PollState; className: string }) {
  return (
    <Card className={cn("absolute left-[calc(var(--u)*3)] flex max-w-[calc(var(--u)*90)] items-center gap-[calc(var(--u)*1.2)] py-[calc(var(--u)*0.9)] pl-[calc(var(--u)*1)] pr-[calc(var(--u)*1.8)]", className)} data-overlay-bug>
      <img src="/logo.png" alt="Control Scout" className="shrink-0" style={{ width: "calc(var(--u) * 4.2)", height: "calc(var(--u) * 4.2)" }} />
      <div className="min-w-0">
        <p className="truncate font-display font-semibold leading-tight tracking-tight" style={u(2)}>{d.event.name}</p>
        <p className="flex items-center gap-[calc(var(--u)*0.8)] leading-tight text-zinc-400" style={u(1.4)}>
          <span className="font-display font-semibold" style={{ color: GOLD }}>Control Scout</span>
          {poll !== "ok"
            ? <span className="flex items-center gap-[calc(var(--u)*0.5)] text-amber-400" role="status"><span className="inline-block size-[calc(var(--u)*0.8)] rounded-full bg-amber-400" aria-hidden />{poll === "saved" ? "Offline" : "Reconnecting…"}</span>
            : d.event.status === "live" && <span className="font-semibold text-[#f43f5e]">● Live</span>}
        </p>
      </div>
    </Card>
  );
}

const tint = (c: string, pct = 16) => ({ background: `color-mix(in srgb, ${c} ${pct}%, transparent)` });

function Bar({ d, m }: { d: EventDetail; m: OverlayModel }) {
  const p = m.prediction;
  const played = m.kind !== "now" && m.kind !== "empty";
  const clock = m.kind === "now" && m.heading === "Up next" && m.match ? venueClock(m.match, d.event.timezone) : null;
  return (
    <div className={cn("relative overflow-hidden border border-white/10 bg-[#111113]", SHADOW)} style={{ borderRadius: bu(1.4) }} data-overlay-bar={m.kind}>
      <div className="flex items-stretch" style={{ minHeight: bu(11) }}>
        {/* The match: gold, the site's accent. */}
        <div className="flex shrink-0 flex-col justify-center text-[#0a0a0b]" style={{ background: GOLD, width: bu(17), padding: `0 ${bu(1.8)}` }}>
          <span className={cn("leading-tight", m.match ? "font-semibold uppercase tracking-[0.1em]" : "font-display font-bold tracking-tight")} style={bf(m.match ? 1.3 : 2.4)}>{m.heading}</span>
          {m.match && <span className="font-display font-bold leading-none tracking-tight tabular-nums" style={bf(m.match.label.length > 4 ? 3.6 : 4.6)}>{m.match.label}</span>}
          {clock && <span className="font-mono leading-tight" style={bf(1.3)}>{clock}</span>}
        </div>
        {m.match ? (
          <>
            <Side side={m.red} color={RED} align="left" big={played ? m.red.score : p ? oddsPct(p.pRed) : null} label={played ? null : p ? "to win" : null} played={played} />
            <Middle m={m} />
            <Side side={m.blue} color={BLUE} align="right" big={played ? m.blue.score : p ? oddsPct(1 - p.pRed) : null} label={played ? null : p ? "to win" : null} played={played} />
          </>
        ) : (
          <div className="flex flex-1 items-center text-zinc-300" style={{ ...bf(2.2), padding: `0 ${bu(2.4)}` }}>
            {d.event.status === "finished" ? "This event is over. No match results were posted." : d.matches.length ? "Every posted match is played. The next ones show here once they're posted." : "The match schedule isn't posted yet. This bar fills in by itself once it is."}
          </div>
        )}
      </div>
      {/* The call as a split bar along the bottom edge (unplayed matches). */}
      {m.kind === "now" && p && (
        <div className="flex w-full" style={{ height: bu(0.55) }} role="img" aria-label={`Red ${oddsPct(p.pRed)} to win, blue ${oddsPct(1 - p.pRed)}`}>
          <div style={{ width: `${Math.max(2, Math.min(98, p.pRed * 100))}%`, background: RED }} />
          <div className="flex-1" style={{ background: BLUE }} />
        </div>
      )}
    </div>
  );
}

function Side({ side, color, align, big, label, played }: { side: OverlaySide; color: string; align: "left" | "right"; big: string | number | null; label: string | null; played: boolean }) {
  const three = side.teams.length > 2;
  const dim = played && !side.won;
  const teams = (
    <div className={cn("flex min-w-0 flex-1 gap-x-[calc(var(--bu)*2.2)]", align === "right" && "justify-end text-right")}>
      {side.teams.map((t) => (
        <div key={t.number} className="min-w-0">
          <p className="font-display font-bold leading-none tracking-tight tabular-nums text-zinc-50" style={bf(three ? 2.8 : 3.4)}>{t.number}</p>
          {shortName(t.name, three ? 16 : 22) && <p className="mt-[calc(var(--bu)*0.4)] truncate leading-tight text-zinc-300" style={{ ...bf(1.35), maxWidth: bu(three ? 13 : 19) }}>{shortName(t.name, three ? 16 : 22)}</p>}
        </div>
      ))}
    </div>
  );
  const number = big != null && (
    <div className={cn("flex shrink-0 flex-col justify-center", align === "left" ? "items-end text-right" : "items-start text-left")}>
      <span className={cn("font-display font-bold leading-none tabular-nums", dim ? "text-zinc-400" : "text-zinc-50")} style={{ ...bf(played ? 5.2 : 4.4), ...(!played ? { color: color === RED ? "#fb7185" : BLUE } : {}) }}>{big}</span>
      {label && <span className="font-semibold uppercase tracking-[0.1em] text-zinc-400" style={bf(1.1)}>{label}</span>}
    </div>
  );
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-[calc(var(--bu)*2)]" style={{ ...tint(color, played && side.won ? 24 : 15), padding: `${bu(1.4)} ${bu(2.2)}` }} data-overlay-side={color === RED ? "red" : "blue"}>
      {/* The alliance's colour as a strip on its outer edge. */}
      <span aria-hidden className={cn("absolute inset-y-0", align === "left" ? "left-0" : "right-0")} style={{ width: bu(0.5), background: color }} />
      {align === "left" ? <>{teams}{number}</> : <>{number}{teams}</>}
      <span className="sr-only">{color === RED ? "Red alliance" : "Blue alliance"}</span>
    </div>
  );
}

function Middle({ m }: { m: OverlayModel }) {
  const p = m.prediction;
  if (m.kind === "now") {
    return (
      <div className="flex shrink-0 flex-col items-center justify-center text-center" style={{ width: bu(17), padding: `0 ${bu(1)}` }}>
        <span className="font-display font-bold text-zinc-500" style={bf(2.2)}>VS</span>
        <span className="leading-tight text-zinc-400" style={bf(1.2)}>{p ? tierWords(p.tier) : "No call yet"}</span>
      </div>
    );
  }
  const tie = m.red.score != null && m.red.score === m.blue.score;
  const words = callWords(p);
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-[calc(var(--bu)*0.5)] text-center" style={{ width: bu(17), padding: `0 ${bu(1)}` }}>
      {m.verdict ? (
        <span className={cn("rounded-full font-semibold", m.verdict === "called" ? "bg-emerald-400/15 text-emerald-300" : "bg-orange-400/15 text-orange-300")} style={{ ...bf(1.5), padding: `${bu(0.3)} ${bu(1.2)}` }}>
          {m.verdict === "called" ? "✓ Called it" : "Upset"}
        </span>
      ) : <span className="font-display font-bold text-zinc-400" style={bf(1.8)}>{tie ? "Tie" : "Final"}</span>}
      <span className="leading-tight text-zinc-400" style={bf(1.15)}>
        {words ? <>{words}{p?.kind === "backtest" ? " (replayed)" : ""}<br />{tierWords(p!.tier)}</> : "No call logged"}
      </span>
    </div>
  );
}

/** The time, re-read every `every` ms. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
