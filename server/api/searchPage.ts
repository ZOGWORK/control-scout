// The whole answer /api/search?answer=1 sends (the header's search and /search), in two steps so the route can note
// how it was read in between (server/searchFailures.ts reads the answer object itself, before it's copied):
//   typedPageAnswer: the query's answer (./answers/followUps.ts pageAnswer), "my"/"our" read as the visitor's team;
//   finishPageAnswer: what goes with it on the page: a lone team's highlights, the event rows' parents, the team rows'
//     season numbers, and the answer's video.
// The event pack (server/packs/eventApi.ts) calls the same two for the queries people type at a meet, so a search
// with no signal shows the server's own answer (docs/event-bundle.md).
import type { SearchAnswer } from "../../src/shared/api.js";
import { SEARCH_PAGE_LIMIT } from "../../src/shared/search.js";
import { teamParts } from "../../src/shared/searchPage.js";
import { pageAnswer } from "./answers/followUps.js";
import { mineAnswer } from "./searchMine.js";
import { loneTeamHit } from "./searchLayers.js";
import { teamHighlights } from "./answers/highlights.js";
import { withEventParents } from "./searchEvents.js";
import { withTeamStats } from "./searchTeamStats.js";
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
  const lone = limit >= SEARCH_PAGE_LIMIT ? loneTeamHit(ans) : undefined;
  const highlights = lone ? await teamHighlights({ number: Number(lone.ref), name: teamParts(lone.title)?.name ?? null }, lone.linkSeason).catch(() => null) : null;
  const full = highlights ? { ...ans, stat: highlights } : ans;
  // Its video (./answers/video.ts): one read for the whole answer, beside the team rows'.
  const who = await viewer;
  const [hits, video] = await Promise.all([withEventParents(full.hits).then(withTeamStats), answerVideo(full, Date.now(), who).catch(() => undefined)]);
  const contributor = !!video && (video.main?.kind === "contributor" || Object.values(video.rows ?? {}).some((x) => x.kind === "contributor"));
  return { body: { ...full, hits, ...(video ? { video } : {}) }, contributor };
}
