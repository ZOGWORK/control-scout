// The app's video dialog: plays a match's video (its second in the event's recording, or FIRST's own video of it)
// where the page has no player of its own (lib/streamSeek.ts). Mounted once at the app's root; the youtube-nocookie
// player loads only when a match's video is clicked, so autoplay here is the viewer's own choice.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { clipParams, onVideoDialog, type MatchPlay } from "../lib/streamSeek";
import { embedUrl } from "../shared/stream";
import { clipTime, watchUrl } from "../shared/recording";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/overlay";

export function VideoDialog() {
  const [play, setPlay] = useState<MatchPlay | null>(null);
  useEffect(() => onVideoDialog(setPlay), []);
  const src = play && `${embedUrl(play.videoId)}?${new URLSearchParams({ autoplay: "1", rel: "0", ...clipParams(play) })}`;
  return (
    <Dialog open={!!play} onOpenChange={(o) => { if (!o) setPlay(null); }}>
      {play && (
        <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5" data-video-dialog>
          <DialogTitle className="pr-8 text-base">{play.label}</DialogTitle>
          <DialogDescription className="sr-only">{play.highlight ? "The event's highlight video, from the organiser's channel" : play.t ? `The event's recording, from ${clipTime(play.t)}` : "The match's video"}</DialogDescription>
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
            <iframe key={`${play.videoId}:${play.t}:${play.end ?? ""}`} className="size-full" src={src!} title={`${play.label} video`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
          </div>
          <a href={watchUrl(play.videoId, play.t)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 justify-self-start text-xs text-text-muted hover:text-text-base">
            Open on YouTube <ExternalLink className="size-3" aria-hidden />
          </a>
        </DialogContent>
      )}
    </Dialog>
  );
}
