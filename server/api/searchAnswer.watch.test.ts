// Words asking to watch (search video brief, points 1 and 2): dropped from a question whose answer didn't take them,
// read from the lexicon's own phrases ("with video", "video", "clips", "highlights"), never leaving a lone word.
import { describe, expect, it } from "vitest";
import { withoutWatch } from "./searchAnswer";

describe("withoutWatch", () => {
  it("drops the words asking to watch, wherever they stand", () => {
    expect(withoutWatch("who won into the deep with video")).toBe("who won into the deep");
    expect(withoutWatch("who won into the deep highlights")).toBe("who won into the deep");
    expect(withoutWatch("video of who won into the deep")).toBe("of who won into the deep");
    expect(withoutWatch("nj states winners clips")).toBe("nj states winners");
  });
  it("keeps a query with none, and one that would be a single word", () => {
    expect(withoutWatch("who won into the deep")).toBe("who won into the deep");
    expect(withoutWatch("6980 highlights")).toBe("6980 highlights");
    // "Best matches" asks for matches, not to watch.
    expect(withoutWatch("best matches in ohio")).toBe("best matches in ohio");
  });
});
