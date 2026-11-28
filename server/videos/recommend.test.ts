import { describe, expect, it } from "vitest";
import { seeded } from "../api/videosFeed.rank.js";
import {
  alike, betaDraw, coIndex, coScore, diversify, exploreLift, facetsOf, novelty, qualityOf, scoreAll, signalWeight, starLift, tasteLift, tasteOf,
  type RecItem, type Signal,
} from "./recommend.js";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const DAY = 86_400_000;
const item = (key: string, o: Partial<RecItem> = {}): RecItem => ({ key, kind: "creator", format: "short", creator: "fun", series: null, teams: [], event: null, at: NOW - 3 * DAY, durationS: 40, ...o });

describe("signals and taste", () => {
  it("a share says most, a skip and not interested say no, and both fade with time", () => {
    const s = (type: Signal["type"], ago = 0) => signalWeight({ key: "c:a", type, at: NOW - ago * DAY }, NOW);
    expect(s("share")).toBeGreaterThan(s("like"));
    expect(s("like")).toBeGreaterThan(s("complete"));
    expect(s("skip")).toBeLessThan(0);
    expect(s("hide")).toBeLessThan(s("skip"));
    expect(s("like", 21)).toBeCloseTo(s("like") / 2);
    // This session's count more: the scroll adapts as it goes.
    expect(signalWeight({ key: "c:a", type: "like", at: NOW, session: true }, NOW)).toBeGreaterThan(s("like"));
  });

  it("a view says yes or no by how much of it was seen", () => {
    const v = (part: number) => signalWeight({ key: "c:a", type: "view", at: NOW, part } as Signal & { part: number }, NOW);
    expect(v(0.05)).toBeLessThan(0);
    expect(v(0.9)).toBeGreaterThan(0);
  });

  it("a video's teams share its signal", () => {
    const f = new Map(facetsOf(item("c:a", { teams: [1, 2, 3, 4], series: "behind-the-bot" })));
    expect(f.get("team:1")).toBeCloseTo(0.5);
    expect(f.get("series:behind-the-bot")).toBe(0.8);
    expect(f.get("format:short")).toBe(0.3);
  });

  it("watch Quality Control's videos to the end, and Quality Control's next one rises above another team's", () => {
    const qc = (k: string) => item(k, { teams: [21229], series: "behind-the-bot" });
    const lib = new Map([qc("c:q1"), qc("c:q2"), qc("c:q3")].map((i) => [i.key, i]));
    const taste = tasteOf(["c:q1", "c:q2", "c:q3"].map((key) => ({ key, type: "complete" as const, at: NOW - DAY })), (k) => lib.get(k), NOW);
    expect(taste.lean.get("team:21229")!).toBeGreaterThan(0.5);
    expect(tasteLift(qc("c:q4"), taste)).toBeGreaterThan(tasteLift(item("c:other", { teams: [4215], series: "behind-the-bot" }), taste));
    // Behind the Bot itself climbs too: another team's episode beats a plain video.
    expect(tasteLift(item("c:b", { teams: [4215], series: "behind-the-bot" }), taste)).toBeGreaterThan(tasteLift(item("c:p", { teams: [4215] }), taste));
  });

  it("skipping a team's videos sinks them, never below the floor", () => {
    const lib = new Map([item("c:s", { teams: [9999] })].map((i) => [i.key, i]));
    const taste = tasteOf(Array.from({ length: 20 }, () => ({ key: "c:s", type: "hide" as const, at: NOW })), (k) => lib.get(k), NOW);
    const lift = tasteLift(item("c:t", { teams: [9999] }), taste);
    expect(lift).toBeLessThan(1);
    expect(lift).toBeGreaterThanOrEqual(0.35);
  });

  it("a signal on a video it can't find is skipped", () => {
    expect(tasteOf([{ key: "c:gone", type: "like", at: NOW }], () => undefined, NOW).lean.size).toBe(0);
  });
});

describe("co-engagement", () => {
  it("people who loved one also loved the other: they're close; a pair seen once is shrunk", () => {
    const idx = coIndex([["a", "b"], ["a", "b"], ["a", "b"], ["a", "b", "c"], ["c", "d"]]);
    expect(idx.near.get("a")!.get("b")!).toBeGreaterThan(idx.near.get("a")!.get("c") ?? 0);
    expect(idx.near.get("b")!.get("a")).toBe(idx.near.get("a")!.get("b"));
    expect(coScore("b", ["a"], idx)).toBeGreaterThan(coScore("d", ["a"], idx));
    expect(coScore("b", [], idx)).toBe(0);
  });

  it("newer loves count more", () => {
    const idx = coIndex([["a", "x"], ["a", "x"], ["b", "y"], ["b", "y"]]);
    expect(coScore("x", ["a", "b"], idx)).toBeGreaterThan(coScore("y", ["a", "b"], idx));
  });
});

describe("quality, star power, novelty", () => {
  it("an early like isn't a 100% rate; a well-loved video beats an ignored one", () => {
    expect(qualityOf({ views: 1, completes: 1, likes: 1, reactions: 0, shares: 0 })).toBeLessThan(qualityOf({ views: 200, completes: 150, likes: 80, reactions: 30, shares: 20 }));
    expect(qualityOf({ views: 200, completes: 5, likes: 0, reactions: 0, shares: 0 })).toBeLessThan(1);
    expect(qualityOf(undefined)).toBe(1);
  });

  it("featured on Behind the Bot more than once is a small lift; once is none", () => {
    const eps = new Map([[21229, 4], [4215, 1]]);
    expect(starLift({ teams: [21229] }, eps)).toBeCloseTo(1.2);
    expect(starLift({ teams: [4215] }, eps)).toBe(1);
  });

  it("skipped sinks furthest; loved may come back", () => {
    expect(novelty({ completed: false, skipped: true, loved: false })).toBeLessThan(novelty({ completed: true, skipped: false, loved: false }));
    expect(novelty({ completed: true, skipped: false, loved: true })).toBeGreaterThan(novelty({ completed: true, skipped: false, loved: false }));
  });
});

describe("explore", () => {
  it("a Beta draw stays in [0, 1] and follows its mean", () => {
    const r = seeded("x");
    const draws = Array.from({ length: 2000 }, () => betaDraw(9, 1, r));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThanOrEqual(1);
    expect(draws.reduce((a, b) => a + b) / draws.length).toBeCloseTo(0.9, 1);
  });

  it("a series the person keeps skipping draws lower than one they love", () => {
    const taste = { lean: new Map(), seen: new Map([["series:a", { pos: 20, neg: 0 }], ["series:b", { pos: 0, neg: 20 }]]) };
    const r = seeded("y");
    const mean = (s: string) => Array.from({ length: 300 }, () => exploreLift(item("k", { series: s, creator: null }), taste, r)).reduce((a, b) => a + b) / 300;
    expect(mean("a")).toBeGreaterThan(mean("b"));
  });
});

describe("score and order", () => {
  const base = { co: coIndex([]), stats: new Map(), episodes: new Map(), own: new Map(), loves: [], seed: "s", now: NOW };

  it("not interested drops it; the same seed gives the same order", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`c:${i}`, { teams: [i] }));
    const own = new Map([["c:3", { completed: false, skipped: false, loved: false, hidden: true }]]);
    const taste = { lean: new Map(), seen: new Map() };
    const a = scoreAll({ ...base, items, taste, own });
    expect(a.some((r) => r.item.key === "c:3")).toBe(false);
    expect(scoreAll({ ...base, items, taste, own }).map((r) => r.score)).toEqual(a.map((r) => r.score));
  });

  it("says why: the person's team first", () => {
    const taste = { lean: new Map([["team:21229", 0.8]]), seen: new Map() };
    const [r] = scoreAll({ ...base, items: [item("c:q", { teams: [21229] })], taste });
    expect(r.why).toEqual({ kind: "team", team: 21229 });
    const [s] = scoreAll({ ...base, items: [item("c:z", { teams: [7] })], taste: { lean: new Map(), seen: new Map() }, episodes: new Map([[7, 3]]) });
    expect(s.why).toEqual({ kind: "star", team: 7 });
  });

  it("never runs one team: diversify breaks up a run of the same team", () => {
    const ranked = [
      ...Array.from({ length: 5 }, (_, i) => ({ item: item(`c:qc${i}`, { teams: [21229] }), score: 10 - i * 0.1, why: { kind: "none" as const } })),
      ...Array.from({ length: 5 }, (_, i) => ({ item: item(`c:o${i}`, { teams: [100 + i] }), score: 8 - i * 0.1, why: { kind: "none" as const } })),
    ];
    const order = diversify(ranked).map((r) => r.item.key);
    expect(order[0]).toBe("c:qc0");
    let run = 0, worst = 0;
    for (const k of order) { run = k.startsWith("c:qc") ? run + 1 : 0; worst = Math.max(worst, run); }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it("alike: a shared team counts most", () => {
    expect(alike(item("a", { teams: [1] }), item("b", { teams: [1, 2] }))).toBeGreaterThan(alike(item("a", { series: "x" }), item("b", { series: "x" })));
  });
});
