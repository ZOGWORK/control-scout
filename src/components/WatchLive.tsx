// Watch live (event page): the event's YouTube stream with the model's calls beside it. Shown only when the
// owner has set a stream (server/portal/streams.ts). The player is a click-to-play facade (a thumbnail and a
// play button; the youtube-nocookie iframe loads only on a click, never autoplaying on its own), so the page
// costs one image for everyone who doesn't watch. The rail (lib/watchRail.ts) follows the event page's own
// live refresh: the match being called, its result and verdict for a minute once it's in, then the next one.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Play, X } from "lucide-react";
import type { EventDetail, EventStream, MatchView } from "../shared/api";
import { thumbnailUrl } from "../shared/stream";
import { oddsPct } from "../shared/share";
import { nextFlip, railModel, verdict, type Flip } from "../lib/watchRail";
import { venueClock } from "../lib/liveMode";
import { TierMark, WinBar } from "./predict";
import { cn } from "./cn";

export const WATCH_ID = "watch-live";

export function WatchLive({ d, stream }: { d: EventDetail; stream: EventStream }) {
  const finished = d.event.status === "finished";
  return (
    <section id={WATCH_ID} aria-labelledby={`${WATCH_ID}-h`} className="mb-8 scroll-mt-bar-4" data-watch-live>
      <h2 id={`${WATCH_ID}-h`} className="mb-3 font-display text-lg font-semibold text-foreground">{finished ? "Watch the stream" : "Watch live"}</h2>
      <div className={cn("grid gap-4", !finished && "lg:grid-cols-3")}>
        <div className={cn("min-w-0", finished ? "max-w-4xl" : "lg:col-span-2")}>
          <Player stream={stream} title={`${d.event.name} live stream`} />
          {finished && <p className="mt-2 text-sm text-muted-foreground">Event finished — this is the recording.</p>}
        </div>
        {!finished && <PredictionRail d={d} />}
      </div>
    </section>
  );
}

function Player({ stream, title }: { stream: EventStream; title: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
      {on ? (
        // Loaded by the click, so autoplay here is the viewer's own choice.
        <iframe className="absolute inset-0 size-full" src={`${stream.streamUrl}?autoplay=1&rel=0`} title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Play: ${title}`} data-stream-facade>
          <img src={thumbnailUrl(stream.videoId)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover opacity-80 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
          <span className="relative grid size-16 place-items-center rounded-full bg-[#ff0033] text-white shadow-lg sm:size-20"><Play className="size-7 translate-x-0.5 fill-current sm:size-9" aria-hidden /></span>
        </button>
      )}
    </div>
  );
}

/** The rail's state across refreshes: which match it was calling, and a result it's showing (lib/watchRail.ts). */
function useRail(d: EventDetail) {
  const [flip, setFlip] = useState<Flip | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const calling = useRef<string | null>(null);
  const rail = railModel(d, now, flip);
  // New data: did the match being called just get its result? Then show it before moving on.
  useEffect(() => {
    const t = Date.now();
    setFlip((f) => nextFlip(calling.current, d.matches, t, f));
    setNow(t);
  }, [d.matches]);
  useEffect(() => { calling.current = rail.current?.key ?? null; }, [rail.current?.key]);
  // Wake once when a shown result is due to give way.
  useEffect(() => {
    if (!flip || flip.until <= now) return;
    const id = setTimeout(() => setNow(Date.now()), flip.until - now);
    return () => clearTimeout(id);
  }, [flip, now]);
  return rail;
}

function PredictionRail({ d }: { d: EventDetail }) {
  const rail = useRail(d);
  const tz = d.event.timezone;
  const lead = rail.result ?? rail.current;
  return (
    <aside aria-label="Live predictions" className="flex min-w-0 flex-col gap-3 self-start lg:sticky lg:top-[calc(var(--header-h)+1rem)]" data-prediction-rail>
      <div className="rounded-2xl border border-border bg-card p-4" aria-live="polite">
        {lead ? (
          <>
            <p className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{rail.result ? "Just finished" : "Calling now"} · <span className="text-foreground">{lead.label}</span></span>
              {!rail.result && <span className="font-normal normal-case tracking-normal">{venueClock(lead, tz) ?? ""}</span>}
            </p>
            <Lineup m={lead} season={d.event.season} />
            {rail.result ? <Result m={rail.result} /> : <Call m={lead} />}
          </>
        ) : <p className="text-sm text-muted-foreground">{d.matches.length ? "Every scheduled match has been played." : "No schedule posted yet: calls appear here once it is."}</p>}
      </div>
      {(rail.result ? [rail.current, ...rail.upNext].filter((m): m is MatchView => !!m).slice(0, 3) : rail.upNext).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</p>
          <ol className="mt-2 divide-y divide-border">
            {(rail.result ? [rail.current, ...rail.upNext].filter((m): m is MatchView => !!m).slice(0, 3) : rail.upNext).map((m) => <Compact key={m.key} m={m} tz={tz} />)}
          </ol>
        </div>
      )}
    </aside>
  );
}

function Lineup({ m, season }: { m: MatchView; season: number }) {
  const side = (c: "red" | "blue") => {
    const on = m.played ? m[c].teams.filter((t) => t.onField) : m[c].teams;
    return (
      <div className={cn("flex flex-1 flex-wrap justify-center gap-1.5 rounded-lg px-2 py-1.5", c === "red" ? "bg-red-alliance/12" : "bg-blue-alliance/12")}>
        {(on.length ? on : m[c].teams).map((t) => (
          <Link key={t.number} to={`/teams/${t.number}?season=${season}`} className={cn("rounded-md px-1.5 py-0.5 font-display text-lg font-semibold tabular-nums hover:bg-foreground/10", c === "red" ? "text-red-alliance" : "text-blue-alliance")}>{t.number}</Link>
        ))}
        {m.played && m[c].score && <span className="ml-auto self-center font-display text-lg font-bold tabular-nums">{m[c].score!.total}</span>}
      </div>
    );
  };
  return <div className="mt-3 flex gap-2">{side("red")}{side("blue")}</div>;
}

function Call({ m }: { m: MatchView }) {
  const p = m.prediction;
  if (!p) return <p className="mt-3 text-sm text-muted-foreground">No call for this match yet.</p>;
  return (
    <div className="mt-3">
      <WinBar pRed={p.pRed} />
      <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-red-alliance">{oddsPct(p.pRed)}</span>
        <span className="flex items-center gap-2 text-muted-foreground">{!p.noScoreBasis && <span className="tabular-nums">{Math.round(p.redMean)}–{Math.round(p.blueMean)}</span>}<TierMark tier={p.tier} chip /></span>
        <span className="font-semibold text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
      </div>
    </div>
  );
}

function Result({ m }: { m: MatchView }) {
  const p = m.prediction;
  const v = verdict(m);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {v === "called" && <span className="inline-flex items-center gap-1 rounded-md bg-success/12 px-2 py-0.5 font-medium text-success"><Check className="size-3.5" aria-hidden /> Called it</span>}
      {v === "upset" && <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-2 py-0.5 font-medium text-warning"><X className="size-3.5" aria-hidden /> Upset</span>}
      {p ? <span className="text-muted-foreground">Predicted {p.pRed === 0.5 ? "an even match" : p.pRed > 0.5 ? `red ${oddsPct(p.pRed)}` : `blue ${oddsPct(1 - p.pRed)}`}{p.kind === "backtest" ? " (replayed)" : ""}</span>
        : <span className="text-muted-foreground">No call was logged for this match.</span>}
      {p && <TierMark tier={p.tier} chip />}
    </div>
  );
}

function Compact({ m, tz }: { m: MatchView; tz: string | null }) {
  const p = m.prediction;
  const teams = (c: "red" | "blue") => m[c].teams.map((t) => t.number).join(" ");
  return (
    <li className="py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{m.label}</span>
        <span className="text-xs text-muted-foreground">{venueClock(m, tz) ?? ""}</span>
      </div>
      <div className="mt-0.5 flex justify-between gap-2 font-mono text-xs tabular-nums">
        <span className="text-red-alliance">{teams("red")}</span>
        <span className="text-blue-alliance">{teams("blue")}</span>
      </div>
      {p && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="w-8 text-red-alliance">{oddsPct(p.pRed)}</span>
          <WinBar pRed={p.pRed} size="sm" decorative />
          <span className="w-8 text-right text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
          {!p.noScoreBasis && <span className="whitespace-nowrap text-muted-foreground tabular-nums">{Math.round(p.redMean)}–{Math.round(p.blueMean)}</span>}
          <TierMark tier={p.tier} />
        </div>
      )}
    </li>
  );
}
