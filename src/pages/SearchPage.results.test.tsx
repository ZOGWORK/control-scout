// @vitest-environment jsdom
// The /search page's results: a Compare is its own card above the teams (never counted as one), team cards carry
// their season numbers, events are blocks with date and status, no card shows a web address, the filters narrow
// the results in the address and clear back to all of them, and nothing found is never a bare dead end.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit, TeamSummary } from "../shared/api";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: false, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025 }));
const summaries: TeamSummary[] = [
  { team: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ", opr: 101.4, oprRank: 120, of: 8308, rating: null, ratingSd: null, record: "12-3-0", lastEvent: null, nextEvent: null },
  { team: 23268, name: "Ultraviolet", place: "Hackettstown, NJ", opr: null, oprRank: null, of: null, rating: null, ratingSd: null, record: null, lastEvent: null, nextEvent: null },
];
const paths = vi.hoisted(() => [] as (string | null)[]);
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: (p: string | null) => { paths.push(p); return { data: p ? { teams: summaries } : undefined, error: null, loading: false }; } }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
// The Shortlist a phone's team card adds to (the team page's own list): a plain set here.
const shortlisted = vi.hoisted(() => new Set<number>());
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()),
  useTeamFlags: (n: number) => ({ bookmarked: shortlisted.has(n), toggleBookmark: () => { if (shortlisted.has(n)) shortlisted.delete(n); else shortlisted.add(n); } }) }));

const { default: SearchPage } = await import("./SearchPage");

const team = (n: number, name: string, place: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} ${name}`, subtitle: place, season: 2025 });
const ev = (code: string, name: string, start: string, season = 2025): SearchHit => ({ kind: "event", ref: `${season}:${code}`, title: name, subtitle: `${code} · ${start} · Oradell, NJ, USA`, season });
const answer = (hits: SearchHit[], extra: Partial<SearchAnswer> = {}): SearchAnswer => ({ q: "x", hits, pages: [], step: "deterministic", weak: false, ...extra });

let loc = "";
function Where() { const l = useLocation(); loc = `${l.pathname}${l.search}`; return null; }
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><SearchPage /><Where /></MemoryRouter>);
afterEach(() => { cleanup(); state.answer = undefined; });

describe("search results page", () => {
  it("puts a Compare in its own section above the teams, not counted as a team", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "Compare side by side", season: 2025, href: "/compare?teams=4215,23268" };
    state.answer = answer([compare, team(23268, "Ultraviolet", "Hackettstown, NJ, USA"), team(4215, "Hypnotic Robotics", "Oradell, NJ, USA")]);
    const { container } = show("/search?q=ultraviolet%20vs%20hypnotic%20history");
    const cmp = container.querySelector('[data-section="compare"]')!;
    const teams = container.querySelector('[data-section="team"]')!;
    expect(cmp.compareDocumentPosition(teams) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(teams.querySelectorAll('[data-result="team"]')).toHaveLength(2);
    expect(within(teams as HTMLElement).getByText("2")).toBeTruthy();
    const card = within(cmp as HTMLElement).getByRole("link");
    expect(card.getAttribute("href")).toBe("/compare?teams=4215,23268");
    expect(card.textContent).toContain("Hypnotic Robotics (4215)");
    expect(card.textContent).toContain("Ultraviolet (23268)");
    expect(card.textContent).toContain("Hackettstown, NJ");
    expect(card.textContent).toContain("View comparison");
    // The head-to-head preview links to the full comparison.
    expect(screen.getByRole("link", { name: /View full comparison/ }).getAttribute("href")).toBe("/compare?teams=4215,23268");
  });

  it("shows team badges only from real numbers, and no card shows a web address or nests a control", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ, USA"), team(23268, "Ultraviolet", "Hackettstown, NJ, USA"), ev("USNJNEM6", "P2-8 Northeast League Meet", "2026-12-13")]);
    const { container } = show("/search?q=x");
    const [hyp, uv] = [...container.querySelectorAll('[data-result="team"]')];
    expect(hyp.textContent).toContain("12-3-0");
    expect(hyp.textContent).toContain("101.4");
    expect(hyp.textContent).toContain("#120 of 8,308");
    expect(uv.querySelector("[data-badges]")).toBeNull();
    expect(container.textContent).not.toContain("controlscout.org");
    for (const a of container.querySelectorAll("a")) expect(a.querySelector("a, button")).toBeNull();
  });

  it("a team asked for in a named season shows that season's numbers, never another's", () => {
    state.answer = answer([{ ...team(4215, "Hypnotic Robotics", "Oradell, NJ"), linkSeason: 2024 }]);
    paths.length = 0;
    const { container } = show("/search?q=4215%202024-25");
    expect(paths.filter(Boolean).every((p) => p!.includes("season=2024"))).toBe(true);
    expect(container.querySelector('[data-result="team"]')!.textContent).toContain("2024–25");
  });

  it("shows each event as a block with its date and status", () => {
    state.answer = answer([ev("USNJNEM6", "P2-8 Northeast League Meet", "2099-12-13"), ev("USNJQ1", "Old Meet", "2020-01-11", 2019)]);
    const { container } = show("/search?q=x");
    const [up, past] = [...container.querySelectorAll('[data-result="event"]')];
    expect(up.textContent).toContain("Upcoming");
    expect(up.textContent).toMatch(/Dec 13/);
    expect(past.textContent).toContain("Finished");
  });

  it("filters narrow the events in the address, and clearing returns all of them", () => {
    state.answer = answer([ev("A", "Next Meet", "2099-11-17"), ev("B", "Old Meet", "2020-01-11", 2019), ev("C", "Later Meet", "2099-12-01")]);
    const { container } = show("/search?q=meets%20in%20nj");
    const titles = () => [...container.querySelectorAll('[data-result="event"]')].map((e) => e.querySelector("a.line-clamp-2")?.textContent);
    expect(titles()).toEqual(["Next Meet", "Old Meet", "Later Meet"]);
    fireEvent.click(screen.getByRole("radio", { name: "Upcoming" }));
    expect(loc).toBe("/search?q=meets+in+nj&when=upcoming");
    expect(titles()).toEqual(["Next Meet", "Later Meet"]);
    fireEvent.click(screen.getByRole("radio", { name: "Past" }));
    expect(titles()).toEqual(["Old Meet"]);
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(loc).toBe("/search?q=meets+in+nj");
    expect(titles()).toEqual(["Next Meet", "Old Meet", "Later Meet"]);
  });

  it("keeps the filters from the address", () => {
    state.answer = answer([ev("A", "Next Meet", "2099-11-17"), ev("B", "Old Meet", "2020-01-11", 2019)]);
    const { container } = show("/search?q=x&when=past");
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(1);
  });

  it("splits exact team matches from ones that only share a word", () => {
    const fuzzy = (h: SearchHit) => ({ ...h, match: "fuzzy" as const, matched: ["good"] });
    state.answer = answer([team(18061, "Simply Complex", "Plainsboro, NJ"), fuzzy(team(7100, "Good Enough", "X")), fuzzy(team(16215, "Goodfellas", "Y"))]);
    const { container } = show("/search?q=x");
    expect(container.querySelector('[data-section="top"]')!.querySelectorAll('[data-result="team"]')).toHaveLength(1);
    const other = container.querySelector('[data-section="fuzzy"]') as HTMLElement;
    expect(other.textContent).toContain("Other teams matching “good”");
    expect(other.querySelectorAll('[data-result="team"]')).toHaveLength(2);
  });

  it("a query that names a site page is answered, not a dead end", () => {
    state.answer = answer([], { pages: [{ title: "Rules", href: "/rules" }] });
    const { container } = show("/search?q=rules");
    expect(screen.getByRole("link", { name: /Rules/ }).getAttribute("href")).toBe("/rules");
    expect(container.querySelector("[data-no-results]")).toBeNull();
  });

  it("previews the season a Compare asks for", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "", season: 2024, href: "/compare?teams=4215,23268&season=2024" };
    state.answer = answer([compare]);
    paths.length = 0;
    show("/search?q=x");
    expect(paths.filter(Boolean).every((p) => p!.includes("season=2024"))).toBe(true);
    expect(screen.getByText("2024–25 record")).toBeTruthy();
  });

  it("shows the numbers a row was asked for", () => {
    state.answer = answer([{ kind: "place", ref: "USA:NJ", title: "4215 in New Jersey", subtitle: "", season: 2025, facts: [{ label: "Region rank", value: "#3 of 120" }] }]);
    show("/search?q=x");
    expect(screen.getByText("#3 of 120")).toBeTruthy();
  });

  it("offers the season filter for matches from several seasons", () => {
    const m = (season: number): SearchHit => ({ kind: "match", ref: `${season}:X:qual:0:1`, title: `Q1 · X ${season}`, subtitle: "", season });
    state.answer = answer([m(2024), m(2025)]);
    show("/search?q=x");
    expect(screen.getByRole("combobox", { name: "Season" })).toBeTruthy();
  });

  it("never dead-ends: says what search covers, what was understood, labeled closest matches and places to go", () => {
    state.answer = answer([], { step: "recovery", recovery: { understood: ["Events in New Jersey", "at Nonexistent High School"], closest: [team(4215, "Hypnotic Robotics", "Oradell, NJ")], browse: [] } });
    const { container } = show("/search?q=meets%20at%20Nonexistent%20High%20School%20in%20New%20Jersey");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No matches for “meets at Nonexistent High School in New Jersey”");
    expect(container.textContent).toContain("FTC One Search covers teams, events, matches and places");
    expect(container.querySelector("[data-understood]")!.textContent).toContain("Events in New Jersey");
    expect(screen.getByRole("region", { name: "Closest matches" }).textContent).toContain("not an exact match");
    expect(screen.getByRole("link", { name: /Browse all events/ }).getAttribute("href")).toBe("/events");
    expect(container.querySelectorAll("[data-example]").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/Here's what we found/);
  });

  it("shows the server's fallback under its own label, never as the answer", () => {
    state.answer = { ...answer([ev("USNJNEM6", "P2-8 Northeast League Meet", "2099-12-13")]), understood: { label: "League meets in New Jersey at River Dell High School", fallback: "No league meets at River Dell High School in New Jersey — showing all league meets in New Jersey instead" } } as SearchAnswer;
    const { container } = show("/search?q=x");
    expect(container.querySelector("[data-fallback-label]")!.textContent).toContain("showing all league meets in New Jersey instead");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("River Dell High School");
    expect(container.querySelector("[data-context-badge]")).toBeNull();
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(1);
  });

  it("names the interpreted query, not a result, when the server reads it", () => {
    state.answer = { ...answer([ev("A", "P1-1 Southern League Meet", "2099-11-17")]), understood: { label: "Events in New Jersey" } } as SearchAnswer;
    const { container } = show("/search?q=meets%20in%20new%20jersey");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Events in New Jersey");
    // The reading is the title; a badge saying the same again is left out.
    expect(container.querySelector("[data-context-badge]")).toBeNull();
    expect(container.textContent).not.toContain("Southern League Meet”");
  });

  it("a Compare names its sides as the server does (kind compare, compare.teams)", () => {
    state.answer = answer([{ kind: "compare" as SearchHit["kind"], ref: "4215,23268", title: "4215 | Hypnotic Robotics vs 23268 | Ultraviolet", subtitle: "", season: 2025, href: "/compare?teams=4215,23268",
      compare: { teams: [{ number: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ" }, { number: 23268, name: "Ultraviolet", place: "Hackettstown, NJ" }] } } as SearchHit]);
    const { container } = show("/search?q=x");
    const card = container.querySelector('[data-result="compare"]')!;
    expect(card.textContent).toContain("Hypnotic Robotics (4215)vsUltraviolet (23268)");
    expect(card.textContent).toContain("23268: Hackettstown, NJ");
  });

  it("titles the page by what was found, with no badge that repeats it and no second search box", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 6980 Bad Wolf", subtitle: "", season: 2025, href: "/compare?teams=4215,6980" };
    state.answer = answer([compare, team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
    const { container } = show("/search?q=4215%20vs%206980%20history");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hypnotic Robotics (4215) vs Bad Wolf (6980)");
    expect(container.querySelector("[data-eyebrow]")!.textContent).toBe("FTC One Search");
    expect(container.querySelectorAll("[data-context-badge]")).toHaveLength(0);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("4215 vs 6980 history");
  });

  it("titles a question's answer by its team and what was asked", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, lines: [], count: 5 } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team 7149 — Worlds Appearances");
    expect(container.querySelector("[data-context-badge]")!.textContent).toBe("ENFORCERS (7149) · Worlds appearances");
  });
});

describe("search results page, Phase 2 cards", () => {
  const worlds = (season: string, div: string, rank: number, opr: number) => ({
    text: `FIRST Championship - Houston - World Championship - FIRST Tech Challenge - ${div} Division`,
    detail: `${season} · Apr 19–23, 2022 · Houston, TX`, results: [`Ranked #${rank}`, "4-4-0 in quals", `OPR ${opr.toFixed(1)}`], href: `/events/${season.slice(0, 4)}/X?team=7149`,
  });

  it("a championship question's records: stats, a timeline whose nodes jump to their cards, short titles and pills", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 2, lines: [worlds("2021–22", "Franklin", 20, 124.8), worlds("2022–23", "Ochoa", 3, 114.8)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    expect(container.querySelector("[data-stat-banner]")!.textContent).toContain("Best division rank#3");
    const card = container.querySelector('[data-appearance="2021"]') as HTMLElement;
    expect(card.textContent).toContain("Franklin Division");
    expect(card.textContent).not.toContain("FIRST Tech Challenge");
    expect(card.querySelector("[data-pills]")!.textContent).toBe("Rank#20Record4–4–0OPR124.8");
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    fireEvent.click(container.querySelector('[data-node="2022"]')!);
    const target = container.querySelector('[data-appearance="2022"]') as HTMLElement;
    expect(scrolled).toEqual([target]);
    expect(target.dataset.highlight).toBe("on");
  });

  it("event cards: one link over the card, quick links beside it (never inside), season tabs for a name held in several seasons", () => {
    state.answer = answer([ev("A", "Ohio State Championship", "2020-02-11", 2019), ev("B", "Ohio State Championship", "2021-02-11", 2020)]);
    const { container } = show("/search?q=x");
    const cards = container.querySelectorAll('[data-result="event"]');
    expect(cards).toHaveLength(1);
    for (const a of container.querySelectorAll("a")) expect(a.querySelector("a, button")).toBeNull();
    expect(within(cards[0] as HTMLElement).getByRole("link", { name: "Teams" }).getAttribute("href")).toBe("/events/2019/A?tab=teams");
    fireEvent.click(screen.getByRole("button", { name: "2020–21", pressed: false }));
    expect(within(cards[0] as HTMLElement).getByRole("link", { name: "Ohio State Championship" }).getAttribute("href")).toBe("/events/2020/B");
  });

  it("groups a championship division across years by its own name", () => {
    state.answer = answer([ev("A", "2024 FIRST Championship - Edison Division", "2024-04-17", 2023), ev("B", "FIRST Championship - FIRST Tech Challenge - Edison Division", "2025-04-16", 2024)]);
    const { container } = show("/search?q=edison%20division");
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(1);
    expect([...container.querySelectorAll("[data-season-tabs] button")].map((t) => t.textContent)).toEqual(["2023–24", "2024–25"]);
  });

  it("how good is X: the team's standing once, as blocks, with a win rate", () => {
    summaries[0] = { ...summaries[0], team: 18061, name: "Simply Complex", record: "20-4-0", opr: 119.7, oprRank: 388, of: 8308 };
    state.answer = answer([{ ...team(18061, "Simply Complex", "Plainsboro, NJ"), facts: [{ label: "OPR", value: "119.7" }, { label: "Record", value: "20-4-0" }] }]);
    const { container } = show("/search?q=how%20good%20is%20simply%20complex");
    const banner = container.querySelector("[data-quality-banner]")!.textContent!;
    expect(banner).toContain("Top 4.7%");
    expect(banner).toContain("Elite");
    expect(banner).toContain("83.3%");
    expect(banner.match(/20-4-0/g)).toHaveLength(1);
    const card = container.querySelector('[data-result="team"]')!.textContent!;
    expect(card).toContain("18061 | Simply Complex");
    expect(card).not.toContain("20-4-0");
    expect(card).not.toContain("119.7");
    const links = [...container.querySelectorAll("[data-team-links] a")].map((l) => l.getAttribute("href"));
    expect(links.some((l) => /^\/teams\/18061\?season=\d{4}#matches$/.test(l!))).toBe(true);
    expect(links.some((l) => l!.includes("#awards"))).toBe(false);
  });

  it("how good is X at an event: the card keeps its event facts", () => {
    summaries[0] = { ...summaries[0], team: 18061, name: "Simply Complex", record: "20-4-0", opr: 119.7, oprRank: 388, of: 8308 };
    state.answer = answer([{ ...team(18061, "Simply Complex", "Plainsboro, NJ"), atEvent: "2025:USNJCMP", facts: [{ label: "Event OPR", value: "131.2" }, { label: "Rank", value: "#2" }] }]);
    const { container } = show("/search?q=how%20good%20is%20simply%20complex%20at%20nj%20championship");
    expect(container.querySelector('[data-result="team"]')!.textContent).toContain("131.2");
  });

  it("how good is X with no numbers: no empty summary, the card keeps its line", () => {
    summaries[0] = { ...summaries[0], team: 18061, name: "Simply Complex", record: null, opr: null, oprRank: null, of: null };
    state.answer = answer([team(18061, "Simply Complex", "Plainsboro, NJ")]);
    const { container } = show("/search?q=how%20good%20is%20simply%20complex");
    expect(container.querySelector("[data-quality-banner]")).toBeNull();
    expect(container.textContent).not.toContain("Counted from the records below");
  });
});

describe("search results page, Phase 3 layout", () => {
  it("one right-hand panel: a versus query's head-to-head", () => {
    state.answer = answer([{ kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "", season: 2025, href: "/compare?teams=4215,23268" }]);
    const { container } = show("/search?q=x");
    expect(container.querySelector("[data-layout]")!.getAttribute("data-layout")).toBe("versus");
    expect(container.querySelectorAll("[data-panel]")).toHaveLength(1);
  });

  it("a question's summary takes the panel, before the records in the page (first on a phone), with the team's pages", () => {
    state.answer = answer([], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 2, lines: [
      { text: "A - Franklin Division", detail: "2021–22 · Apr 2022 · Houston, TX", results: ["Ranked #20"] },
      { text: "A - Ochoa Division", detail: "2022–23 · Apr 2023 · Houston, TX", results: ["Ranked #3"] },
    ] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    const panel = container.querySelector('[data-panel="summary"]')!;
    expect(panel.querySelector("[data-stat-banner]")).toBeTruthy();
    expect(panel.compareDocumentPosition(container.querySelector('[data-section="records"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel as HTMLElement).getByRole("link", { name: /Scouting profile/ }).getAttribute("href")).toBe("/teams/7149");
  });

  it("plain results: one column", () => {
    state.answer = answer([ev("A", "Next Meet", "2099-11-17")]);
    const { container } = show("/search?q=x");
    expect(container.querySelector("[data-layout]")!.getAttribute("data-layout")).toBe("single");
    expect(container.querySelector("[data-panel]")).toBeNull();
  });
});

describe("search results page, phone (Part B 3b)", () => {
  // A phone-width screen: every (max-width) query matches.
  const real = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = real; });
  const worlds = (season: string, div: string, rank: number, opr: number) => ({
    text: `FIRST Championship - Houston - World Championship - FIRST Tech Challenge - ${div} Division`,
    detail: `${season} · Apr 19–23, 2022 · Houston, TX`, results: [`Ranked #${rank}`, "4-4-0 in quals", `OPR ${opr.toFixed(1)}`], href: `/events/${season.slice(0, 4)}/X?team=7149`,
  });

  it("a search bar holding the query with a clear button, and a short Results header", () => {
    state.answer = answer([team(18061, "Simply Complex", "Plainsboro, NJ")]);
    const { container } = show("/search?q=how%20good%20is%20simply%20complex");
    const bar = container.querySelector("[data-phone-search]")!;
    expect(bar.textContent).toContain("how good is simply complex");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Results: Simply Complex (18061)");
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(loc).toBe("/search");
  });

  it("every season as a chip, and each team card a VS Compare of its own", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 3,
      lines: [worlds("2021–22", "Franklin", 20, 124.8), worlds("2022–23", "Ochoa", 3, 114.8), worlds("2023–24", "Franklin", 10, 127.2)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    expect([...container.querySelectorAll("[data-timeline-chips] button")].map((b) => b.textContent)).toEqual(["2021–22: #20", "2022–23: #3", "2023–24: #10"]);
    expect(container.querySelector("[data-vs-compare]")!.getAttribute("href")).toBe("/compare?teams=7149");
  });

  it("one trip is still a chip, and VS Compare keeps the season the result is about", () => {
    state.answer = answer([{ ...team(7149, "ENFORCERS", "X"), linkSeason: 2024 }], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 1, lines: [worlds("2022–23", "Ochoa", 3, 114.8)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    expect([...container.querySelectorAll("[data-timeline-chips] button")].map((b) => b.textContent)).toEqual(["2022–23: #3"]);
    expect(container.querySelector("[data-vs-compare]")!.getAttribute("href")).toBe("/compare?teams=7149&season=2024");
  });

  it("Shortlist and Matches are buttons on the card, and a swipe does the same", () => {
    shortlisted.clear();
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
    const { container } = show("/search?q=4215");
    const add = screen.getByRole("button", { name: "Shortlist" });
    expect(add.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(add);
    expect(shortlisted.has(4215)).toBe(true);
    shortlisted.clear();
    // Swipe right: the same Shortlist add.
    const card = container.querySelector("[data-swipe]")!;
    fireEvent.touchStart(card, { touches: [{ clientX: 20, clientY: 100 }] });
    fireEvent.touchMove(card, { touches: [{ clientX: 140, clientY: 104 }] });
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 140, clientY: 104 }] });
    expect(shortlisted.has(4215)).toBe(true);
    // A mostly-vertical drag is a scroll, not a swipe.
    fireEvent.touchStart(card, { touches: [{ clientX: 20, clientY: 100 }] });
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 110, clientY: 300 }] });
    expect(shortlisted.has(4215)).toBe(true);
  });
});
