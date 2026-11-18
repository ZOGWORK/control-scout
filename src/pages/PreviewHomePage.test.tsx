// @vitest-environment jsdom
// The v8 sample Home, third round: a scouting dashboard in the new look. No headline, search first and alone, three
// fixed examples as chips, then three cards in order (Events live now, Top teams, Your team), mint as the page's only
// accent (scoped to the page), no yellow anywhere, and honest empty states.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventListItem, MatchView } from "../shared/api";
import type { RecordsResponse, TeamSeasonRecord } from "../shared/statCatalog";
import { HOME_SUGGESTIONS } from "../shared/homeSuggestions";
import { isBareRoute, pageModule, pageTitle } from "../shared/routes";

let data: Record<string, unknown> = {};
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    const key = path ? Object.keys(data).find((k) => path.startsWith(k)) : undefined;
    return { data: key ? data[key] : undefined, error: undefined, loading: !key, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMediaQuery: () => false, useMeta: () => null }));
const st = (myTeam: number | null) => ({ myTeam, tracked: { teams: [], events: [] }, bookmarks: [] });
let personal: { user: unknown; state: ReturnType<typeof st> } = { user: null, state: st(null) };
vi.mock("../lib/personal", () => ({ usePersonal: () => personal, hasAccountOnDevice: () => false }));

const event = (i: number, status: EventListItem["status"], played = 0, total = 0, start = "2026-11-18"): EventListItem => ({
  season: 2026, code: `USXXQ${i}`, name: `Event ${i}`, type: "Qualifier", typeLabel: "Qualifier", city: "Town", state: "NJ", country: "USA",
  start, end: start, teams: 20, matchesPlayed: played, matchesTotal: total, status,
} as EventListItem);
const top = (team: number, opr: number): TeamSeasonRecord => ({ season: 2026, team, stats: { teamName: `Team ${team} name`, homeRegion: "USNJ", wins: 9, losses: 2, ties: 1, totalPointsOpr: opr } });
const TOP: RecordsResponse<TeamSeasonRecord> = { season: 2026, scope: "teamSeason", filter: null, sort: "totalPointsOpr", dir: "desc", page: 1, pageSize: 5, total: 7, columns: [], rows: [10, 20, 30, 40, 50, 60, 70].map((t, i) => top(t, 200 - i * 10)) } as unknown as RecordsResponse<TeamSeasonRecord>;
const side = (teams: number[]) => ({ teams: teams.map((number) => ({ number })), score: null });
const MATCH = {
  season: 2026, code: "USNJQ1", key: "qual:1:14", level: "qual", series: 1, number: 14, label: "Q14", time: "2099-01-01T10:00:00", startsAt: null,
  played: false, red: side([4215, 1]), blue: side([2, 3]), video: null, prediction: { pRed: 0.64, tier: "moderate", kind: "live" },
} as unknown as MatchView;

const { default: PreviewHomePage, fixedExamples, liveNow, nextUp, EXAMPLE_COUNT, LIVE_MAX, TOP_MAX, MINT } = await import("./PreviewHomePage");
const mount = () => render(<MemoryRouter initialEntries={["/preview/home"]}><PreviewHomePage /></MemoryRouter>);
const cls = (el: Element) => el.getAttribute("class") ?? "";

beforeEach(() => { data = {}; personal = { user: null, state: st(null) }; });
afterEach(cleanup);

describe("Sample home dashboard", () => {
  it("is its own bare route, titled and kept apart from the real Home", () => {
    expect(pageModule("/preview/home")).toBe("PreviewHomePage");
    expect(pageModule("/")).toBeNull();
    expect(pageTitle("/preview/home")).toBe("Sample home");
    expect(isBareRoute("/preview/home")).toBe(true);
    expect(isBareRoute("/")).toBe(false);
    expect(isBareRoute("/events/2025/USNJQ1/display")).toBe(true);
  });

  it("has no headline and starts with the search field, then three fixed chips", () => {
    const { container } = mount();
    expect(container.querySelector("h1")).toBeNull();
    const field = screen.getByLabelText("Search teams, events and matches");
    expect(container.querySelector("input")).toBe(field);
    expect(field.getAttribute("placeholder")).toBe("Search teams, events, matches…");
    const ex = fixedExamples();
    expect(ex).toHaveLength(EXAMPLE_COUNT);
    for (const s of ex) { expect(HOME_SUGGESTIONS).toContain(s); expect(s.q).not.toMatch(/\b\d{3,5}\b/); }
    expect(container.querySelectorAll("[data-example-chip]")).toHaveLength(3);
    expect(container.querySelector("[aria-label*='by country']")).toBeNull(); // no globe
  });

  it("shows the three cards in order: live, top teams, your team", () => {
    const { container } = mount();
    expect([...container.querySelectorAll("[data-card]")].map((c) => c.getAttribute("data-card"))).toEqual(["live", "top", "team"]);
    expect(screen.getByRole("heading", { name: /Events live now/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Top teams/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Your team/ })).toBeTruthy();
  });

  it("lists at most four live events, most played first, with progress", () => {
    const evs = [event(1, "live", 10, 60), event(2, "live", 40, 60), event(3, "upcoming"), event(4, "live", 5, 50), event(5, "live", 30, 40), event(6, "live", 1, 30), event(7, "finished", 60, 60)];
    expect(liveNow(evs).map((e) => e.code)).toEqual(["USXXQ2", "USXXQ5", "USXXQ1", "USXXQ4"]);
    expect(LIVE_MAX).toBe(4);
    data = { "/api/events": { events: evs } };
    const { container } = mount();
    const rows = container.querySelectorAll("[data-live-event]");
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText("40/60 played")).toBeTruthy();
    expect((rows[0].querySelector("[data-progress]") as HTMLElement).style.width).toBe("67%");
    expect(screen.getByText("5 live")).toBeTruthy();
  });

  it("says nothing is live, and names the next event, when nothing is on", () => {
    const evs = [event(8, "upcoming", 0, 0, "2026-11-22"), event(9, "upcoming", 0, 0, "2026-11-21"), event(10, "finished")];
    expect(nextUp(evs)?.code).toBe("USXXQ9");
    data = { "/api/events": { events: evs } };
    const { container } = mount();
    expect(container.querySelector("[data-live-empty]")?.textContent).toContain("Nothing live right now.");
    expect(container.querySelector("[data-live-empty]")?.textContent).toContain("Event 9");
    expect(container.querySelectorAll("[data-live-event]")).toHaveLength(0);
  });

  it("lists the top five teams by OPR, with record, the first rank in mint", () => {
    data = { "/api/records/2026/teams": TOP };
    const { container } = mount();
    const rows = container.querySelectorAll("[data-top-team]");
    expect(rows).toHaveLength(TOP_MAX);
    expect(rows[0].textContent).toContain("10");
    expect(rows[0].textContent).toContain("Team 10 name");
    expect(rows[0].textContent).toContain("9-2-1");
    expect(rows[0].textContent).toContain("200.0");
    expect(cls(rows[0].querySelector("[data-rank]")!)).toContain("text-accent");
    expect(cls(rows[1].querySelector("[data-rank]")!)).not.toContain("text-accent");
  });

  it("asks you to pick a team when none is set, with the one mint button", () => {
    const { container } = mount();
    const team = container.querySelector("[data-card='team']")!;
    expect(team.textContent).toContain("Pick your team to see its next match");
    expect(within(team as HTMLElement).getByRole("button", { name: /Pick your team/ })).toBeTruthy();
  });

  it("shows your team's next match and its chance to win, with Predict this match", () => {
    personal = { user: null, state: st(4215) };
    data = { "/api/teams/4215/matches": { matches: [MATCH] }, "/api/teams-summary": { teams: [{ team: 4215, name: "Team Name", place: "Town, NJ, USA", nextEvent: null }] } };
    const { container } = mount();
    const team = container.querySelector("[data-card='team']") as HTMLElement;
    expect(team.textContent).toContain("4215");
    expect(team.textContent).toContain("Q14");
    expect(team.querySelector("[data-team-call]")?.textContent).toBe("64%to win · fair");
    expect(within(team).getByRole("link", { name: /Predict this match/ }).getAttribute("href")).toBe("/events/2026/USNJQ1/match/qual%3A1%3A14");
  });

  it("uses mint as its only accent: scoped to the page, one solid button, no yellow anywhere", () => {
    personal = { user: null, state: st(4215) };
    data = { "/api/events": { events: [event(1, "live", 10, 60)] }, "/api/records/2026/teams": TOP, "/api/teams/4215/matches": { matches: [MATCH] }, "/api/teams-summary": { teams: [] } };
    const { container } = mount();
    const root = container.querySelector("[data-theme-next]") as HTMLElement;
    expect(root.style.getPropertyValue("--color-accent")).toBe(MINT.accent);
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/#ffc700|#ffd633|#eab308|text-accent-text|text-yellow|bg-yellow/);
    const all = [...container.querySelectorAll("*")];
    // Mint fills: the one solid button, the live dot and the live progress, nothing else.
    const fills = all.filter((el) => /(^|\s)bg-accent(\s|$)/.test(cls(el)));
    expect(fills.filter((el) => el.hasAttribute("data-primary-action"))).toHaveLength(1);
    expect(fills.every((el) => ["data-primary-action", "data-live-dot", "data-progress"].some((a) => el.hasAttribute(a)))).toBe(true);
    expect(container.querySelectorAll("[data-primary-action]")).toHaveLength(1);
    // Text in mint: only the #1 rank and the live icon.
    const mintText = all.filter((el) => /(^|\s)text-accent(\s|$)/.test(cls(el)));
    expect(mintText.every((el) => el.hasAttribute("data-rank") || el.tagName.toLowerCase() === "svg")).toBe(true);
  });
});
