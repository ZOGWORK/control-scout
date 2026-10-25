// Broadcast overlay (/events/:season/:code/overlay): a lower-third for an event's stream, added in OBS as a
// browser source (1920×1080) on top of the video. No site chrome (the Shell steps aside, as for the pit
// display), a transparent page OBS composites (or ?bg=green for a chroma key), and sizes that scale with
// its frame like the pit display's (--u is 1% of the height in a 16:9 frame). What the bar shows lives in
// lib/overlay.ts, picked the way the Watch live rail picks (lib/watchRail.ts).
//
// Opened in an ordinary browser tab (no window.obsstudio, no ?clean=1: lib/overlay.ts isBroadcastSource) it's a
// preview instead: the same frame at 16:9 on a checkerboard (the see-through part), under a bar with the way back
// to the event, the options and the link to copy into OBS. On its own the bare page is a blank screen with a small
// bar at the bottom and nothing to click, which reads as a broken site.
//
// Fresh data comes as the pit display gets it (lib/pitPoll.ts useDisplayPoll: the event's own request, its
// ETag making a quiet poll a 304; 20–30 s while live, else every 5 minutes; after a failure 5, 10, 20, 30 s and
// a small "Reconnecting…" in the corner bug).
import { useEffect, useState, type CSSProperties, type HTMLAttributes } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { useDisplayPoll, type PollState } from "../lib/pitPoll";
import { copyText } from "../lib/clipboard";
import { useWatchRail } from "../lib/useWatchRail";
import { CHROMA_GREEN, callWords, isBroadcastSource, overlayModel, overlayOptions, overlaySearch, shortName, type OverlayModel, type OverlayOptions, type OverlaySide } from "../lib/overlay";
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
  const bare = isBroadcastSource(opts);
  // Sizes come from the frame itself (a size container: the whole screen in OBS, the 16:9 box in the preview).
  const frame: CSSProperties = {
    background: opts.bg === "green" ? CHROMA_GREEN : "transparent",
    containerType: "size",
    ["--u" as string]: "min(1cqh, 0.5625cqw)",
    // The bar is 150 --bu wide: never wider than the frame less the corner margins, whatever the scale asks.
    ["--bu" as string]: `min(calc(min(1cqh, 0.5625cqw) * ${opts.scale}), calc((100cqw - min(1cqh, 0.5625cqw) * 6) / 150))`,
  };
  const content = (
    <div className={cn("overflow-hidden font-sans text-zinc-100 antialiased", bare ? "fixed inset-0" : "absolute inset-0")} style={frame} data-overlay data-overlay-bg={opts.bg}>
      {status === 404 || status === 400 ? (
        <Card className="absolute left-[calc(var(--u)*3)] top-[calc(var(--u)*3)] px-[calc(var(--u)*2)] py-[calc(var(--u)*1.4)]" style={u(2)} role="alert">
          No event {code} in {season}. Check the overlay's address.
        </Card>
      ) : state.data ? <Overlay d={state.data} poll={poll} top={opts.pos === "top"} /> : (
        <p className="sr-only" role="status">{state.error ? "Can't reach Control Scout. Retrying…" : "Loading the event…"}</p>
      )}
    </div>
  );
  if (bare) return content;
  return <Preview season={season ?? ""} code={code ?? ""} name={state.data?.event.name ?? null} opts={opts}>{content}</Preview>;
}

/** Light and dark squares: the parts of the overlay a stream shows its video through. */
const CHECKER: CSSProperties = {
  backgroundColor: "#2a2a2e",
  backgroundImage: "linear-gradient(45deg, #3a3a40 25%, transparent 25%), linear-gradient(-45deg, #3a3a40 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a40 75%), linear-gradient(-45deg, transparent 75%, #3a3a40 75%)",
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0",
};

/** The overlay in an ordinary tab: a 16:9 preview under a bar with the way back, the options and the link for OBS. */
function Preview({ season, code, name, opts, children }: { season: string; code: string; name: string | null; opts: OverlayOptions; children: React.ReactNode }) {
  const nav = useNavigate();
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const eventHref = `/events/${season}/${encodeURIComponent(code)}`;
  const set = (o: Partial<OverlayOptions>) => nav({ search: overlaySearch({ ...opts, ...o, clean: false }) }, { replace: true });
  const link = `${window.location.origin}${eventHref}/overlay${overlaySearch({ ...opts, clean: true })}`;
  // The site's copy (with its fallback for plain HTTP on a venue network); toasts are hidden on this route, so the
  // outcome shows here: "Copied", or the link itself to select by hand.
  const copy = async () => {
    const ok = await copyText(link, "Link copied", "Couldn't copy the link", link);
    setCopied(ok ? "yes" : "failed");
    if (ok) setTimeout(() => setCopied((c) => (c === "yes" ? "no" : c)), 2000);
  };
  const seg = (on: boolean) => cn("h-8 rounded-md px-2.5 text-xs font-semibold", on ? "bg-[#ffc700] text-[#0a0a0b]" : "text-zinc-300 hover:bg-white/10");
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0a0b] font-sans text-zinc-100 antialiased" data-overlay-preview>
      <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={eventHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-sm font-medium hover:bg-white/10"><ArrowLeft className="size-4" aria-hidden /> Back to event</Link>
          <button type="button" onClick={copy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#ffc700] px-3 text-sm font-semibold text-[#0a0a0b]" data-overlay-copy>
            {copied === "yes" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied === "yes" ? "Copied" : "Copy link for OBS"}
          </button>
        </div>
        {copied === "failed" && (
          <label className="flex flex-col gap-1 text-sm text-amber-300" data-overlay-copy-failed>
            This browser wouldn't copy it. Select the link and copy it yourself:
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-9 rounded-lg border border-white/15 bg-white/5 px-3 font-mono text-xs text-zinc-100" />
          </label>
        )}
        <div>
          <h1 className="font-display text-lg font-semibold">Stream overlay{name ? `: ${name}` : ""}</h1>
          <p className="text-sm text-zinc-400">
            A preview of what goes over your stream. In OBS: Sources, +, Browser, paste the link, width 1920, height 1080.
            The squares are see-through there.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">Background
            <span className="flex rounded-lg border border-white/15 p-0.5"><button type="button" className={seg(opts.bg === "transparent")} aria-pressed={opts.bg === "transparent"} onClick={() => set({ bg: "transparent" })}>See-through</button><button type="button" className={seg(opts.bg === "green")} aria-pressed={opts.bg === "green"} onClick={() => set({ bg: "green" })}>Green screen</button></span>
          </span>
          <span className="flex items-center gap-1.5">Bar
            <span className="flex rounded-lg border border-white/15 p-0.5"><button type="button" className={seg(opts.pos === "bottom")} aria-pressed={opts.pos === "bottom"} onClick={() => set({ pos: "bottom" })}>Bottom</button><button type="button" className={seg(opts.pos === "top")} aria-pressed={opts.pos === "top"} onClick={() => set({ pos: "top" })}>Top</button></span>
          </span>
          <span className="flex items-center gap-1.5">Size
            <span className="flex rounded-lg border border-white/15 p-0.5">{([["S", 0.8], ["M", 1], ["L", 1.2]] as const).map(([l, v]) => <button key={l} type="button" className={seg(opts.scale === v)} aria-pressed={opts.scale === v} onClick={() => set({ scale: v })}>{l}</button>)}</span>
          </span>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/15" style={CHECKER} data-overlay-frame>
          {children}
        </div>
      </div>
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
  const { rail, flip, now: dataNow } = useWatchRail(d);
  // "On the field" turns on at a match's start time, so the clock is read again every 15 s, not only on new data.
  const tick = useNow(15_000);
  const m = overlayModel(d, rail, Math.max(dataNow, tick), flip);
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
