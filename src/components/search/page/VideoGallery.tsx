// A video page's list on /search (a "videos" block: server/api/query/highlights.ts, a team's in
// server/api/answers/highlights.ts): "jackson division recap", "watch worlds", "4215 videos at worlds", and every
// match's video under a scope's highlights. Each event's own stream first, then every match with a video in the
// events' order, filtered by qualifications or playoffs. A tile is the match's video, its label, both alliances' team
// numbers and the score in their colours; a tap plays it in the app's video dialog (./AnswerVideo.tsx), one at a time,
// so the page loads pictures only. A match with no video isn't drawn; when nothing here has one, one line says so and
// links where to look. One column on a phone.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import type { SearchVideoItem } from "../../../shared/api";
import type { StatBlock, VideoTile } from "../../../shared/searchStat";
import { useClips } from "./AnswerVideo";
import { Picture } from "./HighlightGrid";
import { cn } from "../../cn";

type Videos = Extract<StatBlock, { kind: "videos" }>;
type Level = "all" | "qual" | "playoff";

/** Tiles shown before "Show all". */
const FIRST = 24;
const H3 = "text-xs font-semibold text-muted-foreground";
const LEVELS: Record<Level, string> = { all: "All", qual: "Qualifications", playoff: "Playoffs" };

export function VideoGallery({ b }: { b: Videos }) {
  const { clip, play } = useClips();
  const [level, setLevel] = useState<Level>("all");
  const [all, setAll] = useState(false);
  const withVideo = b.tiles.filter((t) => clip(t.href));
  const streams = (b.streams ?? []).filter((s) => clip(s.href));
  if (!withVideo.length && !streams.length) {
    return b.empty ? (
      <p className="text-sm text-foreground" data-videos-empty>
        {b.empty.text}{b.empty.href && <> <Link to={b.empty.href} className="font-medium underline decoration-border underline-offset-2 hover:text-accent-text max-md:inline-flex max-md:min-h-11 max-md:items-center">{b.empty.href.startsWith("/teams/") ? "Open the team's page" : "Open the event"}</Link></>}
      </p>
    ) : null;
  }
  const levels = (["qual", "playoff"] as const).filter((l) => withVideo.some((t) => t.level === l));
  const shown = withVideo.filter((t) => level === "all" || t.level === level);
  return (
    <div className="space-y-5" data-block="videos">
      {!!streams.length && (
        <section aria-label="Full streams">
          <h3 className={cn(H3, "mb-2")}>{streams.length === 1 ? "Full stream" : "Full streams"}</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {streams.map((s) => {
              const v = clip(s.href)!;
              return (
                <li key={s.href} className="min-w-0" data-video-stream={s.label}>
                  <button type="button" onClick={() => play(v, s.label)} aria-label={`Play ${s.label}: the event's ${v.live ? "live stream" : "recording"}`}
                    className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                    <Picture v={v} />
                    <span className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground"><Radio className="size-3.5 shrink-0" aria-hidden />{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!!withVideo.length && (
        <section aria-label={b.title}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className={H3}>{b.title} · {shown.length}</h3>
            {levels.length > 1 && (
              <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
                {(["all", ...levels] as Level[]).map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => { setLevel(l); setAll(false); }} data-video-level={l}
                    className={cn("min-h-9 rounded-md px-3 max-md:min-h-11 pointer-coarse:min-h-11", level === l ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                    {LEVELS[l]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(all ? shown : shown.slice(0, FIRST)).map((t) => <Tile key={t.href} t={t} onPlay={() => play(clip(t.href)!, `${t.label}${t.event ? ` · ${t.event}` : ""}`)} v={clip(t.href)!} />)}
          </ul>
          {!all && shown.length > FIRST && (
            <button type="button" onClick={() => setAll(true)} className="mt-3 min-h-11 w-full rounded-lg border border-border text-sm font-medium text-foreground hover:bg-text-base/[0.04]" data-video-more>
              Show all {shown.length}
            </button>
          )}
        </section>
      )}
      {b.more && <p className="text-[11px] text-muted-foreground">{b.more}</p>}
    </div>
  );
}

/** A match: its video (a tap plays it), label, event when several and day, both alliances' teams and the score, each
 *  in its alliance's colour, the winner's score bold. */
function Tile({ t, v, onPlay }: { t: VideoTile; v: SearchVideoItem; onPlay: () => void }) {
  const won = t.redScore > t.blueScore ? "red" : t.blueScore > t.redScore ? "blue" : null;
  return (
    <li className="min-w-0" data-video-tile={t.label}>
      <button type="button" onClick={onPlay} aria-label={`Play ${t.label}${t.event ? ` · ${t.event}` : ""}: ${t.red.join(" ")} vs ${t.blue.join(" ")}, ${t.redScore}–${t.blueScore}`}
        className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <Picture v={v} />
        <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-foreground">{t.label}</span>
          {(t.event || t.date) && <span className="text-xs text-muted-foreground">{[t.event, t.date].filter(Boolean).join(" · ")}</span>}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-xs tabular-nums">
          <span className="min-w-0 truncate">
            <span className="text-red-alliance-text">{t.red.join(" ")}</span><span className="text-muted-foreground"> vs </span><span className="text-blue-alliance-text">{t.blue.join(" ")}</span>
          </span>
          <span className="shrink-0 text-sm" data-tile-score>
            <span className={cn("text-red-alliance-text", won === "red" && "font-bold")}>{t.redScore}</span>
            <span className="text-muted-foreground">–</span>
            <span className={cn("text-blue-alliance-text", won === "blue" && "font-bold")}>{t.blueScore}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
