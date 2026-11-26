import { describe, expect, it } from "vitest";
import { EXPLORE_EVERY, freshness, kindWeights, mixFeed, reasonFor, scoreOf, seeded, tieOf, watchedPart, type Candidate, type Profile, type WatchRow } from "./videosFeed.rank";
import type { FeedItem, FeedSource } from "../../src/shared/videosFeed";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const DAY = 86_400_000;
const cand = (key: string, o: { source?: FeedSource; teams?: number[]; ageDays?: number; group?: string; quality?: number; popularity?: number; kind?: FeedItem["kind"]; series?: string; place?: Candidate["place"]; live?: boolean } = {}): Candidate => ({
  item: { key, kind: o.kind ?? "recording", source: o.source ?? "team", videoId: "abcdefghijk", t: 0, title: key, thumb: "", teams: o.teams ?? [], published: null, reason: "Pool reason", ...(o.series ? { series: o.series } : {}) },
  group: o.group ?? key, at: o.ageDays == null ? NOW : NOW - o.ageDays * DAY, quality: o.quality ?? 1, popularity: o.popularity ?? 0, place: o.place ?? null, ...(o.live ? { live: true } : {}),
});
const profile = (o: Partial<Profile> = {}): Profile => ({ teams: new Map(), region: null, history: new Map(), ...o });
const neutral = kindWeights([]);

describe("kindWeights", () => {
  it("is 1 for every kind with no history", () => {
    expect(neutral).toEqual({ match: 1, stream: 1, creator: 1, behindTheBot: 1 });
  });
  it("rises with finishes, falls with skips, and stays within 0.4–1.8", () => {
    const done: WatchRow[] = Array.from({ length: 20 }, () => ({ kind: "creator", watchedS: 600, completed: true, hidden: false }));
    const skipped: WatchRow[] = Array.from({ length: 20 }, () => ({ kind: "match", watchedS: 5, completed: false, hidden: true }));
    const w = kindWeights([...done, ...skipped]);
    expect(w.creator).toBeGreaterThan(1.5);
    expect(w.creator).toBeLessThanOrEqual(1.8);
    expect(w.match).toBe(0.4);
    expect(w.stream).toBe(1);
  });
});

describe("scoreOf", () => {
  it("drops an item the person said they're not interested in", () => {
    const p = profile({ history: new Map([["a", { kind: "match", watchedS: 5, completed: false, hidden: true }]]) });
    expect(scoreOf(cand("a"), p, neutral, NOW)).toBeNull();
  });
  it("pushes a finished item down but keeps it", () => {
    const p = profile({ history: new Map([["a", { kind: "match", watchedS: 200, completed: true, hidden: false }]]) });
    const seen = scoreOf(cand("a"), p, neutral, NOW)!;
    const fresh = scoreOf(cand("b"), p, neutral, NOW)!;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(fresh * 0.2);
  });
  it("ranks the person's own team over a followed one over none", () => {
    const p = profile({ teams: new Map([[4215, "myTeam"], [16091, "tracked"]]) });
    const own = scoreOf(cand("a", { teams: [4215, 1] }), p, neutral, NOW)!;
    const followed = scoreOf(cand("b", { teams: [16091] }), p, neutral, NOW)!;
    const none = scoreOf(cand("c", { teams: [1] }), p, neutral, NOW)!;
    expect(own).toBeGreaterThan(followed);
    expect(followed).toBeGreaterThan(none);
  });
  it("gives fresher videos more and a live stream most", () => {
    const p = profile();
    const s = (c: Candidate) => scoreOf(c, p, neutral, NOW)!;
    expect(s(cand("a", { ageDays: 1 }))).toBeGreaterThan(s(cand("b", { ageDays: 30 })));
    expect(freshness(cand("l", { live: true, ageDays: 3 }), NOW)).toBeGreaterThan(freshness(cand("n", { ageDays: 0 }), NOW));
  });
  it("lifts the kinds the person finishes", () => {
    const p = profile();
    const likesCreators = kindWeights(Array.from({ length: 10 }, () => ({ kind: "creator" as const, watchedS: 600, completed: true, hidden: false })));
    const creator = cand("c", { kind: "creator", source: "creator" });
    expect(scoreOf(creator, p, likesCreators, NOW)!).toBeGreaterThan(scoreOf(creator, p, neutral, NOW)!);
  });
  it("lifts events in the person's region and popular videos", () => {
    const p = profile({ region: { country: "USA", state: "NJ" } });
    const near = scoreOf(cand("a", { place: { country: "USA", state: "NJ" } }), p, neutral, NOW)!;
    const far = scoreOf(cand("b", { place: { country: "USA", state: "TX" } }), p, neutral, NOW)!;
    expect(near).toBeGreaterThan(far);
    expect(scoreOf(cand("c", { popularity: 40 }), p, neutral, NOW)!).toBeGreaterThan(scoreOf(cand("d"), p, neutral, NOW)!);
  });
  it("cold start: lifts this weekend, top plays, Behind the Bot and upsets over a plain clip", () => {
    const cold = profile();
    expect(scoreOf(cand("u", { source: "upset" }), cold, neutral, NOW)!).toBeGreaterThan(scoreOf(cand("p", { source: "popular" }), cold, neutral, NOW)!);
    const warm = profile({ teams: new Map([[1, "tracked"]]) });
    expect(scoreOf(cand("u", { source: "upset" }), warm, neutral, NOW)).toBeCloseTo(scoreOf(cand("p", { source: "popular" }), warm, neutral, NOW)!, 1);
  });
});

describe("watchedPart", () => {
  it("is 1 finished, at least 0.3 once started, 0 unseen", () => {
    expect(watchedPart(undefined, 100)).toBe(0);
    expect(watchedPart({ kind: "match", watchedS: 5, completed: false, hidden: false }, 200)).toBe(0.3);
    expect(watchedPart({ kind: "match", watchedS: 100, completed: false, hidden: false }, 200)).toBe(0.5);
    expect(watchedPart({ kind: "match", watchedS: 1, completed: true, hidden: false }, 200)).toBe(1);
  });
});

describe("reasonFor", () => {
  it("says the person's tie first, else the pool's reason", () => {
    const p = profile({ teams: new Map([[4215, "member"], [7, "shortlist"], [8, "scouted"]]) });
    expect(reasonFor(cand("a", { teams: [7, 4215] }), p)).toBe("Your team, 4215");
    expect(reasonFor(cand("c", { teams: [4215], source: "behindTheBot", kind: "creator" }), p)).toBe("Features your team, 4215");
    expect(reasonFor(cand("b", { teams: [7] }), p)).toBe("7 is on your shortlist");
    expect(reasonFor(cand("d", { teams: [8] }), p)).toBe("You scouted 8");
    expect(reasonFor(cand("e", { teams: [9] }), p)).toBe("Pool reason");
    expect(tieOf(cand("e", { teams: [9] }).item, p)).toBeNull();
  });
});

describe("mixFeed", () => {
  const run = (groups: string[], scores?: number[]) => groups.map((g, i) => ({ c: { group: g, id: i }, score: scores?.[i] ?? 100 - i }));
  it("never has more than 2 in a row from one event or channel while another is left", () => {
    const out = mixFeed(run(["A", "A", "A", "A", "A", "B", "C", "A", "A", "D"]), "seed");
    for (let i = 2; i < out.length; i++) {
      const tail = out.slice(i + 1);
      if (out[i].group === out[i - 1].group && out[i].group === out[i - 2].group) expect(tail.every((c) => c.group === out[i].group)).toBe(true);
    }
    expect(out.slice(0, 3).map((c) => c.group)).toEqual(["A", "A", "B"]);
  });
  it("keeps every item, once", () => {
    const xs = run(Array.from({ length: 50 }, (_, i) => `g${i % 9}`));
    const out = mixFeed(xs, "s");
    expect(out.length).toBe(50);
    expect(new Set(out.map((c) => c.id)).size).toBe(50);
  });
  it("puts an explore pick from further down in about 1 slot in 7", () => {
    const xs = run(Array.from({ length: 70 }, (_, i) => `g${i}`));
    const out = mixFeed(xs, "explore");
    const jumps = out.filter((c, i) => c.id > i + 4).length;
    expect(jumps).toBeGreaterThanOrEqual(Math.floor(70 / EXPLORE_EVERY) - 2);
    // The rest stay in score order.
    expect(out[0].id).toBe(0);
  });
  it("is the same for the same seed and differs for another", () => {
    const xs = run(Array.from({ length: 40 }, (_, i) => `g${i}`));
    expect(mixFeed(xs, "u:1|2026-11-26").map((c) => c.id)).toEqual(mixFeed(xs, "u:1|2026-11-26").map((c) => c.id));
    expect(mixFeed(xs, "u:1|2026-11-26").map((c) => c.id)).not.toEqual(mixFeed(xs, "u:2|2026-11-26").map((c) => c.id));
  });
  it("seeded draws stay in [0, 1)", () => {
    const r = seeded("x");
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe("mixFeed by pool", () => {
  it("never puts more than 3 from one pool in a row while another pool is left", () => {
    const xs = Array.from({ length: 20 }, (_, i) => ({ c: { group: `g${i}`, id: i, item: { source: i < 15 ? "record" : "recent" } }, score: 100 - i }));
    const out = mixFeed(xs, "pools");
    const firstRecent = out.findIndex((c) => c.item.source === "recent");
    expect(firstRecent).toBe(3);
    let run = 0;
    for (const [i, c] of out.entries()) {
      run = i && out[i - 1].item.source === c.item.source ? run + 1 : 1;
      if (run > 3) expect(out.slice(i).every((x) => x.item.source === c.item.source)).toBe(true);
    }
  });
});
