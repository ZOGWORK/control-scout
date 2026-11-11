// A contributor's match video: the picture and a play button (the youtube-nocookie player loads only on a click, as
// everywhere in the app), the credit line under it, and, for the people it's limited to, who can see it.
import { useState } from "react";
import { Play, Users } from "lucide-react";
import { embedUrl, thumbnailUrl } from "../../shared/stream";
import { tierLabel, type ContributorVideo } from "../../shared/contributors";
import { VideoCredit } from "./VideoCredit";
import { cn } from "../cn";

export function ContributorPlayer({ v, label, teamName, className }: { v: ContributorVideo; label: string; teamName?: string | null; className?: string }) {
  const [on, setOn] = useState(false);
  const src = `${embedUrl(v.videoId)}?${new URLSearchParams({ autoplay: "1", rel: "0", ...(v.t ? { start: String(v.t) } : {}) })}`;
  return (
    <figure className={cn("w-full max-w-[680px]", className)} data-contributor-video={v.tier}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
        {on ? (
          <iframe className="absolute inset-0 size-full" src={src} title={`${label}: video by ${v.name}`} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60" aria-label={`Play ${label}: video by ${v.name}`} data-video-facade>
            <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-85 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
            <span className="relative grid size-16 place-items-center rounded-full bg-black/75 text-white shadow-lg ring-1 ring-white/40"><Play className="size-7 translate-x-0.5 fill-current" aria-hidden /></span>
          </button>
        )}
      </div>
      <figcaption className="mt-1.5 space-y-0.5">
        <VideoCredit c={v} />
        {(v.tier !== "public" || v.mine) && (
          <p className="flex items-center gap-1.5 text-xs text-text-muted" data-tier-label>
            {v.tier === "team" && <Users className="size-3.5" aria-hidden />}{tierLabel(v, teamName)}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
