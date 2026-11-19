// @vitest-environment jsdom
// My teams in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "how are my teams doing?": each team's
// card header carries the answer (world standing, OPR, record, what's next), visible while folded; the states without
// teams are one quiet empty state, one primary and one outline action. With v8 off the page is drawn as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const user = (teams: { teamNumber: number | null; name: string }[]): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9, member: true, teams, url: "https://cp.test", workspaces: teams.map((t, i) => ({ id: String(i + 1), name: t.name, role: "admin" as const })) },
});
const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const profile = {
  team: { number: 18360, name: "Hypnotic Robotics" }, season: 2026, seasons: [2026],
  stats: { opr: { np: stat(101.6, 80), auto: stat(28.3, 883), teleop: stat(73.4, 644), endgame: stat(6.7, 5027), pen: -5 },
    rating: null, record: { wins: 26, losses: 6, ties: 0, matches: 32, events: 5 }, avg: { np: 90, score: 95, pen: 5 } },
  events: [{ season: 2026, code: "USCAQ1", name: "Bay Area Qualifier", type: "Qualifier", start: "2026-01-10", end: "2026-01-10", rank: 2, wins: 5, losses: 1, ties: 0, opr: { np: 99.5 }, awards: [] }],
  awardsAllTime: [],
} as unknown as TeamProfile;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  h.user = null; h.providers = { email: true, google: false };
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/teams/18360/matches")) return json({ matches: [] });
    if (path.startsWith("/api/teams/18360")) return json(profile);
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

const page = () => render(<TooltipProvider><MemoryRouter initialEntries={["/my-teams"]}><MyTeamsPage /></MemoryRouter></TooltipProvider>);

describe("My teams, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("each team's header answers the question, and still does once folded", async () => {
    h.user = user([{ teamNumber: 18360, name: "Hypnotic Robotics" }]);
    page();
    expect(document.querySelector("[data-myteams-v8]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("My teams");
    const card = within(await screen.findByRole("article", { name: "Team 18360" }));
    const glance = await waitFor(() => { const e = document.querySelector("[data-team-glance] [data-v8-figures]"); if (!e) throw new Error("not yet"); return e as HTMLElement; });
    expect(glance.textContent).toContain("Top 1%");
    expect(glance.textContent).toContain("101.6");
    expect(glance.textContent).toContain("26-6-0");
    expect(card.getByRole("link", { name: /Team page/ }).getAttribute("href")).toBe("/teams/18360?season=2026");
    fireEvent.click(card.getByRole("button", { name: /18360/ }));
    expect(card.getByRole("button", { name: /18360/ }).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-team-glance]")!.textContent).toContain("101.6");
  });

  it("signed out: one empty state with one primary and one outline action", () => {
    page();
    const empty = document.querySelector("[data-v8-empty]")!;
    expect(empty.textContent).toContain("Sign in to see your teams");
    const buttons = [...empty.querySelectorAll('[data-slot="button"]')];
    expect(buttons).toHaveLength(2);
    expect(buttons[1].className).toContain("v8:bg-transparent");
  });
});

describe("My teams, v8 off", () => {
  it("is drawn as before", async () => {
    h.user = user([{ teamNumber: 18360, name: "Hypnotic Robotics" }]);
    page();
    const card = within(await screen.findByRole("article", { name: "Team 18360" }));
    expect(card.getByRole("link", { name: /Full team page/ })).toBeTruthy();
    expect(document.querySelector("[data-myteams-v8]")).toBeNull();
  });
});
