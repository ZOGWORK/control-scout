// No dead ends for video (./videoSuggest.ts, search video brief point 7): a search asking to watch whose answer plays
// nothing gets questions that do play, each checked by asking it; never one whose answer has no video, never when the
// answer already plays, and never holding the answer up.
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchAnswer, SearchVideo } from "../../../src/shared/api";
import { asksVideo, forgetVideoChecks, hasVideo, withVideoAlternatives } from "./videoSuggest";

beforeEach(() => forgetVideoChecks());

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
  const askOf = async (q: string) => ({ ...answer(), q });
  const videoOf = async (a: SearchAnswer) => (plays.has(a.q) ? clip : undefined);
  const cands = async () => ["a highlights", "b highlights", "c highlights", "d highlights", "e highlights", "f highlights"];

  it("offers at most three that play, first among the answer's blocks", async () => {
    const asked: string[] = [];
    const out = await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, async (q) => { asked.push(q); return askOf(q); }, videoOf, 1000, cands);
    expect(out.stat?.blocks[0]).toEqual({ kind: "related", title: "Questions with video", queries: ["b highlights", "d highlights", "e highlights"] });
    expect(out.stat?.blocks).toHaveLength(2);
    // Stops asking once three are found.
    expect(asked).not.toContain("f highlights");
  });

  it("never when the answer plays, when the search didn't ask to watch, or when none of them plays", async () => {
    const a = answer();
    expect(await withVideoAlternatives("6980 at east bergen with video", a, clip, askOf, videoOf, 1000, cands)).toBe(a);
    expect(await withVideoAlternatives("6980 at east bergen", a, undefined, askOf, videoOf, 1000, cands)).toBe(a);
    // Spacing alone is no watch word.
    expect(await withVideoAlternatives("6980  results at east bergen", a, undefined, askOf, videoOf, 1000, cands)).toBe(a);
    expect(await withVideoAlternatives("6980 at east bergen with video", a, undefined, askOf, async () => undefined, 1000, cands)).toBe(a);
  });

  it("a question whose answer says none is never offered", async () => {
    const out = await withVideoAlternatives("6980 at east bergen with video", answer("season-matches"), undefined, async (q) => ({ ...answer("results", "None"), q }), videoOf, 1000, cands);
    expect(out.stat?.blocks.some((b) => b.kind === "related")).toBe(false);
  });

  it("never holds the answer up: past the wait, the answer as it is", async () => {
    const a = answer();
    const slow = () => new Promise<string[]>((r) => setTimeout(() => r(["b highlights"]), 200));
    expect(await withVideoAlternatives("6980 at east bergen with video", a, undefined, askOf, videoOf, 20, slow)).toBe(a);
    // And the checks still to come are never run.
    const run: string[] = [];
    const late = () => new Promise<string[]>((r) => setTimeout(() => r(["b highlights", "c highlights"]), 60));
    await withVideoAlternatives("6980 at east bergen with video", a, undefined, async (q) => { run.push(q); return askOf(q); }, videoOf, 20, late);
    await new Promise((r) => setTimeout(r, 150));
    expect(run).toEqual([]);
  });

  it("past the wait, the questions already found are offered, and a check whose turn comes later never runs", async () => {
    const a = answer();
    const run: string[] = [];
    const ask = async (q: string) => {
      run.push(q);
      if (q === "c highlights") await new Promise((r) => setTimeout(r, 200));
      return askOf(q);
    };
    const out = await withVideoAlternatives("6980 at east bergen with video", a, undefined, ask, videoOf, 80, async () => ["b highlights", "c highlights", "d highlights"]);
    const offered = out.stat?.blocks.find((x) => x.kind === "related");
    expect(offered && offered.kind === "related" ? offered.queries : []).toEqual(["b highlights"]);
    await new Promise((r) => setTimeout(r, 300));
    expect(run).not.toContain("d highlights");
  });

  it("two searches asking at once share each question's check", async () => {
    let asks = 0;
    const ask = async (q: string) => { asks++; return askOf(q); };
    const two = ["b highlights"];
    await Promise.all([1, 2].map(() => withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, async () => two)));
    expect(asks).toBe(1);
    // Another viewer's check is its own.
    await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, async () => two, "u7");
    expect(asks).toBe(2);
  });

  it("one search's wait never cancels a check another search still waits on", async () => {
    let asks = 0;
    const ask = async (q: string) => { asks++; await new Promise((r) => setTimeout(r, 60)); return askOf(q); };
    const one = async () => ["b highlights"];
    const [short, long] = await Promise.all([
      withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 10, one),
      withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one),
    ]);
    expect(short.stat?.blocks.some((x) => x.kind === "related")).toBe(false);
    expect(long.stat?.blocks[0]).toMatchObject({ kind: "related", queries: ["b highlights"] });
    expect(asks).toBe(1);
  });

  it("a failed read is never kept as no video", async () => {
    let fail = true;
    const ask = async (q: string) => { if (fail) throw new Error("busy"); return askOf(q); };
    const one = async () => ["b highlights"];
    expect((await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one)).stat?.blocks.some((x) => x.kind === "related")).toBe(false);
    fail = false;
    await new Promise((r) => setTimeout(r, 0));
    expect((await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one)).stat?.blocks[0]).toMatchObject({ kind: "related" });
  });

  it("a full list of checks never drops one still running", async () => {
    const many = Array.from({ length: 499 }, (_, i) => `n${i} highlights`);
    await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, askOf, async () => undefined, 5000, async () => many);
    let slowAsks = 0;
    const ask = async (q: string) => { if (q === "b highlights") { slowAsks++; await new Promise((r) => setTimeout(r, 80)); } return askOf(q); };
    const one = (c: string) => async () => [c];
    const first = withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one("b highlights"));
    await new Promise((r) => setTimeout(r, 10));
    await withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one("x highlights"));
    const second = withVideoAlternatives("6980 at east bergen with video", answer(), undefined, ask, videoOf, 1000, one("b highlights"));
    await Promise.all([first, second]);
    expect(slowAsks).toBe(1);
  });

  it("stray spaces around a query are no watch word", async () => {
    const a = answer();
    expect(await withVideoAlternatives(" 4215 matches ", a, undefined, askOf, videoOf, 1000, cands)).toBe(a);
  });
});
