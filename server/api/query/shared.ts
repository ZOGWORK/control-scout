// One of the teams sharing a name (docs/search-pipeline.md, "Names"), by fixed rules, the same for the parser
// (./parse.ts) and Compare (server/api/searchCompare.ts). In order:
//   1. the visitor's own team (my team, tracked, shortlisted)
//   2. the one in the place the query names
//   3. once one of them has played a match, only those that have: a registration alone names nothing (it has no data
//      to answer with), so it never wins by region over a twin that played elsewhere
//   4. the one in the same region as another team the query names (the teams a question is about are usually near)
//   5. the only one that has played
//   6. the only one still active: played in the newest season any of them played, or the season before
//   7. the clearly stronger one: its best OPR rank in its last two seasons is at least STRONGER points of percentile
//      above every other's ("Delta Force": a top-2% team and a bottom-third one), or its top share (rank over teams
//      ranked) is at most a STRONGER_SHARE-th of every other's (a top-0.1% team and a top-5% one: near the top a few
//      percentile points are a wide gap in rank); every one of them ranked
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
/** How many times smaller one team's top share (1 − percentile) has to be than every other's to be the one meant. */
export const STRONGER_SHARE = 10;

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
    if (first.strength! - second.strength! >= STRONGER || 1 - second.strength! >= STRONGER_SHARE * (1 - first.strength!)) return { team: first, rule: "the stronger one" };
  }
  return { tied: active };
}

/** How many teams a shared name is, said one way by every reader: `total` is every team with a page by the name (the
 *  count "teams named <name>" gives, ../answers/teamsNamed.ts), `tied` the ones still left to ask about, each with its
 *  place. "Which "ultraviolet"? 6 teams have that name; 4 of them still play: …". */
export function whichLine(typed: string, total: number, tied: string[]): string {
  const n = Math.max(total, tied.length);
  return `Which "${typed}"? ${n} teams have that name${tied.length < n ? `; ${tied.length} of them still play` : ""}: ${tied.join(", ")}`;
}
