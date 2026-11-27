// What plays next on the watch page (src/shared/watch.ts, src/pages/WatchPage.tsx). For a creator video: the team's
// own featured videos first when the page was opened from that team, then the rest of the video's series (Behind the
// Bot when it has none), newest first, a page at a time by keyset (publish time, id), so the list never ends while
// there's more. Public data only: the same answer for everyone.
import { get } from "../db.js";
import { creatorVideo, creatorVideosFor, featuredFor } from "../videos/creatorVideos.js";
import { UP_NEXT_CURSOR, upNextCursor, type UpNextAnswer } from "../../src/shared/watch.js";

export const UP_NEXT_PAGE = 12;

export async function upNext(opts: { videoId: string; team: number | null; cursor: string | null }): Promise<UpNextAnswer> {
  const video = (await creatorVideo(opts.videoId)) ?? null;
  const m = opts.cursor ? UP_NEXT_CURSOR.exec(opts.cursor) : null;
  const first = !m;
  // The team's own: its featured videos (title names it), read only on the first page.
  let team: UpNextAnswer["team"] = null;
  const own = new Set<string>();
  if (opts.team) {
    const ids = new Set((await featuredFor(opts.team)).map((f) => f.videoId));
    for (const id of ids) own.add(id);
    if (first && ids.size) {
      const vids = (await creatorVideosFor({ teams: [opts.team], limit: 100 })).filter((v) => ids.has(v.videoId));
      const row = await get<{ name: string | null }>("SELECT name FROM teams WHERE number = ?", [opts.team]);
      team = { number: opts.team, name: row?.name ?? null, videos: vids };
    }
  }
  const series = video?.series ?? "behind-the-bot";
  const page = await creatorVideosFor({ series, limit: UP_NEXT_PAGE, ...(m ? { before: { at: m[1], id: m[2] } } : {}) });
  const items = page.filter((v) => v.videoId !== opts.videoId && !own.has(v.videoId));
  const last = page[page.length - 1];
  return { video, team, items, next: page.length === UP_NEXT_PAGE && last ? upNextCursor(last) : null };
}
