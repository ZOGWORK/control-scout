// @vitest-environment jsdom
// The match page's call, drawn as the score table is: Red / Call / Blue headers, a row per item with its icon and name
// (Odds, Predicted, Actual, Off by, each bonus RP), values in the alliance colours and the call in words in the
// middle. An upset is emphasised in the theme's info blue, never a warning colour; the confidence is a labelled badge.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchDetail } from "../shared/api";

vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
const { Prediction } = await import("./MatchDetails");
const { TooltipProvider } = await import("./ui/overlay");

afterEach(cleanup);
const score = (total: number) => ({ total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 });
const side = (ts: number[], total: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: score(total) });
const detail = (red: number, blue: number): MatchDetail => ({
  event: { season: 2025, code: "TEST", name: "Test", status: "done" },
  match: { season: 2025, code: "TEST", key: "playoff:9:1", level: "playoff", series: 9, number: 1, label: "M9", time: null, startsAt: null, played: true,
    red: side([21379, 30605], red), blue: side([27393, 19745], blue), video: null,
    prediction: { pRed: 0.3, redMean: 201, blueMean: 218, redRange: [165, 237], blueRange: [155, 281], rangeLevel: 0.8, tier: "confident", kind: "live", predictedAt: null } },
  description: null, stations: {}, bonus: null, teams: [],
} as unknown as MatchDetail);
const show = (d: MatchDetail) => render(<MemoryRouter><TooltipProvider><Prediction d={d} /></TooltipProvider></MemoryRouter>).container;

describe("the call as a table", () => {
  it("has the score table's headers and a labelled row per item, the call in words in the middle", () => {
    const c = show(detail(226, 204));
    const head = c.querySelector("[data-call-table]")!.previousElementSibling!.textContent;
    expect(head).toBe("ItemRedCallBlue");
    const rows = [...c.querySelectorAll("[data-call-table] > li")].map((li) => li.textContent);
    expect(rows[0]).toMatch(/^Odds30%.*70%$/);
    expect(rows[1]).toMatch(/^Predicted201.*Blue by 17.*218/);
    expect(rows[2]).toBe("Actual226Upset204");
    expect(rows[3]).toBe("Off by+25both in range−14");
    // Every row has its icon.
    for (const li of c.querySelectorAll("[data-call-table] > li")) expect(li.querySelector("svg")).not.toBeNull();
  });
  it("an upset is in the info blue, never a warning colour; a right call in green", () => {
    const up = show(detail(226, 204)).querySelector("[data-called]")!;
    expect(up.getAttribute("data-called")).toBe("upset");
    expect(up.className).toContain("text-info");
    expect(up.className).not.toMatch(/warning|orange|amber|accent/);
    cleanup();
    expect(show(detail(180, 230)).querySelector("[data-called]")!.className).toContain("text-success");
  });
  it("names the confidence: a labelled badge, not a bare word", () => {
    const conf = show(detail(226, 204)).querySelector("[data-confidence]")!;
    expect(conf.getAttribute("data-confidence")).toBe("confident");
    expect(conf.textContent).toMatch(/^Confidence.*Confidence: Solid$/);
    expect(conf.querySelector("span.rounded-md")!.className).not.toMatch(/warning|success|info/);
  });
});
