import { describe, expect, it } from "vitest";
import { cyclesPath, feedItemOf, reactionCount, shortCount, withLike, withReaction } from "./cycles";
import { looped, watchOf } from "../components/cycles/Cycle";
import type { CycleItem, Engagement } from "../shared/cycles";

const e = (o: Partial<Engagement> = {}): Engagement => ({ likes: 3, reactions: { "🔥": 2 }, shares: 0, mine: { liked: false, reaction: null }, ...o });

describe("a like and a reaction before the server answers", () => {
  it("a like counts once, and comes back off", () => {
    const on = withLike(e(), true);
    expect(on).toMatchObject({ likes: 4, mine: { liked: true } });
    expect(withLike(on, true)).toBe(on);
    expect(withLike(on, false).likes).toBe(3);
    expect(withLike(e({ likes: 0, mine: { liked: true, reaction: null } }), false).likes).toBe(0);
  });

  it("one reaction per person: a new one moves their count, the same one again takes it back", () => {
    const fire = withReaction(e(), "🔥");
    expect(fire.reactions).toEqual({ "🔥": 3 });
    const wow = withReaction(fire, "🤯");
    expect(wow.reactions).toEqual({ "🔥": 2, "🤯": 1 });
    expect(withReaction(wow, null).reactions).toEqual({ "🔥": 2 });
    expect(withReaction(withReaction(e({ reactions: {} }), "👏"), null).reactions).toEqual({});
    expect(reactionCount(wow)).toBe(3);
  });
});

describe("counts", () => {
  it("short on the rail", () => {
    expect([0, 999, 1000, 1250, 9999, 12_400, 999_999, 1_250_000].map(shortCount)).toEqual(["0", "999", "1K", "1.2K", "9.9K", "12K", "999K", "1.2M"]);
  });
});

describe("a Cycle's watch", () => {
  it("finished at the end or once it plays round again; a quick swipe is a few seconds", () => {
    expect(watchOf(44, 45, 0)).toEqual({ watchedS: 45, completed: true });
    expect(watchOf(10, 45, 0)).toEqual({ watchedS: 10, completed: false });
    expect(watchOf(3, 45, 1)).toEqual({ watchedS: 45, completed: true });
    expect(watchOf(1.2, null, 0)).toEqual({ watchedS: 1, completed: false });
  });

  it("went round again: from near the end to the start", () => {
    expect(looped({ t: 44, duration: 45, ended: false }, { t: 0.3, duration: 45, ended: false })).toBe(true);
    expect(looped({ t: 20, duration: 45, ended: false }, { t: 0.3, duration: 45, ended: false })).toBe(false);
    expect(looped(null, { t: 0.3, duration: 45, ended: false })).toBe(false);
  });
});

describe("addresses and items", () => {
  it("a shared link's video only on the first page; a device sends its teams", () => {
    expect(cyclesPath(null, "abcdefghijk", null)).toBe("/api/cycles?start=abcdefghijk");
    expect(cyclesPath("AAAAAAAAAAAA.6", "abcdefghijk", null)).toBe("/api/cycles?cursor=AAAAAAAAAAAA.6");
    expect(cyclesPath(null, null, { myTeam: 21229, teams: [4215] })).toMatch(/^\/api\/cycles\?my=21229&teams=4215/);
  });

  it("a Cycle saves as the same item the Videos feed keeps", () => {
    const c: CycleItem = { key: "c:abcdefghijk", videoId: "abcdefghijk", title: "Turret", creator: { id: "yt:UC", name: "FUN Robotics Network" }, series: "behind-the-bot", teams: [{ number: 21229, name: "Quality Control" }], published: "2026-11-01T00:00:00Z", duration: 50, reason: "Behind the Bot", engagement: e() };
    expect(feedItemOf(c)).toMatchObject({ key: "c:abcdefghijk", kind: "creator", source: "behindTheBot", teams: [21229], channel: "FUN Robotics Network", duration: 50 });
  });
});
