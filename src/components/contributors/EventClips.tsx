// An event page's match videos (docs/contributors.md), for whoever is looking:
//   - the coverage line, by the watch buttons: "Every match has video", "Partially recorded — 12 of 48 matches have
//     video", or "No recording for this event — stats only." (the search page's words), counting only what this
//     viewer can watch;
//   - "Watch Clips", only when there's at least one (never a dead button), which scrolls to
//   - the clips gallery: every played match with a video, as tiles (picture, match, score, and for a video someone
//     added the credit and likes), filtered All / Qualifications / Playoffs like search's video page.
// Each match plays what pickMatchVideo says (src/shared/contributors.ts), the same order as every other surface.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Clapperboard, Play, PlayCircle } from "lucide-react";
import type { EventDetail, MatchView } from "../../shared/api";
import { coverageText, pickMatchVideo, type ContributorVideo, type EventCoverage } from "../../shared/contributors";
import { thumbnailUrl } from "../../shared/stream";
import { clipTime, linkStart } from "../../shared/recording";
import { youtubeId } from "../../shared/personal";
import { useEventVideos, useReloadOnVideoChange } from "../../lib/contributors";
import { playMatchVideo } from "../../lib/streamSeek";
import { scrollToElement, smoothBehavior } from "../../lib/pageScroll";
import { Button } from "../ui/button";
import { VideoCredit } from "./VideoCredit";
import { cn } from "../cn";

export const CLIPS_ID = "clips";

interface Clips { byKey: Record<string, ContributorVideo>; coverage: EventCoverage | null }
const Ctx = createContext<Clips>({ byKey: {}, coverage: null });

/** The event's contributor videos for this viewer, for the page's coverage line, button, gallery and match rows. */
export function EventClipsProvider({ season, code, children }: { season: number; code: string; children: ReactNode }) {
  const s = useEventVideos(season, code);
  useReloadOnVideoChange(s.reload);
  const value = useMemo<Clips>(() => ({ byKey: s.data?.matches ?? {}, coverage: s.data?.coverage ?? null }), [s.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useContributorVideo = (key: string): ContributorVideo | undefined => useContext(Ctx).byKey[key];

type Item = { m: MatchView; play: { videoId: string; t: number }; kind: "first" | "contributor" | "recording"; c?: ContributorVideo };

/** Every played match with a video this viewer can watch, in the event's order. */
export function useClipItems(matches: MatchView[]): Item[] {
  const { byKey } = useContext(Ctx);
  return useMemo(() => matches.filter((m) => m.played).flatMap((m): Item[] => {
    const first = m.video && youtubeId(m.video) ? { videoId: youtubeId(m.video)!, t: linkStart(m.video) } : null;
    const pick = pickMatchVideo(first, byKey[m.key], m.clip);
    if (!pick) return [];
    if (pick.kind === "contributor") return [{ m, kind: "contributor", play: { videoId: pick.video.videoId, t: pick.video.t }, c: pick.video }];
    if (pick.kind === "first") return [{ m, kind: "first", play: pick.video }];
    return [{ m, kind: "recording", play: { videoId: pick.video.videoId, t: pick.video.t } }];
  }), [matches, byKey]);
}

/** The coverage line, as this viewer can watch it. Nothing until it's known (no flash of "no recording"). */
export function CoverageLine({ className }: { className?: string }) {
  const { coverage } = useContext(Ctx);
  if (!coverage || !coverage.played) return null;
  return <p className={cn("mt-3 flex items-center gap-1.5 text-sm text-text-muted", className)} data-coverage={coverage.withVideo >= coverage.played ? "full" : coverage.withVideo ? "partial" : "none"}><Clapperboard className="size-4 shrink-0" aria-hidden />{coverageText(coverage)}</p>;
}

/** "Watch Clips": shown only when the event has at least one clip this viewer can watch. */
export function WatchClipsButton({ matches, primary }: { matches: MatchView[]; primary?: boolean }) {
  const n = useClipItems(matches).length;
  if (!n) return null;
  const go = () => { const el = document.getElementById(CLIPS_ID); if (el) scrollToElement(el, smoothBehavior()); };
  return <Button size="sm" variant={primary ? "default" : "outline"} onClick={go} data-watch-clips><PlayCircle /> Watch Clips</Button>;
}

type Level = "all" | "qual" | "playoff";
const LEVELS: Record<Level, string> = { all: "All", qual: "Qualifications", playoff: "Playoffs" };
const FIRST_TILES = 12;

export function ClipsGallery({ d }: { d: Pick<EventDetail, "matches"> }) {
  const items = useClipItems(d.matches);
  const [level, setLevel] = useState<Level>("all");
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const levels = (["qual", "playoff"] as const).filter((l) => items.some((i) => i.m.level === l));
  const shown = items.filter((i) => level === "all" || i.m.level === level);
  return (
    <section id={CLIPS_ID} className="scroll-mt-bar-4 mt-6" aria-labelledby="clips-title" data-clips-gallery>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="clips-title" className="font-display text-lg font-semibold">Clips · {shown.length}</h2>
        {levels.length > 1 && (
          <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-line p-0.5 text-xs font-medium">
            {(["all", ...levels] as Level[]).map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => { setLevel(l); setAll(false); }} data-clips-level={l}
                className={cn("min-h-9 rounded-md px-3 pointer-coarse:min-h-11", level === l ? "bg-text-base text-primary" : "text-text-muted hover:text-text-base")}>{LEVELS[l]}</button>
            ))}
          </div>
        )}
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(all ? shown : shown.slice(0, FIRST_TILES)).map((i) => <ClipTile key={i.m.key} i={i} />)}
      </ul>
      {!all && shown.length > FIRST_TILES && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 min-h-11 w-full rounded-lg border border-line text-sm font-medium hover:bg-text-base/[0.04]">Show all {shown.length}</button>
      )}
    </section>
  );
}

function ClipTile({ i }: { i: Item }) {
  const { m } = i;
  const r = m.red.score?.total, b = m.blue.score?.total;
  const won = r != null && b != null ? (r > b ? "red" : b > r ? "blue" : null) : null;
  const what = i.kind === "first" ? "Official match video" : i.kind === "recording" ? `In the recording, from ${clipTime(i.play.t)}` : null;
  return (
    <li className="min-w-0" data-clip-tile={m.label}>
      <button type="button" onClick={() => playMatchVideo({ ...i.play, label: m.label, matchKey: m.key })} className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Play ${m.label}${i.c ? `: video by ${i.c.name}` : what ? `: ${what}` : ""}`}>
        <span className="relative block aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
          <img src={thumbnailUrl(i.play.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-90 group-hover:opacity-100" />
          <span className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/40"><Play className="size-6 translate-x-px fill-current" aria-hidden /></span></span>
        </span>
        <span className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{m.label}</span>
          {r != null && b != null && (
            <span className="text-sm tabular-nums">
              <span className={cn("text-red-alliance-text", won === "red" && "font-bold")}>{r}</span><span className="text-text-muted">–</span><span className={cn("text-blue-alliance-text", won === "blue" && "font-bold")}>{b}</span>
            </span>
          )}
        </span>
      </button>
      {i.c ? <VideoCredit c={i.c} size="sm" /> : <p className="text-xs text-text-muted">{what}</p>}
    </li>
  );
}

/** A match row's mark for a video someone added (when it's the one the match plays): plays it in the app. */
export function ContributorRowMark({ m, className }: { m: MatchView; className?: string }) {
  const c = useContributorVideo(m.key);
  if (!c || (m.video && !c.overFirst)) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); playMatchVideo({ videoId: c.videoId, t: c.t, label: m.label, matchKey: m.key }); }}
      className={cn("inline-flex items-center", className)} aria-label={`Watch ${m.label}: video by ${c.name}`} title={`Video by ${c.name}`} data-contributor-mark>
      <PlayCircle className="size-3.5 shrink-0" aria-hidden />
    </button>
  );
}
