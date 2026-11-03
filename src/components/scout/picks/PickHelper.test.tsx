// @vitest-environment jsdom
// The pick helper: with your team chosen it shows your alliance and the partners that cover the most radar area,
// each with what it adds; Taken drops a team (and Put back returns it); a posted alliance is used as posted and,
// once full, nothing is suggested; no event asks for one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { forget } from "../../../lib/api";
import { PickHelper } from "./PickHelper";
import type { PickRatings, PickTeam } from "../../../shared/pickRadar";

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const team = (n: number, auto: number, teleop: number, endgame: number, fouls: number): PickTeam => ({ team: n, name: `Team ${n}`, rank: null, auto, teleop, endgame, fouls, matches: 10 });
const base: PickRatings = {
  season: 2025, code: "USTEST", name: "Test Qualifier",
  teams: [team(10, 10, 80, 0, 5), team(20, 12, 100, 0, 5), team(30, 10, 50, 15, 5), team(40, 2, 10, 1, 30)],
  unrated: [99], alliances: [], size: 2, sizeFrom: "default",
};
const PATH = "/api/events/2025/USTEST/pick-ratings";
let body: PickRatings = base;
beforeEach(() => {
  forget([PATH]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (url = "/scout?tab=picks", myTeam: number | null = 10, eventCode: string | null = "USTEST") =>
  render(<MemoryRouter initialEntries={[url]}><PickHelper season={2025} eventCode={eventCode} myTeam={myTeam} onPickEvent={() => {}} /></MemoryRouter>);

describe("PickHelper", () => {
  it("suggests the gap-filler first, with what it adds and its rating place", async () => {
    body = base;
    show();
    await screen.findByText("Your alliance");
    const cards = screen.getAllByRole("button", { name: /Mark \d+ taken/ }).map((b) => b.getAttribute("aria-label"));
    expect(cards[0]).toBe("Mark 30 taken");
    expect(screen.getByText("Your alliance")).toBeTruthy();
    expect(screen.getByText("#2 by rating")).toBeTruthy();
    expect(screen.getAllByLabelText("What it adds")[0].textContent).toContain("Endgame +");
    expect(screen.getByText(/1 with no rating yet/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Your alliance: Auto/ })).toBeTruthy();
  });
  it("Taken drops a team and Put back returns it", async () => {
    body = base;
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Mark 30 taken" }));
    expect(screen.queryByRole("button", { name: "Mark 30 taken" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Put 30 back" }));
    expect(screen.getByRole("button", { name: "Mark 30 taken" })).toBeTruthy();
  });
  it("a posted alliance is used as posted; a full one gets no suggestions", async () => {
    body = { ...base, alliances: [{ number: 1, captain: 10, pick1: 20, pick2: null }], sizeFrom: "alliances" };
    show();
    expect(await screen.findByText("As posted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /taken/ })).toBeNull();
    expect(screen.getByText(/Your alliance is set as posted/)).toBeTruthy();
    // Posted alliances off: planned from the start, 20 is free again.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("As posted")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark 20 taken" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    // 3 teams: a second pick from who's left (not 20, already on the alliance).
    fireEvent.click(screen.getByRole("radio", { name: "3 teams" }));
    const names = screen.getAllByRole("button", { name: /Mark \d+ taken/ }).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Mark 30 taken", "Mark 40 taken"]);
  });
  it("a posted partner with no rating is named, not counted as zero", async () => {
    body = { ...base, alliances: [{ number: 1, captain: 10, pick1: 99, pick2: null }], sizeFrom: "alliances" };
    show();
    expect((await screen.findByRole("note")).textContent).toBe("99 has no rating yet, so the chart counts only 10.");
  });
  it("asks again for the posted alliances every minute while open, and on Refresh", async () => {
    body = base;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show();
      await screen.findByText("Your alliance");
      const calls = () => (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      const before = calls();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls()).toBeGreaterThan(before);
      const after = calls();
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await vi.waitFor(() => expect(calls()).toBeGreaterThan(after));
    } finally { vi.useRealTimers(); }
  });
  it("asks for a team, and for an event", async () => {
    body = base;
    show("/scout?tab=picks", null);
    expect(await screen.findByText("See which partners here fill your alliance's gaps.")).toBeTruthy();
    cleanup();
    show("/scout?tab=picks", 10, null);
    expect(within(document.body).getByText("Choose an event first")).toBeTruthy();
  });
});
