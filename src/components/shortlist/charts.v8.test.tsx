// @vitest-environment jsdom
// The pick list's OPR trend line in v8: always the accent (the charts' one highlight colour), never green or red; with
// v8 off it keeps its rise/fall colours.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("../arc/sparkline/sparkline", () => ({ Sparkline: ({ tone }: { tone?: string }) => <span data-tone={tone} /> }));
const { OprSpark } = await import("./charts");

const falling = [{ code: "A", name: "A", opr: 90 }, { code: "B", name: "B", opr: 60 }] as Parameters<typeof OprSpark>[0]["events"];
const tone = () => document.querySelector("[data-tone]")!.getAttribute("data-tone");

afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-v8"); });

describe("OprSpark tone", () => {
  it("v8: the accent, even when OPR fell", () => {
    document.documentElement.setAttribute("data-v8", "");
    render(<OprSpark events={falling} />);
    expect(tone()).toBe("accent");
  });
  it("v8 off: a fall is drawn as before", () => {
    render(<OprSpark events={falling} />);
    expect(tone()).toBe("danger");
  });
});
