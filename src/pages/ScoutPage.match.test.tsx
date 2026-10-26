// @vitest-environment jsdom
// The redesigned Scout page end to end: with no session it asks where you're scouting; with one it opens on the
// next match from the schedule, both alliance teams as tabs, and one Save makes one entry per team at that
// event and match, then moves to the next match. Data still holds the entry list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { localScoutEntries, saveScoutEntry } from "../lib/scouting";
import { writeScoutSession } from "../lib/scoutSession";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";
import type { MatchView } from "../shared/api";

const h = vi.hoisted(() => ({ personal: { user: null, providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {}, bookmarks: [], myTeam: null } } }));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const team = (number: number) => ({ number, surrogate: false, dq: false, onField: true });
const match = (n: number, red: number[], blue: number[]): MatchView => ({
  season: 2025, code: "USNJQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: `2025-11-08T10:${String(n).padStart(2, "0")}:00`, startsAt: null, played: false,
  red: { teams: red.map(team), score: null }, blue: { teams: blue.map(team), score: null }, video: null, prediction: null,
});
const detail = { event: { name: "NJ Qualifier 1", code: "USNJQ1" }, matches: [match(1, [101, 102], [201, 202]), match(2, [103, 104], [203, 204])], field: [], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null };

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ScoutPage /><Where /></MemoryRouter></TooltipProvider>);
const param = (k: string) => new URLSearchParams(where).get(k);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear(); sessionStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/events/2025/USNJQ1")) return new Response(JSON.stringify(detail), { status: 200 });
    if (url.includes("/api/events")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetFlags({ ...DEFAULT_FLAGS }); });

describe("the Match tab", () => {
  it("with no session, asks where you're scouting", async () => {
    show("/scout?season=2025");
    expect(await screen.findByText("Where are you scouting?")).toBeTruthy();
  });

  it("scouts a whole match for an alliance with one Save, then moves to the next match", async () => {
    writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "red" } });
    show("/scout?season=2025");
    // The schedule's first match, its red teams as tabs.
    expect(await screen.findByRole("button", { name: /Save Q1/ })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent).join()).toMatch(/101.*102/);
    // A tap on team 101's first counter, then the same for 102.
    const addOne = () => screen.getAllByRole("button", { name: /Add one$/ })[0];
    fireEvent.click(addOne());
    fireEvent.click(screen.getAllByRole("tab").find((t) => t.textContent?.includes("102"))!);
    fireEvent.click(addOne());
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    await waitFor(() => expect(param("match")).toBe("Q2"));
    const saved = localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => [e.team, e.matchLabel, e.kind]).sort();
    expect(saved).toEqual([[101, "Q1", "match"], [102, "Q1", "match"]]);
    expect(await screen.findByRole("button", { name: /Save Q2/ })).toBeTruthy();
  });

  it("a team with nothing entered is asked about, and Skip saves only the other", async () => {
    writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "red" } });
    show("/scout?season=2025");
    fireEvent.click((await screen.findAllByRole("button", { name: /Add one$/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip 102" }));
    await waitFor(() => expect(param("match")).toBe("Q2"));
    expect(localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => e.team)).toEqual([101]);
  });

  it("opens where scouting picks up: after the last match done", async () => {
    writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "red" } });
    for (const t of [101, 102]) saveScoutEntry({ uuid: `done-${t}`, season: 2025, team: t, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "" });
    show("/scout?season=2025");
    expect(await screen.findByRole("button", { name: /Save Q2/ })).toBeTruthy();
  });

  it("Data still has the entry list", async () => {
    saveScoutEntry({ uuid: "old-entry", season: 2025, team: 4242, eventCode: "USNJQ1", matchLabel: "Q9", kind: "match", data: {}, notes: "" });
    show("/scout?season=2025&tab=data");
    fireEvent.click(await screen.findByRole("button", { name: /Entries/ }));
    expect(await screen.findByText("4242")).toBeTruthy();
    expect(param("view")).toBe("entries");
  });
});
