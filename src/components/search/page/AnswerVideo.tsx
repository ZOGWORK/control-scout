// An answer's video on /search (SearchAnswer.video, server/api/answers/video.ts): the one match or event the answer is
// about, in its card, and a small play button on each listed match that has a clip. The card's player is the event
// page's click-to-play facade (components/WatchLive.tsx): a thumbnail and a play button, the youtube-nocookie player
// loaded only by a click, so the page costs one image and nothing plays on its own. A row's button plays in the app's
// video dialog (components/VideoDialog.tsx, lib/streamSeek.ts), never away from search. No video: nothing is drawn.
// Never wider than the results column (680px, the search display spec); a phone gets the card's full width at 16:9.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Play, PlayCircle } from "lucide-react";
import type { SearchAnswer, SearchVideo, SearchVideoItem } from "../../../shared/api";
import { embedUrl, thumbnailUrl } from "../../../shared/stream";
import { clipTime, watchUrl } from "../../../shared/recording";
import { clipParams, playMatchVideo } from "../../../lib/streamSeek";
import { cn } from "../../cn";
import { VideoCredit } from "../../contributors/VideoCredit";
import { Button } from "../../ui/button";

/** The answer's video, and how many row clips were played: each one stops the card's player, so two never play at once. */
const Video = createContext<{ video?: SearchVideo; rowPlays: number; rowPlayed: () => void }>({ rowPlays: 0, rowPlayed: () => {} });

/** The answer's video, for the card's player and the rows' buttons under it. */
export function AnswerVideoProvider({ video, children }: { video: SearchVideo | undefined; children: ReactNode }) {
  const [rowPlays, setRowPlays] = useState(0);
  return <Video.Provider value={{ video, rowPlays, rowPlayed: () => setRowPlays((n) => n + 1) }}>{children}</Video.Provider>;
}

/** What the video is, in words: the match once, or the event's stream (the card's title already names the event). */
export function videoCaption(v: SearchVideoItem): string {
  if (v.kind === "match") return `${v.match}: official match video`;
  if (v.kind === "contributor") return `${v.match}: video by ${v.contributor?.name ?? "a contributor"}`;
  if (v.kind === "recording") return `${v.match} in the event's ${v.live ? "live stream" : "recording"}, from ${clipTime(v.t)}`;
  return v.live ? "The event's live stream" : "The event's recording";
}

/** The card's player: 16:9, the card's full width on a phone, loaded on a click. `only`: the matches a section lists;
 *  the player shows there only when the answer's match is one of them, never another match's clip. */
export function AnswerVideo({ className, only }: { className?: string; only?: string[] }) {
  const video = useContext(Video).video;
  if (only && !(video?.mainRow && only.includes(video.mainRow))) return null;
  const v = video?.main;
  // Another answer's video starts at its picture again.
  if (v) return <Player key={`${v.videoId}:${v.t}`} v={v} className={className} />;
  // The headline's match has no clip: a link to the recording it's in, never another match's clip in its place.
  const w = video?.watch;
  if (!w) return null;
  const what = w.live ? "live stream" : "recording";
  return (
    <p className={cn("my-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground", className)} data-answer-watch>
      {w.match && <span>No clip of {w.match}.</span>}
      <a href={watchUrl(w.videoId)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]">
        Watch the {w.day ? `${w.day} ` : ""}{what} <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </p>
  );
}

function Player({ v, className }: { v: SearchVideoItem; className?: string }) {
  const [on, setOn] = useState(false);
  // A row's clip opened in the video dialog: the card's player goes back to its picture.
  const { rowPlays } = useContext(Video);
  useEffect(() => { setOn(false); }, [rowPlays]);
  const caption = videoCaption(v);
  const src = `${embedUrl(v.videoId)}?${new URLSearchParams({ autoplay: "1", rel: "0", ...clipParams(v) })}`;
  return (
    <figure className={cn("my-4 max-sm:-mx-4 sm:max-w-[680px]", className)} data-answer-video={v.kind}>
      <div className="relative aspect-video w-full overflow-hidden border-y border-border bg-black sm:rounded-xl sm:border">
        {on ? (
          // Loaded by the viewer's click, so autoplay here is their own choice.
          <iframe className="absolute inset-0 size-full" src={src} title={caption} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60" aria-label={`Play: ${caption}`} data-video-facade>
            {/* The video's picture (a blank player reads as broken); a recording's is its cover, the caption under it
                saying which match and from when. */}
            <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-80 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
            {/* Neutral, not YouTube's red: on a search card hue means team and red marks the red alliance (the results guide). */}
            <span className="relative grid size-16 place-items-center rounded-full bg-black/75 text-white shadow-lg ring-1 ring-white/40"><Play className="size-7 translate-x-0.5 fill-current" aria-hidden /></span>
          </button>
        )}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground max-sm:px-4">
        {v.contributor ? <VideoCredit c={v.contributor} className="min-w-0 flex-1" /> : <span data-video-caption>{caption}</span>}
        <a href={watchUrl(v.videoId, v.t)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground max-md:min-h-[44px] pointer-coarse:min-h-[44px]">
          Open on YouTube <ExternalLink className="size-3" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}

/** What a card or stat answer's "View clip" names, or null for none: the answer's headline ("Auto in M14 at Australia
 *  Championship"), only when its video is a match's clip and that match is the headline's own (a highlights page's tiles
 *  already play theirs). A search for a match or an event by name has no card: it already plays it (AnswerVideo). */
export function clipLabel(a: Pick<SearchAnswer, "stat" | "card" | "video"> | null | undefined): string | null {
  const v = a?.video;
  if (!v?.main?.match || !v.mainRow) return null;
  if (a?.stat) {
    // A page of match videos (highlights) plays each of its own tiles: no second button for its top one.
    if (a.stat.blocks?.some((b) => b.kind === "videos")) return null;
    return a.stat.headline?.href === v.mainRow ? a.stat.headline.label || v.main.match : null;
  }
  return a?.card ? a.card.title : null;
}

/** The answer's own match, to watch: under People also ask, a "View clip" button for the one match a card or stat answer
 *  is about ("<team> best auto in decode" → that match), when it has a clip. It plays the match's own clip as the event
 *  page does (FIRST's match video, a contributor's, or the match's place in the event's recording, from its start), in
 *  the app's video dialog: never a new cut of it, never the event's recording from its start in its place. `about`
 *  names the match in the dialog ("Auto in M14 at Australia Championship"). */
export function AnswerClip({ about, className }: { about?: string; className?: string }) {
  const { video, rowPlayed } = useContext(Video);
  const v = video?.main;
  // Only a match's clip: an event's recording or live stream from its start isn't that match.
  if (!v || !v.match || !video?.mainRow) return null;
  const label = about || v.match;
  return (
    <section aria-label="Watch this match" className={cn("rounded-xl border border-border bg-card p-4", className)} data-answer-clip={v.kind}>
      <h2 className="text-sm font-semibold text-foreground">Watch this match</h2>
      <p className="mt-0.5 text-xs text-muted-foreground" data-video-caption>{videoCaption(v)}</p>
      <Button type="button" className="mt-3 w-full" onClick={() => { rowPlayed(); playMatchVideo({ videoId: v.videoId, t: v.t, end: v.end, label }); }}
        aria-label={`View clip: ${label}`} data-video-control>
        <PlayCircle className="size-5" aria-hidden />View clip
      </Button>
    </section>
  );
}

/** Whether any of these rows has a clip (a table then gives its buttons a column). */
export function useRowPlays(hrefs: (string | undefined)[]): boolean {
  const rows = useContext(Video).video?.rows;
  return !!rows && hrefs.some((h) => h && rows[h]);
}

/** A listed match's clip, the card's own video's match included (a video grid draws a picture for each), and playing
 *  it in the app's video dialog, as a row's button does. */
export function useClip(href: string): { v: SearchVideoItem | undefined; play: (label: string) => void } {
  const { clip, play } = useClips();
  const v = clip(href);
  return { v, play: (label) => { if (v) play(v, label); } };
}

/** Every listed match's clip by its link (a video page filters its tiles by them), and playing one in the dialog. */
export function useClips(): { clip: (href: string) => SearchVideoItem | undefined; play: (v: SearchVideoItem, label: string) => void } {
  const { video, rowPlayed } = useContext(Video);
  return {
    clip: (href) => video?.rows?.[href] ?? (video?.mainRow === href ? video.main : undefined),
    play: (v, label) => { rowPlayed(); playMatchVideo({ videoId: v.videoId, t: v.t, end: v.end, label }); },
  };
}

/** Whether the answer has any video at all (its own, or a listed match's clip). */
export function useAnyVideo(): boolean {
  const v = useContext(Video).video;
  return !!v?.main || !!(v?.rows && Object.keys(v.rows).length);
}

/** A listed match's play button, when it has a clip: it plays in the app's video dialog. `label` names the match in it. */
export function RowPlay({ href, label, className }: { href: string; label: string; className?: string }) {
  const { video, rowPlayed } = useContext(Video);
  const v = video?.rows?.[href];
  if (!v) return null;
  return (
    <button type="button" onClick={() => { rowPlayed(); playMatchVideo({ videoId: v.videoId, t: v.t, end: v.end, label }); }}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground max-md:size-[44px] pointer-coarse:size-[44px]", className)}
      aria-label={`Play ${label}: ${v.kind === "match" ? "official match video" : v.kind === "contributor" ? `video by ${v.contributor?.name}` : `the event's recording from ${clipTime(v.t)}`}`} title={videoCaption(v)} data-row-play={v.kind} data-video-control>
      <PlayCircle className="size-5" aria-hidden />
    </button>
  );
}
