// A match's Watch: its second in the event's recording (MatchView.clip, server/videos/recordings.ts). On the
// event page it jumps the page's player there (lib/streamSeek.ts); anywhere else, or with a modifier key, it's
// a plain link to YouTube at that second.
import type { MouseEvent, ReactNode } from "react";
import { MonitorPlay } from "lucide-react";
import type { MatchClip } from "../shared/api";
import { clipTime } from "../shared/recording";
import { seekStream } from "../lib/streamSeek";
import { cn } from "./cn";

export function ClipLink({ clip, className, children }: { clip: MatchClip; className?: string; children?: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation(); // a row that opens on a click stays as it is
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (seekStream(clip.t)) e.preventDefault();
  };
  return (
    <a href={clip.url} target="_blank" rel="noreferrer noopener" onClick={go} className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Watch this match in the recording, from ${clipTime(clip.t)}`} title={`Watch in the recording from ${clipTime(clip.t)}`} data-clip={clip.t}>
      <MonitorPlay className="size-3.5 shrink-0" aria-hidden />{children}
    </a>
  );
}
