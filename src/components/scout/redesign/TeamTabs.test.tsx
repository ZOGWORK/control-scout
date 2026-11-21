// @vitest-environment jsdom
// A team tab's status dot: saved is green in both looks (v8 adds its own green, since v8's success token is white),
// started amber (classic) / a white ring (v8), nothing yet a grey ring.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusDot } from "./TeamTabs";

afterEach(cleanup);

const dot = (status: "empty" | "started" | "done") => render(<StatusDot status={status} />).container.querySelector("[data-status]")!;

describe("StatusDot", () => {
  it("draws a saved team as a green dot, in v8 too", () => {
    const c = dot("done").className;
    expect(c).toContain("bg-success");
    expect(c).toContain("v8:bg-emerald-400");
    expect(c).toContain("v8:border-emerald-400");
  });

  it("keeps green off started and empty tabs", () => {
    expect(dot("started").className).not.toContain("emerald");
    expect(dot("empty").className).not.toContain("emerald");
  });
});
