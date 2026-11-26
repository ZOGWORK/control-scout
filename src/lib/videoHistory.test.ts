import { describe, expect, it } from "vitest";
import { withWatch } from "./videoHistory";
import { readProgress } from "./ytBridge";
import { milestones } from "../components/FeedCard";
import { feedPath } from "../pages/VideosPage";

describe("withWatch (a signed-out device's history)", () => {
  it("puts the newest first, keeps a finish or 'not interested', and caps the list", () => {
    let h = withWatch([], { key: "m:2025:A:qual:0:1", kind: "match", watchedS: 5 }, 1);
    h = withWatch(h, { key: "c:x", kind: "creator", watchedS: 100, completed: true }, 2);
    h = withWatch(h, { key: "c:x", kind: "creator", watchedS: 5 }, 3);
    expect(h.map((e) => [e.key, e.state])).toEqual([["c:x", "d"], ["m:2025:A:qual:0:1", "p"]]);
    h = withWatch(h, { key: "m:2025:A:qual:0:1", kind: "match", watchedS: 0, hidden: true }, 4);
    h = withWatch(h, { key: "m:2025:A:qual:0:1", kind: "match", watchedS: 50, completed: true }, 5);
    expect(h[0]).toEqual({ key: "m:2025:A:qual:0:1", state: "x", at: 5 });
    let big: ReturnType<typeof withWatch> = [];
    for (let i = 0; i < 250; i++) big = withWatch(big, { key: `c:v${i}`, kind: "creator", watchedS: 5 }, i);
    expect(big.length).toBe(200);
    expect(big[0].key).toBe("c:v249");
  });
});

describe("readProgress", () => {
  it("reads time, length and the end from the player's messages, carrying them over", () => {
    const a = readProgress(JSON.stringify({ event: "infoDelivery", info: { currentTime: 12, duration: 300, playerState: 1 } }), null);
    expect(a).toEqual({ t: 12, duration: 300, ended: false });
    const b = readProgress({ event: "infoDelivery", info: { currentTime: 299.5 } }, a);
    expect(b).toEqual({ t: 299.5, duration: 300, ended: false });
    expect(readProgress({ event: "infoDelivery", info: { playerState: 0 } }, b)).toEqual({ t: 299.5, duration: 300, ended: true });
    expect(readProgress("not json", null)).toBeNull();
    expect(readProgress({ event: "onReady" }, null)).toBeNull();
  });
});

describe("milestones", () => {
  const clip = { t: 100, end: 260 };
  it("counts from the clip's start to its end", () => {
    expect(milestones(clip, { t: 104, duration: 3600, ended: false })).toEqual({ watchedS: 4, five: false, half: false, done: false });
    expect(milestones(clip, { t: 106, duration: 3600, ended: false })).toMatchObject({ five: true, half: false });
    expect(milestones(clip, { t: 181, duration: 3600, ended: false })).toMatchObject({ half: true, done: false });
    expect(milestones(clip, { t: 259.5, duration: 3600, ended: false })).toMatchObject({ done: true });
  });
  it("uses the whole video's length when the item has no end, and the player's end", () => {
    expect(milestones({ t: 0 }, { t: 400, duration: 900, ended: false })).toMatchObject({ half: false });
    expect(milestones({ t: 0 }, { t: 451, duration: 900, ended: false })).toMatchObject({ half: true });
    expect(milestones({ t: 0 }, { t: 30, duration: null, ended: true })).toMatchObject({ done: true, half: false });
  });
});

describe("feedPath", () => {
  it("carries a signed-out device's teams and history, and nothing of the kind when signed in", () => {
    expect(feedPath("all", null, null)).toBe("/api/videos/feed");
    expect(feedPath("myTeams", "12", null)).toBe("/api/videos/feed?filter=myTeams&cursor=12");
    expect(feedPath("all", null, { myTeam: 4215, teams: [1, 2], history: "c:x~d" })).toBe("/api/videos/feed?my=4215&teams=1%2C2&h=c%3Ax%7Ed");
  });
});
