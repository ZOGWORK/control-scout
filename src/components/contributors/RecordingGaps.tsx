// What a recorded event's video doesn't cover, under the coverage line (server/videos/coverage.ts): each day or part
// with its share of clips, a day with no recording, and, one tap away, the matches without a clip and why. Only for an
// event with a recording where some played match has no video at all: a fully covered one shows nothing more.
import { useMemo } from "react";
import { Check, CircleSlash, TriangleAlert } from "lucide-react";
import type { ClipCoverage, MatchView } from "../../shared/api";
import { labelRanges, missingGroups } from "../../shared/coverage";
import { useApi } from "../../lib/api";
import { useContributorVideos } from "./EventClips";
import { cn } from "../cn";

/** What the page's coverage depends on, as a short hash: which played matches have no video and their times (FIRST
 *  posting a real start), each clip's video, and the recording's own videos (one swapped for another). Any change asks
 *  again, not only a change in how many. */
export function missingSignature(played: Pick<MatchView, "key" | "clip" | "video" | "time">[], videos: string[] = []): string {
  let h = 5381;
  const add = (s: string) => { for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; };
  for (const m of played) add(!m.clip && !m.video ? `${m.key}@${m.time ?? ""};` : m.clip ? `${m.key}=${m.clip.videoId};` : "");
  for (const v of videos) add(`v:${v};`);
  return `${played.length}-${h.toString(36)}`;
}

/** A day or part's chip: done (every match it holds clipped), short of clips, or holding no played match at all. */
export function chipTone(v: { matches: number; clipped: number }): "done" | "short" | "none" {
  return v.matches === 0 ? "none" : v.clipped >= v.matches ? "done" : "short";
}

export const coveragePath = (season: number, code: string) => `/api/events/${season}/${encodeURIComponent(code)}/coverage`;

/** `recorded`: the event has a recording linked, playable or not (a private one still says why); `videos`: its videos' ids. */
export function RecordingGaps({ season, code, recorded, matches, videos = [] }: { season: number; code: string; recorded: boolean; matches: MatchView[]; videos?: string[] }) {
  const byKey = useContributorVideos();
  // Asked only when a played match has neither a clip nor FIRST's video; asked again when the matches move (a live
  // event's new results, Refresh results, a clip placed): the path carries what the page has.
  const played = matches.filter((m) => m.played);
  const gap = recorded && played.some((m) => !m.clip && !m.video);
  const s = useApi<ClipCoverage>(gap ? `${coveragePath(season, code)}?m=${missingSignature(played, videos)}` : null);
  // A match someone added a video for has one: not missing here.
  const missing = useMemo(() => (s.data?.matches ?? []).filter((m) => !m.clip && !byKey[m.key]), [s.data, byKey]);
  const c = s.data;
  if (!gap || !c || !missing.length) return null;
  const groups = missingGroups(missing);
  return (
    <div className="mt-2 text-sm" data-recording-gaps={c.state}>
      <ul className="flex flex-wrap gap-1.5" aria-label="Recorded days">
        {c.videos.map((v) => {
          const tone = chipTone(v);
          return (
            <li key={v.videoId} className={cn("inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs", tone === "short" ? "border-warning/50 bg-warning/[0.07]" : "border-line text-text-muted")} data-day-video={v.videoId} data-tone={tone}>
              {tone === "done" ? <Check className="size-3.5 text-success" aria-hidden /> : tone === "short" ? <TriangleAlert className="size-3.5 text-warning" aria-hidden /> : null}
              {v.label} <span className="tabular-nums">{v.matches ? `${v.clipped}/${v.matches}` : "no matches"}</span>
            </li>
          );
        })}
        {c.daysMissing.map((d) => (
          <li key={d.date} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-xs text-text-muted" data-day-missing={d.date}>
            <CircleSlash className="size-3.5" aria-hidden />{d.label} not recorded
          </li>
        ))}
      </ul>
      <details className="group mt-1.5">
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-medium text-text-muted underline-offset-2 hover:text-text-base hover:underline pointer-coarse:min-h-11">
          {missing.length} {missing.length === 1 ? "match has" : "matches have"} no clip — why
        </summary>
        <ul className="mt-1 space-y-1 text-xs" data-missing-clips>
          {groups.map((g) => (
            <li key={`${g.videoId}|${g.why}`}><span className="font-medium tabular-nums">{labelRanges(g.labels)}</span> <span className="text-text-muted">· {g.why}</span></li>
          ))}
        </ul>
      </details>
    </div>
  );
}
