// A match's "Watch" jumps the event page's player (WatchLive) to that match's second in the recording. The
// player registers here while it's on the page; with no player (another page, a phone sheet without the
// section), the caller follows the link to YouTube at that second instead.
type Seek = (t: number) => void;
let player: Seek | null = null;

/** The player's registration; returns its removal. */
export function onStreamSeek(seek: Seek): () => void {
  player = seek;
  return () => { if (player === seek) player = null; };
}

/** Jump the page's player to a second. False when no player is on the page. */
export function seekStream(t: number): boolean {
  if (!player) return false;
  player(t);
  return true;
}
