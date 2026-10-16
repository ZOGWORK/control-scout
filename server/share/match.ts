// GET /api/share/match.png: a matchup's share card (server/share/card.ts).
//
// Without an event it's the Predict Lab's call from today's ratings (the same
// numbers as /api/predict/match). With an event and a match it's that match's
// own call as its page shows it (the live call logged before the match, a
// labelled backtest replay, or today's call for one not played yet), its
// label, the event's name and, once played, the final score; the teams given
// must be the ones on the field. With an event and no match, the event's name
// labels a Lab call.
//
// Rendering takes a few hundred milliseconds, so finished cards are kept
// (a bounded number, newest kept) per data version: the same address gives
// the same bytes until the data moves on, and the ETag says so.
import { createHash } from "node:crypto";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, get } from "../db.js";
import { liveForecaster, liveVersion } from "../predict/engine.js";
import { matchViews } from "../api/matches.js";
import { seasonInfo } from "../data/seasons.js";
import { registerCache } from "../caches.js";
import { CARD_VERSION, renderCard, type CardModel } from "./card.js";
import type { ShareCardQuery } from "../../src/shared/share.js";

export class ShareError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** A match key as the event page names it: level:series:number. */
export const MATCH_KEY = /^(qual|playoff):\d{1,4}:\d{1,4}$/;

const sameTeams = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((t, i) => t === [...b].sort((x, y) => x - y)[i]);

/** What goes on the card (no drawing): the call, its context and the team names. */
export async function cardModel(q: Required<Pick<ShareCardQuery, "season" | "red" | "blue">> & ShareCardQuery): Promise<CardModel> {
  const s = q.season;
  const format = q.format ?? "landscape";
  const teams = [...q.red, ...q.blue];
  const nameRows = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${teams.map(() => "?").join(",")})`, teams);
  const names = Object.fromEntries(nameRows.map((r) => [Number(r.number), r.name]));
  const season = `${seasonInfo(s).label} season`;
  let eventName: string | null = null;
  if (q.event) {
    const e = await get<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [s, q.event]);
    if (!e) throw new ShareError(404, `No event ${q.event} in ${seasonInfo(s).label}`);
    eventName = e.name;
  }
  if (q.event && q.match) {
    const m = (await matchViews({ season: s, code: q.event }, { predictUnplayed: true })).find((x) => x.key === q.match);
    if (!m) throw new ShareError(404, `No match ${q.match} at ${q.event}`);
    const red = m.red.teams.filter((t) => t.onField).map((t) => t.number), blue = m.blue.teams.filter((t) => t.onField).map((t) => t.number);
    if (!sameTeams(red, q.red) || !sameTeams(blue, q.blue)) throw new ShareError(400, "Those teams aren't the alliances in that match");
    const p = m.prediction;
    if (!p) throw new ShareError(422, "There's no prediction for this match");
    const played = m.played && m.red.score && m.blue.score;
    return {
      format, red: q.red.slice(), blue: q.blue.slice(), names, pRed: p.pRed,
      predicted: p.noScoreBasis ? null : { red: p.redMean, blue: p.blueMean },
      final: played ? { red: m.red.score!.total, blue: m.blue.score!.total } : null,
      tier: p.tier, backtest: p.kind === "backtest", label: `${m.label} · ${eventName}`, season,
    };
  }
  const f = await liveForecaster(s);
  const x = f.explain(s, q.red.slice(), q.blue.slice());
  if (!x) throw new ShareError(503, "Ratings for this season aren't ready yet.");
  // No rated matches this season yet: win odds stand, a predicted score means nothing (as on the event page).
  const noScoreBasis = !f.seasonEvents(s).length;
  return {
    format, red: q.red.slice(), blue: q.blue.slice(), names, pRed: x.winProbA, pBlue: x.winProbB,
    predicted: noScoreBasis ? null : { red: x.predictedScoreA, blue: x.predictedScoreB },
    final: null, tier: x.confidence.tier, label: eventName ?? "Predict Lab", season,
  };
}

interface Card { png: Buffer; etag: string }
/** Cards kept in memory (~60–110 KB each). */
export const CARD_CACHE_MAX = 64;
const cards = new Map<string, Promise<Card>>();
registerCache("Share cards", () => cards.clear());

/** The cache key: the request, the data and ratings it was drawn from, the engine and the drawing. */
export async function cardKey(q: ShareCardQuery): Promise<string> {
  return [await liveVersion(q.season), ENGINE_VERSION, CARD_VERSION, q.season, q.red.join(","), q.blue.join(","), q.event ?? "", q.match ?? "", q.format ?? "landscape"].join("|");
}

/** A finished card from the cache, if there is one (no rendering). */
export function cachedCard(key: string): Promise<Card> | undefined {
  const hit = cards.get(key);
  if (hit) { cards.delete(key); cards.set(key, hit); } // most recently used last
  return hit;
}

/** Draw (or reuse) the card for this request. Concurrent requests for the same card share one render. */
export function matchCard(key: string, q: ShareCardQuery): Promise<Card> {
  const hit = cachedCard(key);
  if (hit) return hit;
  const p = (async () => {
    const model = await cardModel(q);
    const png = await renderCard(model);
    // The ETag is the data version the card was drawn from (in the key) plus a hash of the image.
    const etag = `"sc${CARD_VERSION}-${createHash("sha1").update(key).update(png).digest("base64url").slice(0, 22)}"`;
    return { png, etag };
  })();
  cards.set(key, p);
  p.catch(() => { if (cards.get(key) === p) cards.delete(key); });
  while (cards.size > CARD_CACHE_MAX) cards.delete(cards.keys().next().value!);
  return p;
}

/** For tests. */
export const cardCacheSize = () => cards.size;
