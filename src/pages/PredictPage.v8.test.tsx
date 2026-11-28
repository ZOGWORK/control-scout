// @vitest-environment jsdom
// Predict in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "who wins this match, and why?":
// a bare /predict opens on the matchup, the call (each side's chance and the called score) comes straight after the
// pick, the reasons under it, and the detail and the what-if tool behind disclosures. On a phone the picked teams
// fold to one line. Your teams fill the boxes in a tap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const personal = vi.hoisted(() => ({ myTeam: null as number | null, teams: [] as number[] }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: personal.myTeam, tracked: { teams: personal.teams, events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage, bareLink } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");
const { readWhatIf, swapped } = await import("../components/predict/WhatIf");
/** Every call the page made, as "red|blue". */
const asked: string[] = [];

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const strength = (team: number) => ({ team, name: null, np: 50, sd: 10, auto: 10, teleop: 30, endgame: 10, pen: 2, matches: 8 });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const mount = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const MATCH = "/predict?mode=match&season=2025&red=1,2&blue=3,4";

beforeEach(() => {
  personal.myTeam = null; personal.teams = [];
  asked.length = 0;
  invalidate("/api/");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(String(url), "http://x");
    if (u.pathname === "/api/predict/match") {
      const red = u.searchParams.get("red")!.split(",").map(Number), blue = u.searchParams.get("blue")!.split(",").map(Number);
      asked.push(`${red.join(",")}|${blue.join(",")}`);
      // 1 on Red: Red 70% and ahead by 10. Anyone else in its place: Red 30% and behind by 15.
      const strong = red[0] === 1;
      const pRed = strong ? 0.7 : 0.3;
      return json({ season: 2025, red, blue, winProbRed: pRed, winProbBlue: 1 - pRed, predictedRed: strong ? 100 : 75, predictedBlue: 90, rangeRed: [80, 120], rangeBlue: [70, 110], rangeLevel: 0.8, factors: [], reasons: ["Red's autonomous is worth about 10 more points"], confidence: { tier: "moderate", reason: "r", minMatches: 8, ratingShare: 1 }, teamsRed: red.map(strength), teamsBlue: blue.map(strength), engineVersion: "x" });
    }
    return json({ events: [], seasons: [] });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("Predict, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("opens a bare /predict on the matchup, with the matchup tab first", () => {
    mount("/predict");
    expect(document.querySelector("[data-predict-v8]")).not.toBeNull();
    const tabs = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));
    expect(tabs).toEqual(["Custom matchup", "Scheduled", "Advancement"]);
    expect(screen.getByRole("tab", { name: "Custom matchup" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Red team 1" })).toBeTruthy();
    // Nothing picked yet: one plain line saying what you'll get.
    expect(screen.getByText("Pick the teams")).toBeTruthy();
  });

  it("keeps links that name a mode or carry a pick", () => {
    expect(bareLink(new URLSearchParams(""))).toBe(true);
    expect(bareLink(new URLSearchParams("mode=advancement"))).toBe(false);
    expect(bareLink(new URLSearchParams("for=team:4215"))).toBe(false);
    expect(bareLink(new URLSearchParams("code=USNJQ1"))).toBe(false);
    mount("/predict?mode=advancement");
    expect(screen.getByRole("tab", { name: "Advancement" }).getAttribute("aria-selected")).toBe("true");
  });

  it("puts the call right after the pick: both chances and the called score, then why, then the disclosures", async () => {
    mount(MATCH);
    const call = await screen.findByRole("region", { name: "The call" });
    const pick = document.querySelector("[data-matchup-pick]")!;
    expect(follows(pick, call)).toBe(true);
    expect(call.querySelector('[data-side="red"]')!.textContent).toContain("70%");
    expect(call.querySelector('[data-side="blue"]')!.textContent).toContain("30%");
    // The favourite is drawn full strength; the other side fades.
    expect(call.querySelector('[data-side="red"]')!.hasAttribute("data-favourite")).toBe(true);
    expect(call.querySelector('[data-side="blue"]')!.hasAttribute("data-favourite")).toBe(false);
    expect(call.querySelector("[data-called-score]")!.textContent).toMatch(/100.*Called score.*Red by 10.*90/);
    const why = screen.getByRole("heading", { name: "Why" });
    const detail = screen.getByTestId("call-detail"), whatIf = screen.getByTestId("call-what-if");
    expect(follows(call, why) && follows(why, detail) && follows(detail, whatIf)).toBe(true);
    // The ranges, ratings and the what-if tool wait behind closed disclosures.
    expect((detail as HTMLDetailsElement).open).toBe(false);
    expect((whatIf as HTMLDetailsElement).open).toBe(false);
    expect(detail.contains(screen.getByTestId("range-coverage"))).toBe(true);
    expect(detail.querySelector("table")).not.toBeNull();
  });

  it("has one primary button (Predict); the call's own actions are outline or plain", async () => {
    mount(MATCH);
    const call = await screen.findByRole("region", { name: "The call" });
    const primary = [...document.querySelectorAll('[data-slot="button"]')].filter((b) => b.className.includes("bg-accent text-accent-ink"));
    expect(primary.map((b) => b.textContent?.trim())).toEqual(["Predict"]);
    expect(call.querySelector('[data-slot="button"].bg-accent')).toBeNull();
  });

  it("folds the picked teams to one line on a phone, and Change teams opens the boxes again", async () => {
    mount(MATCH);
    await screen.findByRole("region", { name: "The call" });
    const summary = document.querySelector("[data-matchup-summary]")!;
    expect(summary.textContent).toContain("1 + 2");
    expect(summary.className).toContain("sm:hidden");
    const form = screen.getByRole("textbox", { name: "Red team 1" }).closest("form")!.parentElement!;
    expect(form.className).toContain("max-sm:hidden");
    fireEvent.click(screen.getByRole("button", { name: "Change teams" }));
    expect(document.querySelector("[data-matchup-summary]")).toBeNull();
    expect(form.className).not.toContain("max-sm:hidden");
  });

  it("fills the next empty box from your teams in a tap", async () => {
    personal.myTeam = 4215; personal.teams = [7149];
    mount("/predict?mode=match&season=2025");
    const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Add 4215 to the next empty box" }));
    expect(box("Red team 1").value).toBe("4215");
    // A team already in a box isn't offered again.
    expect(screen.queryByRole("button", { name: "Add 4215 to the next empty box" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add 7149 to the next empty box" }));
    expect(box("Red team 2").value).toBe("7149");
    fireEvent.change(box("Blue team 1"), { target: { value: "16236" } });
    fireEvent.change(box("Blue team 2"), { target: { value: "23014" } });
    fireEvent.click(screen.getByRole("button", { name: "Predict" }));
    await waitFor(() => expect(new URLSearchParams(where).get("red")).toBe("4215,7149"));
  });

  it("opens What if when the link carries a swap, and makes it", async () => {
    mount(`${MATCH}&whatif=1:9`);
    await screen.findByRole("region", { name: "The call" });
    expect((screen.getByTestId("call-what-if") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId("what-if")).toBeTruthy();
    expect(await screen.findByTestId("what-if-after")).toBeTruthy();
    expect(asked).toEqual(expect.arrayContaining(["1,2|3,4", "9,2|3,4"]));
  });

  it("reads a swap only when it takes out a robot in the match and brings in one that isn't", () => {
    expect(readWhatIf("1:9", [1, 2, 3, 4])).toEqual({ out: 1, in: 9 });
    expect(readWhatIf("7:9", [1, 2, 3, 4])).toBeNull();
    expect(readWhatIf("1:3", [1, 2, 3, 4])).toBeNull();
    expect(readWhatIf("1:x", [1, 2, 3, 4])).toBeNull();
    expect(swapped([1, 2], 1, 9)).toEqual([9, 2]);
  });

  it("swapping a partner shows the call and margin before and after, and Undo takes it back", async () => {
    mount(MATCH);
    await screen.findByRole("region", { name: "The call" });
    const details = screen.getByTestId("call-what-if") as HTMLDetailsElement;
    fireEvent.click(details.querySelector("summary")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Instead of 1" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(new URLSearchParams(where).get("whatif")).toBe("1:9"));
    expect(await screen.findByTestId("what-if-after")).toBeTruthy();
    expect(asked).toContain("9,2|3,4");
    expect(screen.getByTestId("what-if-before").textContent).toMatch(/Red 1 \+ 2.*70%.*Red by 10/);
    expect(screen.getByTestId("what-if-after").textContent).toMatch(/Red 9 \+ 2.*30%.*Blue by 15/);
    // Undo takes the swap back out of the address.
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(new URLSearchParams(where).get("whatif")).toBeNull());
    expect(screen.queryByTestId("what-if-result")).toBeNull();
  });

  it("one robot a side is predicted straight away, with its what-if", async () => {
    mount("/predict?mode=match&season=2025&red=1&blue=3");
    expect(await screen.findByRole("region", { name: "The call" })).toBeTruthy();
    expect(asked).toContain("1|3");
    expect(screen.getByTestId("what-if")).toBeTruthy();
  });

  it("two against one is never called: a forgotten box is pointed out", async () => {
    mount("/predict?mode=match&season=2025&red=1,2&blue=3");
    await waitFor(() => expect(screen.getByRole("button", { name: "Predict" })).toBeTruthy());
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Predict" }));
    expect(await screen.findByText(/one a side or two a side/)).toBeTruthy();
    expect(asked).toEqual([]);
  });
});
