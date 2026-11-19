// @vitest-environment jsdom
// The v8 sample Home: a scouting dashboard in the new look. No top bar and no headline: the inbox and your profile
// picture (a guest one signed out) top-right, search first and alone, three fixed examples as chips, then three cards in
// order (Events live now, Top teams, Your teams), Report a bug as a corner circle, mint as the page's only accent
// (scoped to the page), no yellow anywhere, and honest empty states.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventListItem, MatchView } from "../shared/api";
import type { RecordsResponse, TeamSeasonRecord } from "../shared/statCatalog";
import { HOME_SUGGESTIONS } from "../shared/homeSuggestions";
import { isBareRoute, pageModule, pageTitle } from "../shared/routes";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const indexCss = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

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
// The bell and the bug report are the app's own (tested with the app's top bar); here they only need to be there.
vi.mock("../components/layout/BugReport", () => ({ BugReportButton: ({ corner }: { corner?: boolean }) => <button type="button" data-tool="bug" data-corner={corner ? "" : undefined}>Report a bug</button> }));
// The sidebar's pages are the app's own (tested with the app's sidebar); here a stand-in that says whether it's folded.
vi.mock("../components/layout/Shell", () => ({ MainNav: ({ collapsed }: { collapsed?: boolean }) => <div data-main-nav={collapsed ? "rail" : "full"}><a href="/events">Events</a></div> }));
vi.mock("../components/layout/InboxBell", () => ({ InboxBell: () => <button type="button" data-tool="inbox">Inbox</button> }));

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

const { default: PreviewHomePage, rotatedExamples, liveNow, nextUp, yourTeams, EXAMPLE_COUNT, LIVE_MAX, TOP_MAX, TEAMS_MAX, MINT } = await import("./PreviewHomePage");
const { TooltipProvider } = await import("../components/ui/overlay");
// The app's Shell gives every page a TooltipProvider (the folded sidebar's names are tooltips).
const mount = () => render(<TooltipProvider><MemoryRouter initialEntries={["/preview/home"]}><PreviewHomePage /></MemoryRouter></TooltipProvider>);
const cls = (el: Element) => el.getAttribute("class") ?? "";

beforeEach(() => { data = {}; personal = { user: null, state: st(null) }; localStorage.clear(); });
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

  it("has no headline and starts with the search field, then four chips, a fresh set each visit", () => {
    const { container } = mount();
    expect(container.querySelector("h1")).toBeNull();
    const field = screen.getByLabelText("Search teams, events and matches");
    expect(container.querySelector("input")).toBe(field);
    expect(field.getAttribute("placeholder")).toBe("Search teams, events, matches…");
    // A fresh set each visit, from the live Home's rotation: four, the leaderboard first, no two of one family, no team's own.
    for (const hour of [0, 1, 2, 77, 4321]) {
      const ex = rotatedExamples(hour);
      expect(ex).toHaveLength(EXAMPLE_COUNT);
      expect(ex[0].kind).toBe("leaderboard");
      expect(new Set(ex.map((s) => s.kind)).size).toBe(EXAMPLE_COUNT);
      for (const s of ex) { expect(HOME_SUGGESTIONS).toContain(s); expect(s.mine).toBeUndefined(); }
    }
    expect(rotatedExamples(5)).toEqual(rotatedExamples(5));
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((h) => rotatedExamples(h).map((s) => s.q).join("|"))).size).toBeGreaterThan(1);
    expect(container.querySelectorAll("[data-example-chip]")).toHaveLength(EXAMPLE_COUNT);
    expect(EXAMPLE_COUNT).toBe(4);
    expect(container.querySelector("[aria-label*='by country']")).toBeNull(); // no globe
  });

  it("has no top bar: the inbox and a guest picture top-right, the mark above search, Report a bug in the corner", () => {
    const { container } = mount();
    expect(container.querySelector("[data-top-nav]")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    const corner = container.querySelector("[data-corner-tools]") as HTMLElement;
    expect([...corner.children].map((c) => c.getAttribute("data-tool") ?? (c.hasAttribute("data-profile") ? "profile" : "?"))).toEqual(["inbox", "profile"]);
    const profile = within(corner).getByRole("button", { name: "Sign in" });
    expect(profile.querySelector("[data-guest]")).toBeTruthy();
    // The white mark sits above the search field, on every screen.
    const mark = container.querySelector("[data-mark]")!;
    expect(mark.getAttribute("src")).toBe("/mark-white.webp");
    expect(cls(mark)).not.toContain("hidden");
    expect(mark.compareDocumentPosition(container.querySelector("input")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One bug report, a corner circle, apart from the corner tools.
    const bugs = container.querySelectorAll("[data-tool='bug']");
    expect(bugs).toHaveLength(1);
    expect(bugs[0].hasAttribute("data-corner")).toBe(true);
    expect(corner.contains(bugs[0])).toBe(false);
    // No clock and no theme switch on this page.
    expect(container.querySelector("[data-tool='theme'], [data-clock], time")).toBeNull();
  });

  it("shows your profile picture top-right when signed in", () => {
    personal = { user: { displayName: "Ada Lovelace", email: "ada@example.test", avatarUrl: "https://example.test/a.png" }, state: st(null) };
    const { container } = mount();
    const profile = within(container.querySelector("[data-corner-tools]") as HTMLElement).getByRole("button", { name: "Account: Ada Lovelace" });
    expect(profile.querySelector("[data-guest]")).toBeNull();
    expect(profile.querySelector("[data-user-avatar='picture']")).toBeTruthy();
  });

  it("has the app's pages in a sidebar with nothing at its foot, folding to icons", () => {
    const { container } = mount();
    const side = container.querySelector("[data-sample-sidebar]") as HTMLElement;
    expect(side.querySelector("[data-main-nav='full']")).toBeTruthy();
    expect(within(side).getByRole("link", { name: "Control Scout home" })).toBeTruthy();
    // No search button (the page's search is the way in) and no foot: no What's new, owner console, account or sign-out.
    expect(within(side).queryByRole("button", { name: /search/i })).toBeNull();
    expect(side.textContent).not.toMatch(/What.s new|Owner console|Sign (in|out)|Settings/);
    fireEvent.click(within(side).getByRole("button", { name: "Collapse sidebar" }));
    expect(side.hasAttribute("data-rail")).toBe(true);
    expect(side.querySelector("[data-main-nav='rail']")).toBeTruthy();
    expect(within(side).queryByRole("link", { name: "Control Scout home" })).toBeNull();
    fireEvent.click(within(side).getByRole("button", { name: "Expand sidebar" }));
    expect(side.hasAttribute("data-rail")).toBe(false);
    // Folding and opening keep the keyboard on the same button.
    const button = within(side).getByRole("button", { name: "Collapse sidebar" });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(within(side).getByRole("button", { name: "Expand sidebar" }));
    expect(document.activeElement).toBe(button);
  });

  it("puts settings, what's new, the owner console and sign out in the profile menu", () => {
    personal = { user: { displayName: "Ada Lovelace", email: "ada@example.test", avatarUrl: null, isOwner: true }, state: st(null) };
    const { container } = mount();
    const trigger = within(container.querySelector("[data-corner-tools]") as HTMLElement).getByRole("button", { name: "Account: Ada Lovelace" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const menu = document.querySelector("[data-profile-menu]") as HTMLElement;
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Settings", "What’s new", "Owner console", "Sign out"]);
    expect(menu.textContent).toContain("ada@example.test");
  });

  it("keeps the owner console out of anyone else's menu, and offers a guest Sign in", () => {
    const { container } = mount();
    fireEvent.pointerDown(within(container.querySelector("[data-corner-tools]") as HTMLElement).getByRole("button", { name: "Sign in" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    const menu = document.querySelector("[data-profile-menu]") as HTMLElement;
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Sign in", "Settings", "What’s new"]);
  });

  it("grows the whole page on big screens, in steps, by the root size (so it multiplies the text-size setting)", () => {
    const steps = [...indexCss.matchAll(/min-width: (\d+)px\) \{ html:has\(\[data-sample-home\]\) \{ --ui-base: ([\d.]+); \}/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(steps).toEqual([[2100, 1.1], [2500, 1.23]]);
    const { container } = mount();
    expect(container.querySelector("[data-sample-home]")).toBeTruthy();
    expect(container.innerHTML).not.toContain("zoom");
  });

  it("washes the top a third of the way down, smooth glows under a fine grain", () => {
    const { container } = mount();
    const wash = container.querySelector("[data-wash]") as HTMLElement;
    expect(cls(wash)).toMatch(/h-\[34vh\]/);
    expect(cls(wash.querySelector("[data-grain]")!)).toContain("opacity-[0.12]");
    expect(wash.innerHTML).not.toMatch(/type="discrete"/); // not the shutdown page's chalky grain
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

  it("falls back to last season's leaders, labelled, before anyone has a record this season", () => {
    data = { "/api/records/2026/teams": { ...TOP, rows: [] }, "/api/records/2025/teams": { ...TOP, season: 2025 } };
    const { container } = mount();
    expect(container.querySelectorAll("[data-top-team]")).toHaveLength(TOP_MAX);
    expect(container.querySelector("[data-top-season]")?.textContent).toMatch(/^Last season, 2025/);
  });

  it("tags a live event with no results yet instead of cutting its place short", () => {
    data = { "/api/events": { events: [event(1, "live", 0, 0)] } };
    const { container } = mount();
    const row = container.querySelector("[data-live-event]")!;
    expect(row.textContent).toContain("Town, NJ");
    expect(row.querySelector("[data-no-results]")?.textContent).toBe("No results yet");
  });

  it("asks you to pick a team when none is set, with a quiet pill", () => {
    const { container } = mount();
    const pick = container.querySelector("[data-pick-team]")!; // a quiet outlined pill, not a solid mint slab
    expect(cls(pick)).toContain("rounded-full");
    expect(cls(pick)).not.toContain("bg-accent");
    const team = container.querySelector("[data-card='team']")!;
    expect(team.textContent).toContain("Pick your team to see its next match");
    expect(within(team as HTMLElement).getByRole("button", { name: /Pick your team/ })).toBeTruthy();
  });

  it("lists your teams in the app's order, each once", () => {
    expect(yourTeams([7, 4215], 4215, [9, 7, 12])).toEqual([7, 4215, 9, 12]);
    expect(yourTeams([], null, [])).toEqual([]);
    expect(yourTeams([], 0, [-1])).toEqual([]);
  });

  it("shows one team big: its next match and chance to win, a quiet link, no button", () => {
    personal = { user: null, state: st(4215) };
    data = { "/api/teams/4215/matches": { matches: [MATCH] }, "/api/teams-summary": { teams: [{ team: 4215, name: "Team Name", place: "Town, NJ, USA", nextEvent: null }] } };
    const { container } = mount();
    const team = container.querySelector("[data-card='team']") as HTMLElement;
    expect(within(team).getByRole("heading").textContent).toMatch(/Your team$/);
    expect(team.textContent).toContain("4215");
    expect(team.textContent).toContain("Team Name");
    expect(team.querySelector("[data-team-call]")?.textContent).toBe("64%to win · fair");
    expect(team.querySelector("a[href='/events/2026/USNJQ1/match/qual%3A1%3A14']")?.textContent).toContain("Q14");
    expect(within(team).queryByRole("link", { name: /Predict/ })).toBeNull();
    expect(within(team).queryByRole("button")).toBeNull();
    expect(within(team).getByRole("link", { name: /Your team page/ }).getAttribute("href")).toBe("/my-team");
  });

  it("shows the team's last event and how it went when no schedule is posted", () => {
    personal = { user: null, state: st(4215) };
    const last = { code: "USNJNEM3", name: "P1-5 PM Northeast League Meet", start: "2026-11-07", end: "2026-11-07", rank: 7, record: "2-3-1" };
    data = { "/api/teams/4215/matches": { matches: [] }, "/api/teams-summary": { teams: [{ team: 4215, name: "Team Name", place: "Town, NJ, USA", opr: 16.02, oprRank: 2221, of: 3264, lastEvent: last, nextEvent: null }] } };
    const { container } = mount();
    const box = container.querySelector("[data-last-event]") as HTMLElement;
    expect(box.textContent).toContain("Last event");
    expect(within(box).getByRole("link", { name: /P1-5 PM Northeast League Meet/ }).getAttribute("href")).toBe("/events/2026/USNJNEM3");
    expect(box.querySelector("[data-stat='Rank']")?.textContent).toContain("7th");
    expect(box.querySelector("[data-stat='Record']")?.textContent).toContain("2-3-1");
    expect(box.querySelector("[data-stat='OPR']")?.textContent).toContain("16.0#2221 of 3264");
  });

  it("lists several teams as rows, at most four, each with its next match", () => {
    personal = { user: null, state: { ...st(null), tracked: { teams: [4215, 11, 12, 13, 14], events: [] } } as unknown as ReturnType<typeof st> };
    data = { "/api/teams/4215/matches": { matches: [MATCH] }, "/api/teams-summary": { teams: [] } };
    const { container } = mount();
    const team = container.querySelector("[data-card='team']") as HTMLElement;
    expect(within(team).getByRole("heading").textContent).toMatch(/Your teams$/);
    const rows = team.querySelectorAll("[data-your-team]");
    expect(rows).toHaveLength(TEAMS_MAX);
    expect(rows[0].querySelector("[data-team-next]")?.textContent).toContain("Next: Q14");
    expect(rows[0].querySelector("[data-team-call]")?.textContent).toContain("64%");
    expect(within(team).getByRole("link", { name: /All 5 teams/ }).getAttribute("href")).toBe("/my-teams");
  });

  it("uses mint as its only accent: scoped to the page, no solid button once a team is set, no yellow anywhere", () => {
    personal = { user: null, state: st(4215) };
    data = { "/api/events": { events: [event(1, "live", 10, 60)] }, "/api/records/2026/teams": TOP, "/api/teams/4215/matches": { matches: [MATCH] }, "/api/teams-summary": { teams: [] } };
    const { container } = mount();
    const root = container.querySelector("[data-theme-next]") as HTMLElement;
    expect(root.style.getPropertyValue("--color-accent")).toBe(MINT.accent);
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/#ffc700|#ffd633|#eab308|text-accent-text|text-yellow|bg-yellow/);
    const all = [...container.querySelectorAll("*")];
    // Mint fills: the live progress, nothing else.
    const fills = all.filter((el) => /(^|\s)bg-accent(\s|$)/.test(cls(el)));
    expect(fills.every((el) => ["data-progress"].some((a) => el.hasAttribute(a)))).toBe(true);
    // Live is red and pulses (motion-reduce stills it).
    const pulse = container.querySelector("[data-live-dot] [data-live-pulse]")!;
    expect(cls(pulse)).toContain("animate-ping");
    expect(cls(pulse)).toContain("motion-reduce:hidden");
    expect(container.querySelector("[data-live-event] svg")!.getAttribute("class")).toContain("text-[#f2555a]");
    expect(container.querySelector("[data-pick-team]")).toBeNull();
    // Text in mint: only the #1 rank (and icons).
    const mintText = all.filter((el) => /(^|\s)text-accent(\s|$)/.test(cls(el)));
    expect(mintText.every((el) => el.hasAttribute("data-rank") || el.tagName.toLowerCase() === "svg")).toBe(true);
  });
});
