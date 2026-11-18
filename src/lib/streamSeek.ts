// A match's video plays in the app, never a jump to YouTube: its second in the event's recording (MatchView.clip)
// or FIRST's own video of it (MatchView.video). On the event page the page's player (WatchLive) takes it; with no
// player there (another page, an event without a recording), the app's video dialog (components/VideoDialog.tsx)
// does. Only a modifier click or a middle click follows the link to YouTube. A video whose owner turned off playing on
// other sites (MatchClip.youtubeOnly) can't play in either: it opens on YouTube, in a new tab, from the same second.
import { watchUrl } from "../shared/recording";

/** What to play: a YouTube video from a second (0: its start), and which match it is, for the title and the overlay.
 *  `end`: the second it stops at, a recording's clip only (MatchClip.end: its match's end); none plays on. */
export interface MatchPlay { videoId: string; t: number; end?: number; label: string; matchKey?: string; /** A highlight video, not a match's. */ highlight?: boolean; /** Plays on YouTube only (MatchClip.youtubeOnly). */ youtubeOnly?: boolean }

/** A YouTube embed's start= and end= for a play (end only after its start). */
export const clipParams = (p: { t: number; end?: number | null }): Record<string, string> => ({
  ...(p.t ? { start: String(p.t) } : {}),
  ...(p.end != null && p.end > p.t ? { end: String(p.end) } : {}),
});
type Play = (p: MatchPlay) => void;
let player: Play | null = null;
let dialog: Play | null = null;

/** The page player's registration; returns its removal. */
export function onStreamSeek(play: Play): () => void {
  player = play;
  return () => { if (player === play) player = null; };
}

/** The app dialog's registration (mounted once, at the app's root); returns its removal. */
export function onVideoDialog(play: Play): () => void {
  dialog = play;
  return () => { if (dialog === play) dialog = null; };
}

/** Play a video in the app's dialog, never the page's player (a highlight is never the event's recording or a
 *  match's video). False when the dialog isn't mounted. */
export function playInDialog(p: MatchPlay): boolean {
  if (p.youtubeOnly) return onYouTube(p);
  if (!dialog) return false;
  dialog(p);
  return true;
}

/** Play a match's video in the app: the page's player, else the dialog. False when neither is mounted. */
export function playMatchVideo(p: MatchPlay): boolean {
  if (p.youtubeOnly) return onYouTube(p);
  const to = player ?? dialog;
  if (!to) return false;
  to(p);
  return true;
}

/** A video that plays on YouTube only: its watch page from the play's second, in a new tab (a link to it opens it
 *  itself: ClipLink). */
function onYouTube(p: MatchPlay): boolean {
  window.open(watchUrl(p.videoId, p.t), "_blank", "noopener,noreferrer");
  return true;
}

/** The short note beside a play that opens on YouTube. */
export const YOUTUBE_ONLY_NOTE = "Plays on YouTube";
