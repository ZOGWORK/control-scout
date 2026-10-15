import { describe, expect, it } from "vitest";
import { viewOf } from "./PredictPage";

const v = (q: string) => viewOf(new URLSearchParams(q));

describe("Predict view from the URL", () => {
  it("opens the Lab for lab links, Events otherwise", () => {
    expect(v("")).toBe("events");
    expect(v("for=team:4215")).toBe("events");
    expect(v("mode=match&red=1,2&blue=3,4")).toBe("lab"); // Compare's Predict button
    expect(v("red=1,2")).toBe("lab"); // older links
    expect(v("code=USNJQ1")).toBe("lab");
  });
  it("an explicit view wins, so both views keep their own choices in the URL", () => {
    expect(v("view=events&mode=match&red=1,2&blue=3,4&for=team:4215")).toBe("events");
    expect(v("view=lab&for=team:4215&mode=advancement&code=X")).toBe("lab");
  });
});
