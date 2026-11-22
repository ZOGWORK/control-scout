// Which recordings scripts/storyboards.ts reads this run. A video with a fresh spec on the live server is done; one whose
// page had none (a stream still live or not started yet, or a private, removed or broken video) is remembered at home
// and left a while (`NO_STORYBOARD_DAYS`), so the newest season's videos without one never fill every run's budget and
// older recordings are still reached.
export type NoneSeen = Record<string, { at: string; live: boolean }>;

/** Days before a video with no storyboard is read again: a live or upcoming stream soon (it gets one when it ends). */
export const NO_STORYBOARD_DAYS = { live: 1, other: 14 };

/** The videos to read, in the order given (newest first), at most `max`. */
export function wanted(ids: string[], fresh: ReadonlySet<string>, none: NoneSeen, now: number, max: number): string[] {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    if (out.length >= max) break;
    if (fresh.has(id)) continue;
    const n = none[id];
    if (n && now - Date.parse(n.at) < (n.live ? NO_STORYBOARD_DAYS.live : NO_STORYBOARD_DAYS.other) * 86_400_000) continue;
    out.push(id);
  }
  return out;
}

/** What a run learnt: videos with no storyboard noted (`live`: a stream live or not started yet), ones now read
 *  forgotten, and notes older than the longest wait dropped. */
export function noteRun(none: NoneSeen, read: string[], without: { id: string; live: boolean }[], now: number): NoneSeen {
  const out: NoneSeen = {};
  const keep = Math.max(NO_STORYBOARD_DAYS.live, NO_STORYBOARD_DAYS.other) * 86_400_000;
  for (const [id, n] of Object.entries(none)) if (now - Date.parse(n.at) < keep) out[id] = n;
  for (const id of read) delete out[id];
  for (const w of without) out[w.id] = { at: new Date(now).toISOString(), live: w.live };
  return out;
}
