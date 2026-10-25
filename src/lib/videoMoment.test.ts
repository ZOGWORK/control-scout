import { describe, expect, it } from "vitest";
import type { MatchView } from "../shared/api";
import { CLIP_LEAD_S } from "../shared/recording";
import { FIRST_LEAD_S, MATCH_S, RESULT_HOLD_S, videoMoment } from "./videoMoment";
import { readDelivery, bridgedSrc } from "./ytBridge";

// Athens Qualifier's first three: Q1 at 337 s, Q2 at 875 s, Q3 at 1612 s into the recording (each clip already
// has its CLIP_LEAD_S lead-in; the match itself starts CLIP_LEAD_S later).
const m = (n: number, t: number | null): MatchView => ({ key: `qual:0:${n}`, label: `Q${n}`, clip: t == null ? undefined : { videoId: "v", t, url: "" } }) as unknown as MatchView;
const ms = [m(2, 875), m(1, 337), m(3, 1612), m(4, null)];
const at = (t: number) => { const x = videoMoment(ms, t); return x ? `${x.match.label} ${x.phase}` : null; };

describe("the match on screen at a second of the recording", () => {
  it("before the first match: up next shortly before it, nothing earlier", () => {
    expect(at(337 - FIRST_LEAD_S - 1)).toBeNull();
    expect(at(337 - 30)).toBe("Q1 before");
  });
  it("the lead-in is 'before', the match itself 'playing', then its result until the next one", () => {
    expect(at(337)).toBe("Q1 before");
    expect(at(337 + CLIP_LEAD_S)).toBe("Q1 playing");
    expect(at(337 + CLIP_LEAD_S + MATCH_S - 1)).toBe("Q1 playing");
    expect(at(337 + CLIP_LEAD_S + MATCH_S)).toBe("Q1 after");
    expect(at(874)).toBe("Q1 after");
    expect(at(875)).toBe("Q2 before");
  });
  it("a long gap (a break) clears the result after a while; matches without a clip are left out", () => {
    const end = 1612 + CLIP_LEAD_S + MATCH_S;
    expect(at(end + RESULT_HOLD_S - 1)).toBe("Q3 after");
    expect(at(end + RESULT_HOLD_S)).toBeNull();
    expect(videoMoment([m(4, null)], 500)).toBeNull();
    expect(videoMoment(ms, NaN)).toBeNull();
  });
});

describe("the player's messages", () => {
  it("reads its position and whether it's playing (state only comes with a change)", () => {
    const a = readDelivery(JSON.stringify({ event: "infoDelivery", info: { currentTime: 337.4, playerState: 1 } }), null);
    expect(a).toEqual({ t: 337.4, playing: true });
    expect(readDelivery(JSON.stringify({ event: "infoDelivery", info: { currentTime: 338.5 } }), a)).toEqual({ t: 338.5, playing: true });
    expect(readDelivery(JSON.stringify({ event: "infoDelivery", info: { playerState: 2 } }), a)).toEqual({ t: 337.4, playing: false });
  });
  it("ignores anything else", () => {
    expect(readDelivery(JSON.stringify({ event: "apiInfoDelivery", info: { namespaces: [] } }), null)).toBeNull();
    expect(readDelivery("not json", null)).toBeNull();
    expect(readDelivery(JSON.stringify({ event: "infoDelivery", info: { muted: true } }), null)).toBeNull();
  });
  it("the embed address turns the channel on for this page only", () => {
    const u = new URL(bridgedSrc("https://www.youtube-nocookie.com/embed/v", { autoplay: 1, start: 337 }, "https://controlscout.org"));
    expect(Object.fromEntries(u.searchParams)).toEqual({ autoplay: "1", start: "337", enablejsapi: "1", origin: "https://controlscout.org" });
  });
});
