// A clip's picture: its own frame when the server found one (SearchVideoItem.still: one tile of a YouTube storyboard
// sheet, server/videos/storyboards.ts), cropped out of the sheet at 16:9; else, or when the sheet won't load, the video's
// own thumbnail. Fills its parent (which sets the size and aspect); decorative (alt ""), the button around it names it.
import { useState } from "react";
import type { SearchVideoItem } from "../../../shared/api";
import { thumbnailUrl } from "../../../shared/stream";
import { cn } from "../../cn";

export function ClipImage({ v, className }: { v: Pick<SearchVideoItem, "videoId" | "still">; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const s = v.still && failed !== v.still.src ? v.still : null;
  if (s) {
    // The sheet drawn cols × rows times the frame's size, moved so the one tile sits in the frame.
    return (
      <span className={cn("absolute inset-0 overflow-hidden", className)} data-clip-still>
        <img src={s.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(s.src)}
          style={{ position: "absolute", width: `${s.cols * 100}%`, height: `${s.rows * 100}%`, left: `${-s.col * 100}%`, top: `${-s.row * 100}%`, maxWidth: "none" }} />
      </span>
    );
  }
  return (
    <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }}
      className={cn("absolute inset-0 size-full object-cover", className)} data-clip-thumb />
  );
}
