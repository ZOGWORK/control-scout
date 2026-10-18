// @vitest-environment jsdom
// My teams: the account's FTC teams from Control Point, each with its season's stats and a link to its
// team page; honest empty states for signed out, Control Point unreachable, and no teams.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { TeamProfile } from "../shared/api";

const h = vi.hoisted(() => ({ user: null as AccountUser | null, providers: { email: true, google: false } as object | null }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: h.providers, refreshUser: async () => {}, state: {} }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: MyTeamsPage } = await import("./MyTeamsPage");
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
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = () => render(<MemoryRouter initialEntries={["/my-teams"]}><MyTeamsPage /></MemoryRouter>);

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
