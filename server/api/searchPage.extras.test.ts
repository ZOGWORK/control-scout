// An answer's extras (./searchPage.ts finishPageAnswer) are kept with the kept answer: worked out once a minute for
// it, never for another answer, read again for a visitor with videos of their own, and dropped with the clip caches.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";

const calls = { highlights: 0, hits: 0, video: 0 };
const fail = { video: false };
vi.mock("./searchPageAnswer.js", () => ({
  withHighlights: async (a: SearchAnswer) => { calls.highlights++; return { ...a }; },
  answerHits: async (h: SearchAnswer["hits"]) => { calls.hits++; return [...h]; },
}));
vi.mock("./answers/video.js", () => ({ answerVideo: async () => { calls.video++; if (fail.video) { fail.video = false; throw new Error("read failed"); } return undefined; } }));
const { finishPageAnswer } = await import("./searchPage");
const { clearClipCaches } = await import("../caches");

const answer = (q: string): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false });
const anyone = Promise.resolve({ userId: null, teams: [] });

beforeEach(() => { calls.highlights = calls.hits = calls.video = 0; vi.useRealTimers(); });

describe("an answer's extras", () => {
  it("are worked out once for one kept answer, again for another", async () => {
    const a = answer("4215");
    const one = await finishPageAnswer(a, 25, anyone);
    const two = await finishPageAnswer(a, 25, anyone);
    expect(two).toEqual(one);
    expect(calls).toEqual({ highlights: 1, hits: 1, video: 1 });
    await finishPageAnswer(answer("4215"), 25, anyone);
    expect(calls).toEqual({ highlights: 2, hits: 2, video: 2 });
  });

  it("read the video again for a visitor with videos of their own", async () => {
    const a = answer("x");
    await finishPageAnswer(a, 25, anyone);
    await finishPageAnswer(a, 25, Promise.resolve({ userId: 7, teams: [] }));
    await finishPageAnswer(a, 25, Promise.resolve({ userId: 7, teams: [] }));
    expect(calls).toEqual({ highlights: 1, hits: 1, video: 3 });
  });

  it("read the video again after a read that failed", async () => {
    const a = answer("z");
    fail.video = true;
    expect((await finishPageAnswer(a, 25, anyone)).body.video).toBeUndefined();
    expect((await finishPageAnswer(a, 25, anyone)).body.video).toBeNull();
    await finishPageAnswer(a, 25, anyone);
    expect(calls).toEqual({ highlights: 1, hits: 1, video: 2 });
  });

  it("are worked out again past their minute, and after a clip-start change", async () => {
    vi.useFakeTimers({ now: 0 });
    const a = answer("y");
    await finishPageAnswer(a, 25, anyone);
    vi.setSystemTime(61_000);
    await finishPageAnswer(a, 25, anyone);
    expect(calls.hits).toBe(2);
    clearClipCaches();
    await finishPageAnswer(a, 25, anyone);
    expect(calls.hits).toBe(3);
  });
});
