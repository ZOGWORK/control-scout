// @vitest-environment jsdom
// My teams: the account's FTC teams from Control Point, each with its season's stats and a link to its
// team page; honest empty states for signed out, Control Point unreachable, and no teams.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { TeamProfile } from "../shared/api";

const h = vi.hoisted(() => ({ user: null as AccountUser | null, providers: { email: true, google: false } as object | null }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: h.providers, refreshUser: async () => {}, state: { videoLinks: {}, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: MyTeamsPage } = await import("./MyTeamsPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const { resetFlags } = await import("../lib/flags");
const { DEFAULT_FLAGS } = await import("../shared/flags");

const user = (workspaces: { id: string; name: string; role: "admin" | "member" }[] | undefined, teams: { teamNumber: number | null; name: string }[] = []): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9, member: true, teams, url: "https://cp.test", ...(workspaces ? { workspaces } : {}) },
});
const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const profile = (season: number, played: boolean): TeamProfile => ({
  team: { number: 18360, name: "Hypnotic Robotics" }, season, seasons: [2026, 2025],
  stats: played ? {
    opr: { np: stat(101.6, 616), auto: stat(28.3, 883), teleop: stat(73.4, 644), endgame: stat(6.7, 5027), pen: -5 },
    rating: null, record: { wins: 26, losses: 6, ties: 0, matches: 32, events: 5 }, avg: { np: 90, score: 95, pen: 5 },
  } : null,
  events: played ? [{ season, code: "USCAQ1", name: "Bay Area Qualifier", type: "Qualifier", start: "2026-01-10", end: "2026-01-10", city: null, state: null, country: null,
    rank: 2, rp: null, wins: 5, losses: 1, ties: 0, qualPlayed: 6, opr: { np: 99.5, auto: null, teleop: null, endgame: null, pen: null }, avg: { score: null, np: null, pen: null }, awards: [], alliance: null }] : [],
  awardsAllTime: [],
} as unknown as TeamProfile);
// A team mid-event today (results already in) whose earlier event left a match with no posted result.
const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const ev = (code: string, name: string, start: string, end: string, rank: number | null) => ({ season: 2026, code, name, type: "Qualifier", start, end, city: null, state: null, country: null,
  rank, rp: null, wins: rank ? 3 : null, losses: rank ? 1 : null, ties: rank ? 0 : null, qualPlayed: null, opr: { np: rank ? 77.7 : null, auto: null, teleop: null, endgame: null, pen: null }, avg: { score: null, np: null, pen: null }, awards: [], alliance: null });
const liveProfile = () => ({ ...profile(2026, true), team: { number: 4215, name: "Live Bots" }, seasons: [2026],
  events: [ev("OLDQ", "Old Qualifier", day(-30), day(-30), null), ev("NOWQ", "Today Qualifier", day(0), day(1), 4)] });
const match = (code: string, key: string, number: number) => ({ season: 2026, code, key, level: "qual", series: 1, number, label: `Q${number}`, time: null, startsAt: null, played: false,
  red: { teams: [{ number: 4215, surrogate: false, dq: false, onField: true }], score: null }, blue: { teams: [{ number: 1, surrogate: false, dq: false, onField: true }], score: null }, video: null, prediction: null });
let paths: string[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  h.user = null; h.providers = { email: true, google: false }; paths = [];
  vi.stubGlobal("fetch", async (path: string) => {
    paths.push(path);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/api/teams/18360?season=2026") return json(profile(2026, false));
    if (path === "/api/teams/18360?season=2025") return json(profile(2025, true));
    if (path.startsWith("/api/teams/18360/matches")) return json({ matches: [] });
    if (path === "/api/teams/4215?season=2026") return json(liveProfile());
    if (path.startsWith("/api/teams/4215/matches")) return json({ matches: [match("OLDQ", "qual:1:3", 3), match("NOWQ", "qual:1:12", 12)] });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = () => render(<TooltipProvider><MemoryRouter initialEntries={["/my-teams"]}><MyTeamsPage /></MemoryRouter></TooltipProvider>);

describe("MyTeamsPage", () => {
  it("lists the account's team with its stats from its latest played season, linking to the team page and scout space", async () => {
    h.user = user([{ id: "77", name: "Hypnotic Robotics", role: "admin" }], [{ teamNumber: 18360, name: "Hypnotic Robotics" }]);
    page();
    const card = within(await screen.findByRole("article", { name: "Team 18360" }));
    await waitFor(() => expect(card.getByText("101.6")).toBeTruthy());
    expect(card.getByText(/No results in 2026–27 yet/)).toBeTruthy();
    expect(card.getByLabelText("26 wins, 6 losses, 0 ties")).toBeTruthy();
    expect(card.getByRole("link", { name: /Bay Area Qualifier/ }).getAttribute("href")).toBe("/events/2025/USCAQ1");
    expect(card.getByRole("link", { name: /Full team page/ }).getAttribute("href")).toBe("/teams/18360?season=2025");
    expect(card.getByRole("link", { name: /Hypnotic Robotics.*Admin/ }).getAttribute("href")).toBe("/scout?space=77");
    await waitFor(() => expect(paths).toContain("/api/teams/18360/matches?season=2025"));
    expect(paths).not.toContain("/api/teams/18360/matches?season=2026");
  });

  it("an event on now shows its results so far; a match left unplayed at an ended event isn't upcoming", async () => {
    h.user = user([{ id: "8", name: "Live Bots", role: "member" }], [{ teamNumber: 4215, name: "Live Bots" }]);
    page();
    const card = within(await screen.findByRole("article", { name: "Team 4215" }));
    const now = await waitFor(() => card.getByRole("link", { name: /Today Qualifier/ }));
    expect(now.textContent).toContain("3-1-0");
    expect(now.textContent).not.toContain("Upcoming");
    expect(card.getByRole("link", { name: /^4215/ }).getAttribute("href")).toBe("/teams/4215?season=2026");
    const upcoming = (await waitFor(() => card.getByText("Upcoming matches"))).parentElement!;
    await waitFor(() => expect(upcoming.textContent).toContain("Today Qualifier"));
    expect(upcoming.textContent).not.toContain("Old Qualifier");
  });

  it("a workspace with no FTC number says so instead of showing empty stats", () => {
    h.user = user([{ id: "5", name: "Rookies", role: "member" }], [{ teamNumber: null, name: "Rookies" }]);
    page();
    expect(screen.getByText(/No FTC team number is set for this team/)).toBeTruthy();
    expect(screen.getByText(/An admin can add it/)).toBeTruthy();
    expect(paths).toEqual([]);
  });

  it("signed out: asks to sign in, and offers following a team on this device", () => {
    page();
    expect(screen.getByText("Sign in to see your teams")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Follow a team on this device/ }).getAttribute("href")).toBe("/my-team");
  });

  it("Control Point's answer unknown: says so, never 'no teams'", () => {
    h.user = user(undefined);
    page();
    expect(screen.getByText("Couldn't reach Control Point")).toBeTruthy();
    expect(screen.queryByText("You're not on a team yet")).toBeNull();
  });

  it("no teams: an honest empty state with a way to join one", () => {
    h.user = user([]);
    page();
    expect(screen.getByText("You're not on a team yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Join or create a team in Control Point/ }).getAttribute("href")).toBe("https://cp.test");
  });
});
