// No dead ends for video (./videoSuggest.ts, search video brief point 7): a search asking to watch whose answer plays
// nothing gets questions that do play, each checked by asking it; never one whose answer has no video, never when the
// answer already plays, and never holding the answer up.
import { describe, expect, it } from "vitest";
import type { SearchAnswer, SearchVideo } from "../../../src/shared/api";
import { asksVideo, hasVideo, withVideoAlternatives } from "./videoSuggest";

const answer = (intent = "results", none?: string): SearchAnswer => ({
  q: "q", hits: [], pages: [], step: "deterministic", weak: false,
  stat: { family: "event", intent, title: "x", scope: [], blocks: [{ kind: "record", title: "r", wins: 1, losses: 0, ties: 0 }], definition: "", source: "", ...(none ? { none } : {}) },
});
const clip: SearchVideo = { main: { videoId: "v", t: 10, end: 250, kind: "recording", match: "Q1" } };

describe("asksVideo", () => {
  it("reads the words asking to watch, and answers of highlights", () => {
    expect(asksVideo("6980 results at east bergen with video", answer())).toBe(true);
    expect(asksVideo("who won into the deep highlights", answer())).toBe(true);
    expect(asksVideo("6980", answer("team-highlights"))).toBe(true);
    expect(asksVideo("6980 results at east bergen", answer())).toBe(false);
  });
  it("hasVideo: a card's clip, a row's, or the recording a match is in", () => {
    expect(hasVideo(undefined)).toBe(false);
    expect(hasVideo({ rows: {} })).toBe(false);
    expect(hasVideo({ rows: { "/x": clip.main! } })).toBe(true);
    expect(hasVideo({ watch: { videoId: "v", t: 0, kind: "stream" } })).toBe(true);
  });
});

describe("withVideoAlternatives", () => {
  const plays = new Set(["b highlights", "d highlights", "e highlights", "f highlights"]);
  const asked: string[] = [];
  const askOf = async (q: string) => { asked.push(q); return { ...answer(), q }; };
  const videoOf = async (a: SearchAnswer) => (plays.has(a.q) ? clip : undefined);
  const cands = async () => ["a highlights", "b highlights", "c highlights", "d highlights", "e highlights", "f highlights"];

  it("offers at most three that play, first among the answer's blocks", async () => {
    const out = await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, askOf, videoOf, 1000, cands);
    expect(out.stat?.blocks[0]).toEqual({ kind: "related", title: "Questions with video", queries: ["b highlights", "d highlights", "e highlights"] });
    expect(out.stat?.blocks).toHaveLength(2);
    // Stops asking once three are found.
    expect(asked).not.toContain("f highlights");
  });

  it("never when the answer plays, when the search didn't ask to watch, or when none of them plays", async () => {
    const a = answer();
    expect(await withVideoAlternatives("6980 at east bergen with video", a, clip, askOf, videoOf, 1000, cands)).toBe(a);
    expect(await withVideoAlternatives("6980 at east bergen", a, undefined, askOf, videoOf, 1000, cands)).toBe(a);
    expect(await withVideoAlternatives("6980 at east bergen with video", a, undefined, askOf, async () => undefined, 1000, cands)).toBe(a);
  });

  it("a question whose answer says none is never offered", async () => {
    const out = await withVideoAlternatives("6980 with video", answer("season-matches"), undefined, async (q) => ({ ...answer("results", "None"), q }), videoOf, 1000, cands);
    expect(out.stat?.blocks.some((b) => b.kind === "related")).toBe(false);
  });

  it("never holds the answer up: past the wait, the answer as it is", async () => {
    const a = answer();
    const slow = () => new Promise<string[]>((r) => setTimeout(() => r(["b highlights"]), 200));
    expect(await withVideoAlternatives("6980 at east bergen with video", a, undefined, askOf, videoOf, 20, slow)).toBe(a);
  });
});
