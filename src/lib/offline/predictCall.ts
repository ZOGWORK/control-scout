// The offline call itself, from one saved snapshot (no storage, no browser APIs, so the server's tests run it on the
// very pack and bundle the server builds and compare it with GET /api/predict/match). Choosing the snapshot is
// predict.ts's job.
import { PartnershipTable, RatingBook, explainMatch } from "@control-scout/predict-engine";
import type { MatchExplanationView } from "../../shared/api";
import { callOptions, matchView, recentLookup } from "../../shared/predictView";
import type { EventBundle } from "../../shared/eventBundle";
import type { LitePack } from "../packs";
import { partnershipFor } from "./partnerships";

type Level = "qual" | "playoff";

/** The call from the lite pack: its ratings, bonus model, pair history, recent records and names. */
export function liteCall(p: LitePack, season: number, red: number[], blue: number[], level: Level = "qual", now = Date.now()): MatchExplanationView {
  const book = RatingBook.fromData(p.books[String(season)]);
  book.setTime(now);
  const bonus = p.bonus?.[String(season)];
  const x = explainMatch(book, red, blue, callOptions({
    level, partnership: partnershipFor(p, season), recent: recentLookup(p.recent?.[String(season)] ?? []),
    bonus: bonus ? { season, model: bonus } : null,
  }));
  const names = new Map(p.teams.map(([t, name]) => [t, name]));
  return matchView(season, red, blue, level, x, (t) => names.get(t) ?? null, true);
}

/** The call from an event bundle: its ratings and the rest of the server's inputs as of the same build (a bundle
 *  from before they shipped has none: no bonus odds, pair history or recent-record reasons). */
export function bundleCall(b: EventBundle, season: number, red: number[], blue: number[], level: Level = "qual", now = Date.now()): MatchExplanationView {
  const book = RatingBook.fromData(b.ratings!);
  book.setTime(now);
  const pr = b.predict;
  const table = pr?.pairs ? PartnershipTable.fromData(pr.pairs) : null;
  const x = explainMatch(book, red, blue, callOptions({
    level, partnership: table && table.season === season ? { table, season } : undefined,
    recent: recentLookup(pr?.recent),
    bonus: pr?.bonus ? { season, model: pr.bonus } : null,
  }));
  // The server's names (bundles from before they shipped: the event's field list has them too).
  const names = new Map<number, string | null>(pr?.names ?? b.event.field.map((f) => [f.team, f.name ?? null] as [number, string | null]));
  return matchView(season, red, blue, level, x, (t) => names.get(t) ?? null, true);
}

/** The bundle covers every team of the lineup: rated, or in the event's field (a team with no matches yet gets the
 *  newcomer rating, on the server too). */
export function bundleHolds(b: EventBundle, lineup: number[]): boolean {
  if (!b.ratings) return false;
  const have = new Set([...b.ratings.ratings.map(([t]) => t), ...b.event.field.map((f) => f.team)]);
  return lineup.every((t) => have.has(t));
}
