// @vitest-environment jsdom
// A double-elimination playoff row: each alliance's lives as two hearts at its box's left, each heart named; none on
// a qualification match or a match with no lives (any other playoff format).
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchRow } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const match = (o: Partial<MatchView> = {}): MatchView => ({ season: 2025, code: "LIVES", key: "playoff:9:1", level: "playoff", series: 9, number: 1, label: "M9", time: null, startsAt: null,
  played: true, red: side([21379, 30605], 226), blue: side([27393, 19745], 204), video: null, prediction: null, ...o });
const show = (m: MatchView) => render(<MemoryRouter><TooltipProvider><MatchRow m={m} /></TooltipProvider></MemoryRouter>).container;
const hearts = (c: HTMLElement, s: "red" | "blue") => [...c.querySelectorAll(`[data-alliances] > div:nth-child(${s === "red" ? 1 : 2}) [data-heart]`)];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => cleanup());

describe("double-elimination lives on a match row", () => {
  it("the winner keeps its lives, the loser's broken heart says it went down to the lower bracket", () => {
    const c = show(match({ lives: { red: { before: 2, after: 2 }, blue: { before: 2, after: 1 } } }));
    expect(hearts(c, "red").map((h) => h.getAttribute("data-heart"))).toEqual(["left", "left"]);
    expect(hearts(c, "blue").map((h) => h.getAttribute("data-heart"))).toEqual(["left", "broken"]);
    expect(hearts(c, "red")[0].getAttribute("aria-label")).toBe("2 lives left");
    expect(hearts(c, "blue")[1].getAttribute("aria-label")).toBe("Lost a life this match: down to the lower bracket");
    for (const h of [...hearts(c, "red"), ...hearts(c, "blue")]) {
      expect(h.getAttribute("role")).toBe("img");
      expect(h.querySelector("title")?.textContent).toBe(h.getAttribute("aria-label"));
      // Alliance or neutral colours only.
      expect(h.getAttribute("class")).not.toMatch(/accent|yellow|amber|orange|warning|destructive/);
    }
  });
  it("a lower-bracket loss: an earlier life lost (outline) and this match's broken heart, eliminated", () => {
    const c = show(match({ lives: { red: { before: 1, after: 1 }, blue: { before: 1, after: 0 } } }));
    expect(hearts(c, "red").map((h) => h.getAttribute("data-heart"))).toEqual(["left", "lost"]);
    expect(hearts(c, "blue").map((h) => h.getAttribute("data-heart"))).toEqual(["broken", "lost"]);
    expect(hearts(c, "blue")[0].getAttribute("aria-label")).toBe("Lost its last life this match: eliminated");
    expect(hearts(c, "red")[1].getAttribute("aria-label")).toBe("A life lost in an earlier match");
  });
  it("the hearts sit first in each alliance box (the blue box's reversed row puts them at its left too)", () => {
    const c = show(match({ lives: { red: { before: 2, after: 2 }, blue: { before: 1, after: 1 } } }));
    const boxes = c.querySelectorAll("[data-alliances] > div");
    expect(boxes[0].firstElementChild!.querySelector("[data-lives]")).not.toBeNull();
    expect(boxes[1].firstElementChild!.querySelector("[data-lives]")).not.toBeNull();
    expect(boxes[1].firstElementChild!.className).toContain("@min-[330px]:order-last");
  });
  it("no hearts on a qualification match or a playoff match with no lives (another format)", () => {
    expect(show(match({ level: "qual", key: "qual:0:9", series: 0, label: "Q9" })).querySelector("[data-heart]")).toBeNull();
    cleanup();
    expect(show(match()).querySelector("[data-heart]")).toBeNull();
  });
});
