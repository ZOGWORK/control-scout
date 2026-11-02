// @vitest-environment jsdom
// The /search page's results: a Compare is its own card above the teams (never counted as one), team cards carry
// their season numbers, events are blocks with date and status, no card shows a web address, the filters narrow
// the results in the address and clear back to all of them, and nothing found is never a bare dead end.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(within(teams as HTMLElement).getAllByRole("link")).toHaveLength(2);
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
    const titles = () => [...container.querySelectorAll('[data-result="event"]')].map((e) => e.querySelector("p.line-clamp-2")?.textContent);
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
    const fuzzy = (h: SearchHit) => ({ ...h, match: "fuzzy" as const });
    state.answer = { ...answer([team(18061, "Simply Complex", "Plainsboro, NJ"), fuzzy(team(7100, "Good Enough", "X")), fuzzy(team(16215, "Goodfellas", "Y"))]), fuzzyWord: "good" } as SearchAnswer;
    const { container } = show("/search?q=x");
    expect(within(container.querySelector('[data-section="top"]') as HTMLElement).getAllByRole("link")).toHaveLength(1);
    const other = container.querySelector('[data-section="fuzzy"]') as HTMLElement;
    expect(other.textContent).toContain("Other teams matching “good”");
    expect(within(other).getAllByRole("link")).toHaveLength(2);
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
    state.answer = { ...answer([], { step: "recovery", recovery: { understood: [], closest: [], browse: [] } }), interpreted: "Events in New Jersey at River Dell High School", fallback: { label: "No events at River Dell High School — showing all New Jersey events instead", hits: [ev("USNJNEM6", "P2-8 Northeast League Meet", "2099-12-13")] } } as SearchAnswer;
    const { container } = show("/search?q=x");
    expect(container.querySelector("[data-fallback-label]")!.textContent).toContain("showing all New Jersey events instead");
    expect(container.querySelector("[data-understood]")!.textContent).toContain("River Dell High School");
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(1);
  });

  it("names the interpreted query, not a result, when the server reads it", () => {
    state.answer = { ...answer([ev("A", "P1-1 Southern League Meet", "2099-11-17")]), interpreted: "Events in New Jersey" } as SearchAnswer;
    show("/search?q=meets%20in%20new%20jersey");
    expect(screen.getByText("Events in New Jersey")).toBeTruthy();
  });

  it("the magnifier is a submit button", () => {
    show("/search?q=4215");
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).type).toBe("submit");
  });
});
