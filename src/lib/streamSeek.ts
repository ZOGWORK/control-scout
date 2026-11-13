// A match's video plays in the app, never a jump to YouTube: its second in the event's recording (MatchView.clip)
// or FIRST's own video of it (MatchView.video). On the event page the page's player (WatchLive) takes it; with no
// player there (another page, an event without a recording), the app's video dialog (components/VideoDialog.tsx)
// does. Only a modifier click or a middle click follows the link to YouTube.

/** What to play: a YouTube video from a second (0: its start), and which match it is, for the title and the overlay. */
export interface MatchPlay { videoId: string; t: number; label: string; matchKey?: string; /** A highlight video, not a match's. */ highlight?: boolean }
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
  if (!dialog) return false;
  dialog(p);
  return true;
}

/** Play a match's video in the app: the page's player, else the dialog. False when neither is mounted. */
export function playMatchVideo(p: MatchPlay): boolean {
  const to = player ?? dialog;
  if (!to) return false;
  to(p);
  return true;
}
