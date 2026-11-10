// One of the teams sharing a name (docs/search-pipeline.md, "Names"), by fixed rules, the same for the parser
// (./parse.ts) and Compare (server/api/searchCompare.ts). In order:
//   1. the visitor's own team (my team, tracked, shortlisted)
//   2. the one in the place the query names
//   3. the one in the same region as another team the query names (the teams a question is about are usually near)
//   4. the only one that has played a match (a registration alone names nothing)
//   5. the only one still active: played in the newest season any of them played, or the season before
//   6. the clearly stronger one: its best OPR rank in its last two seasons is at least STRONGER points of percentile
//      above every other's ("Delta Force": a top-2% team and a bottom-third one); every one of them ranked
// Still tied: no team. Search then asks which, listing each with its place, and never answers for one of them.
import type { Place } from "./names.js";

export interface SharedCandidate {
  number: number; state: string | null; country: string | null; city: string | null;
  /** The newest season it played a match in (null: never). */
  lastPlayed: number | null;
  /** Its best OPR percentile (0–1, 1 the world's best) in its last two seasons with a rank; null: never ranked. */
  strength?: number | null;
}

/** Percentile points one team has to be above every other to be the one a shared name means. */
export const STRONGER = 0.25;

export type SharedPick<T> = { team: T; rule: string } | { tied: T[] };

/** The team `cands` (all one name's) mean, or the ones still tied. `others`: the other teams the query names, already
 *  settled; `place`: the place it names. */
export function pickShared<T extends SharedCandidate>(cands0: T[], ctx: { mine?: (n: number) => boolean; place?: Place | null; others?: SharedCandidate[] }): SharedPick<T> {
  let cands = cands0;
  if (cands.length === 1) return { team: cands[0], rule: "the only one" };
  const mine = cands.filter((t) => ctx.mine?.(t.number));
  if (mine.length === 1) return { team: mine[0], rule: "your team" };
  if (mine.length > 1) cands = mine;
  const place = ctx.place;
  if (place) {
    const local = cands.filter((t) => t.country === place.country && (place.state == null || t.state === place.state) && (place.city == null || t.city === place.city));
    if (local.length === 1) return { team: local[0], rule: `the one in ${place.name}` };
    if (local.length > 1) cands = local;
  }
  // A registration alone names nothing, once one of them has played.
  const played = cands.filter((t) => t.lastPlayed != null);
  const pool = played.length ? played : cands;
  // A real state on both: missing location data is no shared region.
  const others = (ctx.others ?? []).filter((o) => o.state);
  const sameRegion = (o: SharedCandidate, t: SharedCandidate) => !!t.state && o.country === t.country && o.state === t.state;
  const near = others.length ? pool.filter((t) => others.some((o) => sameRegion(o, t))) : [];
  if (near.length === 1) {
    const o = others.find((x) => sameRegion(x, near[0]))!;
    return { team: near[0], rule: `the one in the same region as ${o.number}` };
  }
  if (played.length === 1) return { team: played[0], rule: "the only one that has played" };
  if (!played.length) return { tied: cands };
  const newest = Math.max(...played.map((t) => t.lastPlayed!));
  const active = played.filter((t) => t.lastPlayed! >= newest - 1);
  if (active.length === 1) return { team: active[0], rule: "the only one still playing" };
  // Stronger only between ranks known: a team never ranked is unknown, not weak.
  if (active.every((t) => t.strength != null)) {
    const [first, second] = [...active].sort((a, b) => b.strength! - a.strength!);
    if (first.strength! - second.strength! >= STRONGER) return { team: first, rule: "the stronger one" };
  }
  return { tied: active };
}
