// @vitest-environment jsdom
// My team for a team whose season so far is off-season events and scrimmages only: its record (official events only,
// src/shared/eventRecord.ts) is empty, so the win-rate tile says there are no official results yet instead of an empty
// rate, and the Record tile says its scope (launch audit D2 follow-up).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TeamProfile } from "../shared/api";

const tracked = { teams: [], events: [] };
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, set: () => {}, update: () => {}, state: { myTeam: 19641, videoLinks: {}, tracked, bookmarks: [] } }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, usePredictable: () => false, useTitle: () => {} }));

const { default: MyTeamPage } = await import("./MyTeamPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const { resetFlags } = await import("../lib/flags");
const { DEFAULT_FLAGS } = await import("../shared/flags");

const stat = (value: number, rank: number) => ({ value, rank, of: 8308 });
const profile = {
  team: { number: 19641, name: "Mars" }, season: 2025, seasons: [2025],
  stats: { opr: { np: stat(100.6, 630), auto: stat(20, 600), teleop: stat(70, 600), endgame: stat(10, 600), pen: 0 }, rating: null,
    record: { wins: 0, losses: 0, ties: 0, matches: 17, events: 2 }, avg: { np: 90, score: 95, pen: 5 } },
  events: [], awardsAllTime: [],
} as unknown as TeamProfile;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/teams/19641/matches")) return json({ matches: [] });
    if (path.startsWith("/api/teams/19641")) return json(profile);
    return json({});
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("My team, off-season matches only", () => {
  it("says there are no official results yet, never an empty rate, and the Record tile says its scope", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/my-team"]}><MyTeamPage /></MemoryRouter></TooltipProvider>);
    const none = await waitFor(() => { const e = document.querySelector("[data-no-official]"); if (!e) throw new Error("not yet"); return e; });
    expect(none.textContent).toBe("No official results yet: 17 matches at off-season events and scrimmages, not in the record.");
    expect(document.body.textContent).not.toMatch(/null%|NaN%/);
    expect(screen.getByText(/Official events only · 17 matches at 2 events in all/)).toBeTruthy();
  });
});
