// The Videos feed's ranking (docs in server/api/videosFeed.ts), pure so it's tested on its own (videosFeed.rank.test.ts).
//
//   score = affinity × freshness × quality × (1 − watched)
//
//   affinity   the person's teams in it (on the team, My team, followed, shortlisted, scouted), their region, and a
//              weight per kind of video learned from what they finish or skip (kindWeights)
//   freshness  halves over a time set per pool (a weekend's stream in days, a Behind the Bot episode in months);
//              a live stream is freshest of all
//   quality    the pool's own (an upset or a record over a plain clip), lifted by how many people watched it this week
//   watched    1 once finished, a part when started: watched items sink, never vanish; "not interested" drops it
//
// Then mixFeed: at most 2 in a row from one event or channel, and about 1 slot in 7 (~15%) an explore pick from
// further down, chosen by a seeded draw so the same person's pages stay in one order.
import type { FeedItem, FeedSource, WatchKind } from "../../src/shared/videosFeed.js";
import { watchKindOf } from "../../src/shared/videosFeed.js";

export interface Candidate {
  item: FeedItem;
  /** What "in a row" is counted by: the event ("2025:USNJQ1") or the channel. */
  group: string;
  /** When it happened (ms), null when unknown. */
  at: number | null;
  /** The pool's own quality, around 1. */
  quality: number;
  /** People who watched it these 7 days. */
  popularity: number;
  /** Where it was (a match's or stream's event), for "near you". */
  place?: { country: string | null; state: string | null } | null;
  /** A live stream. */
  live?: boolean;
}

export type Tie = "member" | "myTeam" | "tracked" | "shortlist" | "scouted";
export interface WatchRow { watchedS: number; completed: boolean; hidden: boolean; kind: WatchKind }
export interface Profile {
  /** Each team the person is tied to, by its strongest tie. */
  teams: Map<number, Tie>;
  region: { country: string; state: string | null } | null;
  /** Their watches by item key. */
  history: Map<string, WatchRow>;
}

const DAY = 86_400_000;
/** How many days a pool's freshness takes to halve. */
export const HALF_LIFE_DAYS: Record<FeedSource, number> = { weekend: 2, team: 14, creator: 45, behindTheBot: 120, record: 30, close: 7, upset: 10, popular: 7 };
const TIE_BOOST: Record<Tie, number> = { member: 2.5, myTeam: 2.5, tracked: 1.5, shortlist: 1.2, scouted: 1 };
/** The general feed's own picks, lifted when there's nothing personal to go on. */
const COLD_START: ReadonlySet<FeedSource> = new Set(["weekend", "record", "behindTheBot", "upset"]);

/** Whether there's anything personal to rank by. */
export const isCold = (p: Profile) => p.teams.size === 0 && p.history.size === 0;

/** The strongest tie the person has to any team in the item, or null. */
export function tieOf(item: Pick<FeedItem, "teams">, p: Profile): { team: number; tie: Tie } | null {
  let best: { team: number; tie: Tie } | null = null;
  for (const n of item.teams) {
    const tie = p.teams.get(n);
    if (tie && (!best || TIE_BOOST[tie] > TIE_BOOST[best.tie])) best = { team: n, tie };
  }
  return best;
}

/**
 * A weight per kind of video from what the person did with it: finished ones count for it, skipped ones (started and
 * left before half way, or "not interested") against. A Beta(1, 1) mean, doubled so a kind with no history is 1;
 * kept between 0.4 and 1.8 so one bad run never empties a kind out of the feed.
 */
export function kindWeights(history: Iterable<WatchRow>): Record<WatchKind, number> {
  const n: Record<WatchKind, { done: number; skip: number }> = { match: { done: 0, skip: 0 }, stream: { done: 0, skip: 0 }, creator: { done: 0, skip: 0 }, behindTheBot: { done: 0, skip: 0 } };
  for (const h of history) {
    const c = n[h.kind];
    if (!c) continue;
    if (h.hidden) c.skip += 1.5;
    else if (h.completed) c.done += 1;
    else c.skip += 0.5;
  }
  const w = (c: { done: number; skip: number }) => Math.min(1.8, Math.max(0.4, (2 * (c.done + 1)) / (c.done + c.skip + 2)));
  return { match: w(n.match), stream: w(n.stream), creator: w(n.creator), behindTheBot: w(n.behindTheBot) };
}

/** How much of it the person has seen: 1 finished, a part when started (at least 0.3: it was opened), 0 not seen. */
export function watchedPart(h: WatchRow | undefined, duration: number | undefined): number {
  if (!h) return 0;
  if (h.completed) return 1;
  const len = duration && duration > 0 ? duration : 180;
  return Math.min(0.9, Math.max(0.3, h.watchedS / len));
}

export function freshness(c: Pick<Candidate, "at" | "live" | "item">, now: number): number {
  if (c.live) return 1.5;
  if (c.at == null) return 0.4;
  const days = Math.max(0, now - c.at) / DAY;
  return 0.2 + 0.8 * 2 ** (-days / HALF_LIFE_DAYS[c.item.source]);
}

/** The item's score for this person; null when they said "not interested". */
export function scoreOf(c: Candidate, p: Profile, weights: Record<WatchKind, number>, now: number): number | null {
  const h = p.history.get(c.item.key);
  if (h?.hidden) return null;
  const tie = tieOf(c.item, p);
  const near = !!p.region && !!c.place && c.place.country === p.region.country && (!p.region.state || c.place.state === p.region.state);
  const affinity = (1 + (tie ? TIE_BOOST[tie.tie] : 0) + (near ? 0.6 : 0)) * weights[watchKindOf(c.item)] * (isCold(p) && COLD_START.has(c.item.source) ? 1.3 : 1);
  const quality = c.quality * (1 + 0.15 * Math.log1p(Math.max(0, c.popularity)));
  return affinity * freshness(c, now) * quality * (1 - 0.85 * watchedPart(h, c.item.duration));
}

/** The line on why it's shown, for this person: their tie to a team in it first, else the pool's own reason. */
export function reasonFor(c: Candidate, p: Profile): string {
  const tie = tieOf(c.item, p);
  if (!tie) return c.item.reason;
  const n = tie.team;
  switch (tie.tie) {
    case "member": case "myTeam": return c.item.source === "creator" || c.item.source === "behindTheBot" ? `Features your team, ${n}` : `Your team, ${n}`;
    case "tracked": return `You follow ${n}`;
    case "shortlist": return `${n} is on your shortlist`;
    case "scouted": return `You scouted ${n}`;
  }
}

/** A seeded draw in [0, 1) (mulberry32), so a person's explore picks are the same on every page of one list. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One slot in this many is an explore pick (1 in 7: about 15%). */
export const EXPLORE_EVERY = 7;
/** How many in a row one event or channel may have. */
export const MAX_RUN = 2;

/**
 * The feed's order from scored candidates (any order): best first, except that no event or channel gets more than
 * MAX_RUN in a row while another is left, and every EXPLORE_EVERY-th slot is drawn from further down the list (past
 * the top 5) so the feed never narrows to one thing.
 */
export function mixFeed<T extends { group: string }>(scored: { c: T; score: number }[], seed: string): T[] {
  const rest = [...scored].sort((a, b) => b.score - a.score).map((s) => s.c);
  const rand = seeded(seed);
  const out: T[] = [];
  const runOf = (g: string) => { let n = 0; for (let i = out.length - 1; i >= 0 && out[i].group === g; i--) n++; return n; };
  while (rest.length) {
    let at = -1;
    if ((out.length + 1) % EXPLORE_EVERY === 0 && rest.length > 6) {
      const from = 5, to = Math.min(rest.length, 60);
      const pick = from + Math.floor(rand() * (to - from));
      if (runOf(rest[pick].group) < MAX_RUN) at = pick;
    }
    if (at < 0) at = rest.findIndex((c) => runOf(c.group) < MAX_RUN);
    if (at < 0) at = 0;
    out.push(rest.splice(at, 1)[0]);
  }
  return out;
}
