// @vitest-environment jsdom
// A link to one match (?match=) brings it into view once. Live updates that add matches to the list
// (the playoffs being drawn) must not pull the page back to it after the reader has scrolled on.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const match = (n: number): MatchView => ({
  season: 2025, code: "RPTQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: side([11, 12]), blue: side([13, 14]), video: null, prediction: null,
});

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (matches: MatchView[], initialOpen: string | null) => (
  <MemoryRouter><TooltipProvider><MatchList matches={matches} initialOpen={initialOpen} /></TooltipProvider></MemoryRouter>
);

it("scrolls to the linked match once, not again when matches are added", () => {
  const { rerender } = render(view([match(1), match(2)], "qual:0:2"));
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => rerender(view([match(1), match(2), match(3)], "qual:0:2")));
  act(() => rerender(view([match(1), match(2), match(3), match(4)], "qual:0:2")));
  expect(scrolled).toHaveBeenCalledTimes(1);
});

it("waits for the linked match to arrive, and follows a new link", () => {
  const { rerender } = render(view([], "qual:0:2"));
  expect(scrolled).not.toHaveBeenCalled();
  act(() => rerender(view([match(1), match(2)], "qual:0:2")));
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => rerender(view([match(1), match(2)], "qual:0:1")));
  expect(scrolled).toHaveBeenCalledTimes(2);
});
