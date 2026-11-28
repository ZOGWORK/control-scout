// The recommendation engine: what to show a person next, for every video list in the app (Cycles, server/api/cycles.ts,
// and the long-form Videos feed, server/api/videosFeed.ts). Pure, so it's tested on its own (recommend.test.ts); the
// reads that feed it live with each list.
//
// It works on facets, never on one source's own fields, so a video from a team's own account later ranks the same way as
// a FUN Robotics Network one today:
//   team:<n>     each FTC team in it
//   creator:<id> who made it (a YouTube channel today)
//   series:<s>   Behind the Bot, Pits & Parts…
//   kind:<k>     match clip, stream, creator video
//   format:<f>   short (a Cycle) or long
//   event:<e>    the event it's from
//
// 1. Signals. Everything a person does with a video is a signal with a weight (SIGNAL_WEIGHT: a share counts most, a
//    quick skip and "not interested" against), fading by half every TASTE_HALF_LIFE_DAYS, and counted 1.5 times while
//    it's from this session, so a scroll adapts as it goes.
// 2. Taste. Each signal's weight goes to the video's facets (split across its teams), and a facet's taste is the
//    smoothed sum, between -1 and 1 (tasteOf). Watch three Quality Control videos to the end: team:21229 climbs.
// 3. Co-engagement. "People who loved this also loved that": item-to-item cosine over everyone's positive baskets
//    (coIndex), shrunk while the overlap is small, then summed over the person's own recent loves (coScore).
// 4. Star power. A team featured on Behind the Bot more than once is a small lift on its videos for everyone
//    (starLift): the cold-start feed leans on the teams FUN keeps coming back to.
// 5. Quality. What everyone did with it: likes, reactions, shares and finishes over views, with a prior so one early
//    like isn't a 100% rate (qualityOf).
// 6. Score = base × freshness × taste lift × co-engagement lift × star lift × quality × novelty, with a Thompson draw
//    over the item's series and creator (explore: a series the person hasn't tried still gets a chance).
// 7. Diversify. Greedy re-rank (maximal marginal relevance): each next pick pays for looking like the last few (the same
//    team, creator or series), so the list never becomes one team's videos in a row.
import { seeded } from "../api/videosFeed.rank.js";

export type Format = "short" | "long";

/** A video as the engine sees it: its key and its facets. */
export interface RecItem {
  key: string;
  kind: string;
  format: Format;
  creator: string | null;
  series: string | null;
  teams: number[];
  event: string | null;
  /** When it was posted or played (ms); null when unknown. */
  at: number | null;
  durationS: number | null;
}

export type SignalType = "view" | "complete" | "loop" | "skip" | "like" | "react" | "save" | "share" | "more" | "hide";
/** One thing the person did with a video. `at` in ms; `session`: during the list being ranked now. */
export interface Signal { key: string; type: SignalType; at: number; session?: boolean }

/** How much each signal says. A view is weighed by how much of the video was seen (viewWeight). */
export const SIGNAL_WEIGHT: Record<Exclude<SignalType, "view">, number> = {
  complete: 1, loop: 1.4, skip: -0.6, like: 2.5, react: 2, save: 2.5, share: 3, more: 2.5, hide: -4,
};
/** A view that wasn't finished: seen less than 30% is a mild "no", more is a mild "yes". */
export const viewWeight = (part: number) => Math.max(-0.4, Math.min(0.8, (part - 0.3) * 1.2));
export const TASTE_HALF_LIFE_DAYS = 21;
const SESSION_BOOST = 1.5;
const DAY = 86_400_000;

/** A signal's weight now: what it says, faded by age, lifted while it's from this session. */
export function signalWeight(s: Signal & { part?: number }, now: number): number {
  const w = s.type === "view" ? viewWeight(s.part ?? 0.3) : SIGNAL_WEIGHT[s.type];
  const age = Math.max(0, now - s.at) / DAY;
  return w * 2 ** (-age / TASTE_HALF_LIFE_DAYS) * (s.session ? SESSION_BOOST : 1);
}

/** The facets of an item, with how much of a signal each takes: a video of four teams gives each team a share. */
export function facetsOf(i: RecItem): [string, number][] {
  const out: [string, number][] = [];
  const teams = [...new Set(i.teams)].slice(0, 8);
  for (const t of teams) out.push([`team:${t}`, 1 / Math.sqrt(teams.length)]);
  if (i.creator) out.push([`creator:${i.creator}`, 0.6]);
  if (i.series) out.push([`series:${i.series}`, 0.8]);
  out.push([`kind:${i.kind}`, 0.4]);
  out.push([`format:${i.format}`, 0.3]);
  if (i.event) out.push([`event:${i.event}`, 0.5]);
  return out;
}

/** A person's taste: each facet's lean, between -1 (keeps skipping it) and 1 (keeps loving it), and how many of their
 *  signals touched it (for the explore draw). */
export interface Taste { lean: Map<string, number>; seen: Map<string, { pos: number; neg: number }> }

/** Taste from signals; `items` resolves a signal's key to its facets (signals on a video it can't find are skipped). */
export function tasteOf(signals: (Signal & { part?: number })[], items: (key: string) => RecItem | undefined, now: number): Taste {
  const sum = new Map<string, number>();
  const seen = new Map<string, { pos: number; neg: number }>();
  for (const s of signals) {
    const it = items(s.key);
    if (!it) continue;
    const w = signalWeight(s, now);
    if (w === 0) continue;
    for (const [f, share] of facetsOf(it)) {
      sum.set(f, (sum.get(f) ?? 0) + w * share);
      const c = seen.get(f) ?? { pos: 0, neg: 0 };
      if (w > 0) c.pos += Math.min(1, w); else c.neg += Math.min(1, -w);
      seen.set(f, c);
    }
  }
  // tanh(x / 3): three strong signals lean a facet about 0.76; it never runs away past 1.
  const lean = new Map<string, number>();
  for (const [f, v] of sum) lean.set(f, Math.tanh(v / 3));
  return { lean, seen };
}

/** How much a person's taste lifts (or sinks) an item: its best team, then creator, series, kind, format and event. A
 *  factor around 1, between about 0.35 and 3. */
export function tasteLift(i: RecItem, t: Taste): number {
  const l = (f: string) => t.lean.get(f) ?? 0;
  const teams = i.teams.map((n) => l(`team:${n}`));
  const bestTeam = teams.length ? Math.max(...teams) : 0;
  const worstTeam = teams.length ? Math.min(...teams) : 0;
  const x = 1.1 * bestTeam + 0.3 * Math.min(0, worstTeam) + 0.5 * l(`creator:${i.creator}`) + 0.7 * l(`series:${i.series}`)
    + 0.35 * l(`kind:${i.kind}`) + 0.3 * l(`format:${i.format}`) + 0.3 * l(`event:${i.event}`);
  return Math.min(3, Math.max(0.35, Math.exp(x)));
}

// ---------------------------------------------------------------------------
// Co-engagement: "people who loved this also loved that"
// ---------------------------------------------------------------------------

/** Item-to-item similarity from everyone's baskets (the items each person loved): cosine of who loved them, shrunk by
 *  CO_SHRINK while few people share them. Only each item's CO_NEIGHBOURS closest are kept. */
export interface CoIndex { near: Map<string, Map<string, number>> }
export const CO_SHRINK = 3;
export const CO_NEIGHBOURS = 30;
/** A basket bigger than this says little about any one pair in it (someone who likes everything): it's cut. */
const BASKET_MAX = 150;

export function coIndex(baskets: Iterable<string[]>): CoIndex {
  const n = new Map<string, number>();
  const pair = new Map<string, Map<string, number>>();
  for (const raw of baskets) {
    const b = [...new Set(raw)].slice(0, BASKET_MAX);
    for (const a of b) n.set(a, (n.get(a) ?? 0) + 1);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const [x, y] = b[i] < b[j] ? [b[i], b[j]] : [b[j], b[i]];
        const m = pair.get(x) ?? pair.set(x, new Map()).get(x)!;
        m.set(y, (m.get(y) ?? 0) + 1);
      }
    }
  }
  const near = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, s: number) => (near.get(a) ?? near.set(a, new Map()).get(a)!).set(b, s);
  for (const [x, m] of pair) {
    for (const [y, c] of m) {
      const s = (c / Math.sqrt(n.get(x)! * n.get(y)!)) * (c / (c + CO_SHRINK));
      add(x, y, s); add(y, x, s);
    }
  }
  for (const [k, m] of near) {
    if (m.size > CO_NEIGHBOURS) near.set(k, new Map([...m].sort((a, b) => b[1] - a[1]).slice(0, CO_NEIGHBOURS)));
  }
  return { near };
}

/** How close an item is to what this person loved lately (their loves, newest first, each counting a little less),
 *  between 0 and 1. */
export function coScore(key: string, loves: string[], idx: CoIndex): number {
  let s = 0, norm = 0;
  loves.slice(0, 40).forEach((l, i) => {
    const w = 1 / (1 + i * 0.15);
    norm += w;
    s += w * (idx.near.get(l)?.get(key) ?? 0);
  });
  return norm ? Math.min(1, (3 * s) / norm) : 0;
}

// ---------------------------------------------------------------------------
// What everyone did with it
// ---------------------------------------------------------------------------

export interface Stats { views: number; completes: number; likes: number; reactions: number; shares: number }

/** Engagement over views, with a prior of QUALITY_PRIOR views at the average rate: a factor between 0.75 and 1.6. */
export const QUALITY_PRIOR = 20;
export function qualityOf(s: Stats | undefined): number {
  if (!s) return 1;
  const good = s.completes + 2 * s.likes + 1.5 * s.reactions + 3 * s.shares;
  const rate = (good + 0.5 * QUALITY_PRIOR) / (s.views + QUALITY_PRIOR);
  return Math.min(1.6, Math.max(0.75, 0.6 + 0.8 * rate)) * (1 + 0.05 * Math.log1p(s.views));
}

/** Teams featured on Behind the Bot more than once lift their videos a little for everyone (`episodes`: each team's
 *  count of episodes). */
export function starLift(i: Pick<RecItem, "teams">, episodes: Map<number, number>): number {
  let best = 0;
  for (const t of i.teams) best = Math.max(best, episodes.get(t) ?? 0);
  return best <= 1 ? 1 : 1 + 0.1 * Math.log2(best);
}

/** Freshness: shorts stay good for months, long videos as the Videos feed's own (videosFeed.rank.ts freshness). */
export function shortFreshness(at: number | null, now: number): number {
  if (at == null) return 0.5;
  return 0.35 + 0.65 * 2 ** (-Math.max(0, now - at) / DAY / 60);
}

/** Seen before: a finished one sinks, a skipped one sinks further, a loved one may come back now and then. */
export function novelty(own: { completed: boolean; skipped: boolean; loved: boolean } | undefined): number {
  if (!own) return 1;
  if (own.skipped) return 0.1;
  if (own.loved) return 0.35;
  return own.completed ? 0.2 : 0.6;
}

// ---------------------------------------------------------------------------
// Explore: Thompson sampling over series and creators
// ---------------------------------------------------------------------------

/** A draw from Beta(a, b), from two gamma draws (Marsaglia–Tsang). `rand` is the seeded draw. */
export function betaDraw(a: number, b: number, rand: () => number): number {
  const gamma = (k: number): number => {
    if (k < 1) return gamma(k + 1) * rand() ** (1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        // A normal draw (Box–Muller).
        x = Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  const x = gamma(a), y = gamma(b);
  return x / (x + y);
}

/** The explore factor for an item: a draw from what the person did with its series and creator, Beta(1 + loves,
 *  1 + skips). A series they haven't tried draws anywhere between 0 and 1, so it sometimes wins a slot; one they skip
 *  draws low. Between 0.8 and 1.25. */
export function exploreLift(i: RecItem, t: Taste, rand: () => number): number {
  const fs = [i.series ? `series:${i.series}` : null, i.creator ? `creator:${i.creator}` : null].filter((f): f is string => !!f);
  if (!fs.length) return 1;
  let d = 0;
  for (const f of fs) { const c = t.seen.get(f) ?? { pos: 0, neg: 0 }; d += betaDraw(1 + c.pos, 1 + c.neg, rand); }
  return 0.8 + 0.45 * (d / fs.length);
}

// ---------------------------------------------------------------------------
// Score and order
// ---------------------------------------------------------------------------

export interface RankInput {
  items: RecItem[];
  taste: Taste;
  /** The person's recent loves (liked, reacted, saved, shared, finished), newest first: for co-engagement. */
  loves: string[];
  co: CoIndex;
  stats: Map<string, Stats>;
  episodes: Map<number, number>;
  /** What the person did with each item already. */
  own: Map<string, { completed: boolean; skipped: boolean; loved: boolean; hidden: boolean }>;
  /** Each item's own base (a pool's weight, a tie to the person's team): 1 when there's none. */
  base?: (i: RecItem) => number;
  freshness?: (i: RecItem) => number;
  seed: string;
  now: number;
}

export interface Ranked { item: RecItem; score: number; why: Why }
/** What lifted it most, for the line under it. */
export type Why = { kind: "team"; team: number } | { kind: "co" } | { kind: "series"; series: string } | { kind: "creator" } | { kind: "star"; team: number } | { kind: "none" };

export function scoreAll(r: RankInput): Ranked[] {
  const rand = seeded(r.seed);
  const out: Ranked[] = [];
  for (const i of r.items) {
    const own = r.own.get(i.key);
    if (own?.hidden) continue;
    const taste = tasteLift(i, r.taste);
    const co = coScore(i.key, r.loves, r.co);
    const star = starLift(i, r.episodes);
    const score = (r.base?.(i) ?? 1) * (r.freshness?.(i) ?? shortFreshness(i.at, r.now)) * taste * (1 + 1.2 * co) * star
      * qualityOf(r.stats.get(i.key)) * novelty(own) * exploreLift(i, r.taste, rand);
    out.push({ item: i, score, why: whyOf(i, r.taste, co, r.episodes) });
  }
  return out;
}

function whyOf(i: RecItem, t: Taste, co: number, episodes: Map<number, number>): Why {
  let team: number | null = null, best = 0.25;
  for (const n of i.teams) { const v = t.lean.get(`team:${n}`) ?? 0; if (v > best) { best = v; team = n; } }
  if (team != null) return { kind: "team", team };
  if (co >= 0.25) return { kind: "co" };
  if (i.series && (t.lean.get(`series:${i.series}`) ?? 0) > 0.3) return { kind: "series", series: i.series };
  if (i.creator && (t.lean.get(`creator:${i.creator}`) ?? 0) > 0.3) return { kind: "creator" };
  let star: number | null = null, most = 1;
  for (const n of i.teams) { const e = episodes.get(n) ?? 0; if (e > most) { most = e; star = n; } }
  return star != null ? { kind: "star", team: star } : { kind: "none" };
}

/** How alike two items are, between 0 and 1: a team in common, the same creator, the same series. */
export function alike(a: RecItem, b: RecItem): number {
  let s = 0;
  if (a.teams.some((t) => b.teams.includes(t))) s += 0.6;
  if (a.creator && a.creator === b.creator) s += 0.15;
  if (a.series && a.series === b.series) s += 0.25;
  if (a.event && a.event === b.event) s += 0.3;
  return Math.min(1, s);
}

/**
 * The order to show them in: maximal marginal relevance. Each next pick is the one whose score, less DIVERSITY times
 * how alike it is to the last WINDOW picks, is highest, over the best POOL left: the list keeps its best first but never
 * runs one team or series. Scores are scaled to the best one first, so the penalty means the same on any list.
 * `before`: what was shown just before (the last page), so a new page carries on from it.
 */
export const DIVERSITY = 0.45;
const WINDOW = 4;
const POOL = 80;
export function diversify(ranked: Ranked[], limit = Infinity, before: Ranked[] = []): Ranked[] {
  const rest = [...ranked].sort((a, b) => b.score - a.score);
  const top = rest[0]?.score || 1;
  const out: Ranked[] = [];
  while (rest.length && out.length < limit) {
    const recent = [...before, ...out].slice(-WINDOW);
    let at = 0, best = -Infinity;
    for (let i = 0; i < Math.min(POOL, rest.length); i++) {
      const sim = recent.reduce((m, p, j) => Math.max(m, alike(rest[i].item, p.item) * (0.6 + 0.4 * ((j + 1) / recent.length))), 0);
      const v = rest[i].score / top - DIVERSITY * sim;
      if (v > best) { best = v; at = i; }
    }
    out.push(rest.splice(at, 1)[0]);
  }
  return out;
}
