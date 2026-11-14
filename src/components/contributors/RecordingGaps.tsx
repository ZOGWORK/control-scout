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

export const coveragePath = (season: number, code: string) => `/api/events/${season}/${encodeURIComponent(code)}/coverage`;

export function RecordingGaps({ season, code, recorded, matches }: { season: number; code: string; recorded: boolean; matches: MatchView[] }) {
  const byKey = useContributorVideos();
  // Asked only when a played match has neither a clip nor FIRST's video.
  const gap = recorded && matches.some((m) => m.played && !m.clip && !m.video);
  const s = useApi<ClipCoverage>(gap ? coveragePath(season, code) : null);
  // A match someone added a video for has one: not missing here.
  const missing = useMemo(() => (s.data?.matches ?? []).filter((m) => !m.clip && !byKey[m.key]), [s.data, byKey]);
  const c = s.data;
  if (!gap || !c || !missing.length) return null;
  const groups = missingGroups(missing);
  return (
    <div className="mt-2 text-sm" data-recording-gaps={c.state}>
      <ul className="flex flex-wrap gap-1.5" aria-label="Recorded days">
        {c.videos.map((v) => {
          const full = v.matches > 0 && v.clipped >= v.matches;
          return (
            <li key={v.videoId} className={cn("inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs", full ? "border-line text-text-muted" : "border-warning/50 bg-warning/[0.07]")} data-day-video={v.videoId}>
              {full ? <Check className="size-3.5 text-success" aria-hidden /> : <TriangleAlert className="size-3.5 text-warning" aria-hidden />}
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
