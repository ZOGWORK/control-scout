// @vitest-environment jsdom
// What if: under a predicted match, one robot swapped for another shows the call and margin before and after, and
// the swap is in the address. And the lab takes one robot a side (a search answer's two-team call opens as one).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");
const { readWhatIf, swapped } = await import("../components/predict/WhatIf");

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const strength = (team: number) => ({ team, name: null, np: 50, sd: 10, auto: 10, teleop: 30, endgame: 10, matches: 8 });
const asked: string[] = [];

beforeEach(() => {
  invalidate("/api/");
  asked.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(String(url), "http://x");
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/predict/match") {
      asked.push(`${u.searchParams.get("red")}|${u.searchParams.get("blue")}`);
      const red = u.searchParams.get("red")!.split(",").map(Number), blue = u.searchParams.get("blue")!.split(",").map(Number);
      // 1 on red: Red 70% and ahead by 10; anyone else in its place: Red 30% and behind by 15.
      const strong = red[0] === 1;
      return json({ season: 2025, red, blue, winProbRed: strong ? 0.7 : 0.3, winProbBlue: strong ? 0.3 : 0.7, predictedRed: strong ? 100 : 75, predictedBlue: 90, rangeRed: [80, 120], rangeBlue: [70, 110], rangeLevel: 0.8, factors: [], confidence: { tier: "moderate", reason: "r", minMatches: 8, ratingShare: 1 }, teamsRed: red.map(strength), teamsBlue: blue.map(strength), engineVersion: "x" });
    }
    if (u.pathname === "/api/search") { const q = u.searchParams.get("q"); return json({ hits: q === "404" ? [] : [{ kind: "team", ref: q, title: `${q} | Team ${q}` }] }); }
    return json({ events: [], seasons: [] });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("What if", () => {
  it("reads a swap only when it takes out a robot in the match and brings in one that isn't", () => {
    expect(readWhatIf("1:9", [1, 2, 3, 4])).toEqual({ out: 1, in: 9 });
    expect(readWhatIf("7:9", [1, 2, 3, 4])).toBeNull();
    expect(readWhatIf("1:3", [1, 2, 3, 4])).toBeNull();
    expect(readWhatIf("1:x", [1, 2, 3, 4])).toBeNull();
    expect(swapped([1, 2], 1, 9)).toEqual([9, 2]);
  });

  it("swapping a partner shows the call and margin before and after, and the address keeps the swap", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1,2&blue=3,4"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    const panel = await screen.findByTestId("what-if");
    fireEvent.change(screen.getByRole("textbox", { name: "Instead of 1" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(new URLSearchParams(where).get("whatif")).toBe("1:9"));
    expect(await screen.findByTestId("what-if-after")).toBeTruthy();
    expect(asked).toContain("9,2|3,4");
    expect(screen.getByTestId("what-if-before").textContent).toMatch(/Red 1 \+ 2.*70%.*Red by 10 \(100–90\)/);
    expect(screen.getByTestId("what-if-after").textContent).toMatch(/Red 9 \+ 2.*30%.*Blue by 15 \(75–90\)/);
    expect(screen.getByTestId("what-if-change").textContent).toMatch(/Red's chance falls 40 points, and the margin moves 25 toward Blue/);
    expect(panel.querySelector('a[href="/predict?mode=match&season=2025&red=9,2&blue=3,4"]')).toBeTruthy();
    // Undo takes the swap back out of the address.
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(new URLSearchParams(where).get("whatif")).toBeNull());
    expect(screen.queryByTestId("what-if-result")).toBeNull();
  });

  it("an opponent can be swapped too, and a robot already in the match is refused", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1,2&blue=3,4"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    await screen.findByTestId("what-if");
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Instead of 4" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    expect(await screen.findByText(/2 is already in this match/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Instead of 4" }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(asked).toContain("1,2|3,8"));
  });

  it("a shared what-if link opens with the swap already made", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1,2&blue=3,4&whatif=1:9"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(await screen.findByTestId("what-if-after")).toBeTruthy();
    expect(asked).toEqual(expect.arrayContaining(["1,2|3,4", "9,2|3,4"]));
  });
});

describe("One robot a side", () => {
  it("a two-team link (one a side) is predicted straight away, with its what-if", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1&blue=3"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(await screen.findByText("Red 1")).toBeTruthy();
    expect(asked).toContain("1|3");
    expect(screen.getByTestId("what-if")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Red team 2" }) as HTMLInputElement).value).toBe("");
  });

  it("the form predicts with a box left blank on each side", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Red team 1" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Blue team 2" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Predict this match/ }));
    await waitFor(() => expect(new URLSearchParams(where).get("red")).toBe("1"));
    expect(new URLSearchParams(where).get("blue")).toBe("3");
    expect(await screen.findByText("Red 1")).toBeTruthy();
  });
});
