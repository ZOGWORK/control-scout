// @vitest-environment jsdom
// A team's season (a list across events, newest first): a visible gap where an event's qualification matches meet
// its playoffs (#2239). An event's own schedule keeps its Qualifications / Playoffs headings and no gap.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const match = (code: string, level: "qual" | "playoff", n: number): MatchView => ({
  season: 2025, code, key: `${level}:${level === "playoff" ? n : 0}:${n}`, level, series: level === "playoff" ? n : 0, number: n, label: `${level === "qual" ? "Q" : "M"}${n}`, time: null, startsAt: null, played: true,
  red: side([11, 12], 100), blue: side([13, 14], 90), video: null,
  prediction: null as unknown as MatchView["prediction"],
});
afterEach(cleanup);

const order = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-match], [data-level-break], h3")].map((e) =>
  e.hasAttribute("data-level-break") ? "|" : e.tagName === "H3" ? `#${e.textContent?.replace(/\d+$/, "")}` : e.getAttribute("data-match")!.split(":").pop()!);

it("a team's season: a gap between each event's playoffs and its qualification matches, none between events", () => {
  const ms = [match("A", "qual", 1), match("A", "qual", 2), match("A", "playoff", 1), match("B", "qual", 1), match("B", "playoff", 1)];
  const { container } = render(<MemoryRouter><TooltipProvider><MatchList matches={[...ms].reverse()} highlight={11} eventNames={{ A: "Event A", B: "Event B" }} newestFirst /></TooltipProvider></MemoryRouter>);
  expect(order(container)).toEqual(["#Event B", "1", "|", "1", "#Event A", "1", "|", "2", "1"]);
  expect(container.querySelector("[data-level-break]")!.getAttribute("aria-hidden")).toBe("true");
});

it("an event's own schedule: its level headings, no gap", () => {
  const ms = [match("A", "qual", 1), match("A", "playoff", 1)];
  const { container } = render(<MemoryRouter><TooltipProvider><MatchList matches={ms} highlight={11} /></TooltipProvider></MemoryRouter>);
  expect(container.querySelector("[data-level-break]")).toBeNull();
});
