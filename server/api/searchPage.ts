// The whole answer /api/search?answer=1 sends (the header's search and /search), in two steps so the route can note
// how it was read in between (server/searchFailures.ts reads the answer object itself, before it's copied):
//   typedPageAnswer: the query's answer (./answers/followUps.ts pageAnswer), "my"/"our" read as the visitor's team;
//   finishPageAnswer: what goes with it on the page: a lone team's highlights, the event rows' parents, the team rows'
//     season numbers, and the answer's video.
// The event pack (server/packs/eventApi.ts) calls the same two for the queries people type at a meet, so a search
// with no signal shows the server's own answer (docs/event-bundle.md).
import type { SearchAnswer, SearchHit, SearchVideo } from "../../src/shared/api.js";
import { registerCache } from "../caches.js";
import { pageAnswer } from "./answers/followUps.js";
import { mineAnswer } from "./searchMine.js";
import { answerHits, withHighlights } from "./searchPageAnswer.js";
import { answerVideo } from "./answers/video.js";
import type { Viewer } from "../videos/contributors.js";

/** The query's answer: pageAnswer, and for a query saying "my" or "our" with no team named, the visitor's My team
 *  (`my`, ./searchMine.ts). */
export async function typedPageAnswer(q: string, limit: number, prefer: ReadonlySet<string>, my: number | null): Promise<SearchAnswer> {
  const typed = await pageAnswer(q, limit, prefer);
  return (await mineAnswer(q, typed, my, (x) => pageAnswer(x, limit, prefer))) ?? typed;
}

/**
 * The answer as sent. A search for one team alone ("4215") on the results page: the team's highlights as its answer
 * (./answers/highlights.ts), its matches' videos with it. Never in the header's short list, and never for a topic
 * about the team (a section, facts, an event pick). A season asked for ("4215 2024-25") is the one shown. Nor for a
 * question about the team search couldn't answer ("will 4215 win …", "how many teams named …").
 * `viewer`: who's asking (match videos people added are theirs to see, docs/contributors.md), read beside the
 * highlights. `contributor`: the answer carries such a video (never cached then).
 */
export async function finishPageAnswer(ans: SearchAnswer, limit: number, viewer: Promise<Viewer>): Promise<{ body: SearchAnswer; contributor: boolean }> {
  const kept = extrasOf(ans, limit);
  // The highlights and the rows as Control Scout Lite's search page reads them too (./searchPageAnswer.ts).
  const full = await kept.full;
  // Its video (./answers/video.ts): one read for the whole answer, beside the team rows'. The same for every visitor
  // who added no videos (kept with the rest); a visitor's own is read for them.
  const who = await viewer;
  const anyone = !who || (who.userId == null && !who.teams.length);
  const readVideo = () => answerVideo(full, Date.now(), who).then((v) => v ?? null, () => undefined);
  const [hits, video] = await Promise.all([kept.hits, anyone ? keptVideo(kept, readVideo) : readVideo()]);
  const contributor = carriesContributor(video);
  // null: read, and nothing plays (the page then says so); a read that failed sends none, as a first paint carries
  // none (src/shared/api.ts): the page then says nothing about video.
  return { body: { ...full, hits, ...(video !== undefined ? { video } : {}) }, contributor };
}

/** An answer's extras (its highlights, its rows' numbers, its video for anyone), kept with the kept answer itself
 *  (./searchReads.ts keptAnswer: the same object until it's drawn again) for EXTRAS_TTL_MS: even on a kept answer
 *  they cost 5–65 ms a time (the search audit's S13). Dropped with the clip caches (a clip-start change) and by Clear
 *  caches; an answer drawn again from new data is a new object, so never another's extras. */
type Extras = { at: number; full: Promise<SearchAnswer>; hits: Promise<SearchHit[]>; video?: Promise<SearchVideo | null | undefined> };
const EXTRAS_TTL_MS = 60_000;
let extras = new WeakMap<SearchAnswer, Map<number, Extras>>();
registerCache("Search answer extras", () => { extras = new WeakMap(); });

function extrasOf(ans: SearchAnswer, limit: number, now = Date.now()): Extras {
  let byLimit = extras.get(ans);
  if (!byLimit) extras.set(ans, (byLimit = new Map()));
  const hit = byLimit.get(limit);
  if (hit && now - hit.at < EXTRAS_TTL_MS) return hit;
  const full = withHighlights(ans, limit);
  const e: Extras = { at: now, full, hits: full.then((f) => answerHits(f.hits)) };
  byLimit.set(limit, e);
  // A failed one isn't kept: the next ask makes it again.
  const map = byLimit;
  e.hits.catch(() => { if (map.get(limit) === e) map.delete(limit); });
  return e;
}

/** The answer's video carries a match video someone added (docs/contributors.md). */
const carriesContributor = (v: SearchVideo | null | undefined): boolean =>
  !!v && (v.main?.kind === "contributor" || Object.values(v.rows ?? {}).some((x) => x.kind === "contributor"));

/** The video for anyone, kept with the rest. Not kept: a read that failed (undefined), so the next ask reads again,
 *  and one carrying a match video someone added, which is read for each ask, so hiding or removing it takes effect
 *  for everyone at once (./answers/video.ts checks who may see it each time; nothing here would be told). */
function keptVideo(e: Extras, read: () => Promise<SearchVideo | null | undefined>): Promise<SearchVideo | null | undefined> {
  if (e.video) return e.video;
  const v = (e.video = read());
  void v.then((x) => { if ((x === undefined || carriesContributor(x)) && e.video === v) e.video = undefined; });
  return v;
}
