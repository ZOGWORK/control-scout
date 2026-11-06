// @vitest-environment jsdom
// The /search page's results: a Compare is its own card above the teams (never counted as one), team cards carry
// their season numbers, events are blocks with date and status, no card shows a web address, the filters narrow
// the results in the address and clear back to all of them, and nothing found is never a bare dead end.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit, TeamSummary } from "../shared/api";
import type { StatAnswer } from "../shared/searchStat";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined, stale: false }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: false, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: state.stale, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025 }));
const summaries: TeamSummary[] = [
  { team: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ", opr: 101.4, oprRank: 120, of: 8308, rating: null, ratingSd: null, record: "12-3-0", lastEvent: null, nextEvent: null },
  { team: 23268, name: "Ultraviolet", place: "Hackettstown, NJ", opr: null, oprRank: null, of: null, rating: null, ratingSd: null, record: null, lastEvent: null, nextEvent: null },
];
const paths = vi.hoisted(() => [] as (string | null)[]);
// A team's matches (the phone's Matches sheet): one win and one loss, the loss last.
const side = (n: number, total: number) => ({ teams: [{ number: n, surrogate: false, dq: false, onField: true }], score: { total, np: total, auto: 0, teleop: 0, endgame: 0, pen: 0 } });
const teamMatches = { matches: [
  { season: 2025, code: "USNJQ1", key: "qual:0:3", level: "qual", series: 0, number: 3, label: "Q3", time: null, startsAt: null, played: true, red: side(4215, 120), blue: side(1, 90), video: null, prediction: null },
  { season: 2025, code: "USNJQ1", key: "qual:0:9", level: "qual", series: 0, number: 9, label: "Q9", time: null, startsAt: null, played: true, red: side(2, 150), blue: side(4215, 101), video: null, prediction: null },
] };
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: (p: string | null) => { paths.push(p); return { data: p?.includes("/matches") ? teamMatches : p ? { teams: summaries } : undefined, error: null, loading: false }; } }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
// The privacy choice: made (the Compare bar waits for it), unless a test says otherwise.
const consent = vi.hoisted(() => ({ decided: true }));
vi.mock("../lib/consent", async (orig) => ({ ...(await orig<typeof import("../lib/consent")>()), useConsent: () => ({ analytics: false, decided: consent.decided, signal: false, setAnalytics: () => {} }) }));
// The Shortlist a phone's team card adds to (the team page's own list): a set here, and a change re-renders the card.
const shortlisted = vi.hoisted(() => new Set<number>());
vi.mock("../lib/personal", async (orig) => {
  const { useState } = await import("react");
  return { ...(await orig<typeof import("../lib/personal")>()),
    useTeamFlags: (n: number) => {
      const [, bump] = useState(0);
      return { bookmarked: shortlisted.has(n), toggleBookmark: () => { if (shortlisted.has(n)) shortlisted.delete(n); else shortlisted.add(n); bump((x) => x + 1); } };
    } };
});

const { default: SearchPage } = await import("./SearchPage");

const team = (n: number, name: string, place: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} ${name}`, subtitle: place, season: 2025 });
const ev = (code: string, name: string, start: string, season = 2025): SearchHit => ({ kind: "event", ref: `${season}:${code}`, title: name, subtitle: `${code} · ${start} · Oradell, NJ, USA`, season });
const answer = (hits: SearchHit[], extra: Partial<SearchAnswer> = {}): SearchAnswer => ({ q: "x", hits, pages: [], step: "deterministic", weak: false, ...extra });

let loc = "";
function Where() { const l = useLocation(); loc = `${l.pathname}${l.search}`; return null; }
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><SearchPage /><Where /></MemoryRouter>);
afterEach(() => { cleanup(); state.answer = undefined; state.stale = false; });

describe("search results page", () => {
  it("puts a Compare in its own section above the teams, not counted as a team", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "Compare side by side", season: 2025, href: "/compare?teams=4215,23268" };
    state.answer = answer([compare, team(23268, "Ultraviolet", "Hackettstown, NJ, USA"), team(4215, "Hypnotic Robotics", "Oradell, NJ, USA"), team(6980, "Bad Wolf", "Oradell, NJ, USA")]);
    const { container } = show("/search?q=ultraviolet%20vs%20hypnotic%20history");
    const cmp = container.querySelector('[data-section="compare"]')!;
    const teams = container.querySelector('[data-section="team"]')!;
    expect(cmp.compareDocumentPosition(teams) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The Compare's two sides aren't listed again as team cards (no "Teams 2" under it), nor as a row of links.
    expect([...teams.querySelectorAll('[data-result="team"]')].map((c) => c.textContent)).toEqual([expect.stringContaining("6980 | Bad Wolf")]);
    expect(within(teams as HTMLElement).getByText("1")).toBeTruthy();
    expect(container.querySelector("[data-answer-teams]")).toBeNull();
    const card = within(cmp as HTMLElement).getByRole("link");
    expect(card.getAttribute("href")).toBe("/compare?teams=4215,23268");
    expect(card.textContent).toContain("4215Hypnotic Robotics");
    expect(card.textContent).toContain("23268Ultraviolet");
    expect(card.textContent).toContain("Hackettstown, NJ");
    expect(card.textContent).toContain("View comparison");
    // No gold box: the team page's plain card.
    expect(card.className).not.toMatch(/accent/);
    // The head-to-head preview links to the full comparison (beside it on desktop, under it on a phone).
    expect(screen.getAllByRole("link", { name: /View full comparison/ }).map((a) => a.getAttribute("href"))).toEqual(["/compare?teams=4215,23268", "/compare?teams=4215,23268"]);
  });

  it("a head-to-head answer names both teams in its card's header: neither gets a card of its own", () => {
    const stat = { family: "two-team", intent: "head-to-head", title: "Their meetings and partnerships", team: { number: 4215, name: "Hypnotic Robotics" }, teams: [{ number: 4215, name: "Hypnotic Robotics" }, { number: 6980, name: "Bad Wolf" }], scope: [], blocks: [], definition: "", source: "" };
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ, USA"), team(6980, "Bad Wolf", "Oradell, NJ, USA")], { stat } as Partial<SearchAnswer>);
    const { container } = show("/search?q=4215%20vs%206980%20head%20to%20head");
    expect(container.querySelector('[data-result="team"]')).toBeNull();
    const header = container.querySelector("[data-answer-frame] [data-answer-teams]")!;
    expect([...header.querySelectorAll("a")].map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([["Hypnotic Robotics (4215)", "/teams/4215"], ["Bad Wolf (6980)", "/teams/6980"]]);
  });

  it("a comparison's \"Open in Predict\" is the page's one primary action; its other links are text", () => {
    const stat: StatAnswer = {
      family: "two-team", intent: "opr-vs", title: "OPR: 23268 vs 7149 in 2025–26", team: { number: 23268, name: "Ultraviolet" }, teams: [{ number: 23268, name: "Ultraviolet" }, { number: 7149, name: "ENFORCERS" }], scope: ["2025–26"],
      headline: { value: "23268 leads 157.9 – 115.3", label: "+42.6" },
      blocks: [
        { kind: "compare", title: "OPR", teams: [{ label: "23268", href: "/teams/23268" }, { label: "7149", href: "/teams/7149" }], rows: [{ label: "Total", values: ["157.9", "115.3"], nums: [157.9, 115.3], max: 250, best: 0, gap: "+42.6", diff: 42.6 }] },
        { kind: "links", title: "Try it", items: [{ label: "Open in Predict", href: "/predict?x" }, { label: "Compare side by side", href: "/compare?teams=7149,23268" }] },
      ],
      definition: "From each team's stored season numbers.", source: "From both teams' 2025–26 season numbers",
    };
    state.answer = answer([team(23268, "Ultraviolet", "Hackettstown, NJ"), team(7149, "ENFORCERS", "Egg Harbor Township, NJ")], { stat });
    const { container } = show("/search?q=23268%20vs%207149%20opr");
    const ctas = [...container.querySelectorAll("[data-primary-cta]")];
    expect(ctas.map((c) => c.textContent)).toEqual(["Open in Predict"]);
    expect(within(container).getByRole("link", { name: "Compare side by side" }).className).toContain("underline");
  });
  it("a fact answer is one card in the team page's look: the team's header, the fact once, no TEAMS card, no gold", () => {
    const card = { kind: "info" as const, title: "Where they're from", team: { number: 4215, name: "Hypnotic Robotics" }, facts: [{ label: "Where they're from", values: ["Oradell, NJ, USA"] }],
      related: ["4215 record"], lines: [{ text: "Oradell, NJ, USA", href: "/teams/4215" }] };
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ, USA")], { card });
    const { container } = show("/search?q=where%20is%204215%20from");
    const frame = container.querySelector("[data-answer-frame]")!;
    expect(frame.querySelector("[data-answer-team]")!.textContent).toContain("4215Hypnotic Robotics");
    expect(within(frame as HTMLElement).getByRole("link", { name: /Full team page/ }).getAttribute("href")).toBe("/teams/4215?season=2024");
    // The fact once (its dropdown line isn't drawn again), and its team gets no card of its own.
    expect(within(frame as HTMLElement).getAllByText("Oradell, NJ, USA")).toHaveLength(1);
    expect(container.querySelector('[data-result="team"]')).toBeNull();
    expect(container.querySelector('[data-section="team"]')).toBeNull();
    expect(frame.innerHTML).not.toMatch(/(border|bg)-accent/);
    // The results column is 720px at most, centred; the team page link a text link (one primary action per page).
    expect(container.querySelector("[data-results-column]")!.className).toMatch(/\bmx-auto\b.*\bmax-w-\[720px\]/);
    expect(frame.querySelector("[data-secondary]")!.className).toContain("underline");
    expect(within(frame as HTMLElement).getByRole("link", { name: /4215 record/ }).getAttribute("href")).toBe("/search?q=4215%20record");
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
    // Each time tab says how many events it holds before it's picked.
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["All, 3 events", "Upcoming, 2 events", "Past, 1 event"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Upcoming/ }));
    expect(loc).toBe("/search?q=meets+in+nj&when=upcoming");
    expect(titles()).toEqual(["Next Meet", "Later Meet"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Past/ }));
    expect(titles()).toEqual(["Old Meet"]);
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(loc).toBe("/search?q=meets+in+nj");
    expect(titles()).toEqual(["Next Meet", "Old Meet", "Later Meet"]);
  });

  it("the time tab follows the query: 'upcoming meets' opens on Upcoming, highlighted, and a pick of All is kept in the address", () => {
    const understood = { kind: "events" as const, label: "Upcoming meets in New Jersey", time: "upcoming" as const };
    state.answer = answer([ev("A", "Next Meet", "2099-11-17"), ev("C", "Later Meet", "2099-12-01")], { understood });
    const { container, unmount } = show("/search?q=upcoming%20meets%20in%20nj");
    const checked = () => screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);
    expect(checked()).toEqual(["Upcoming2"]);
    expect(screen.getByRole("radio", { name: /^Upcoming/ }).className).toContain("bg-accent");
    // The query's own tab is no filter: nothing to clear.
    expect(screen.queryByRole("button", { name: /Clear filters/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    expect(loc).toBe("/search?q=upcoming+meets+in+nj&when=all");
    expect(checked()).toEqual(["All2"]);
    // Clear goes back to the query's own tab.
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(loc).toBe("/search?q=upcoming+meets+in+nj");
    expect(checked()).toEqual(["Upcoming2"]);
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(2);
    unmount();
    // A reload or a shared link of the All pick opens on All.
    show("/search?q=upcoming%20meets%20in%20nj&when=all");
    expect(checked()).toEqual(["All2"]);
  });

  it("a fallback that dropped the time asked for opens on All, so its events show (Greptile on #521)", () => {
    const understood = { kind: "events" as const, label: "Past meets at Dumont High School", time: "past" as const, fallback: "No past meets at Dumont High School in the data — showing meets at Dumont High School instead" };
    state.answer = answer([ev("A", "Next Meet", "2099-11-17")], { understood });
    const { container } = show("/search?q=past%20meets%20at%20dumont%20high%20school");
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(1);
    expect(loc).toBe("/search?q=past%20meets%20at%20dumont%20high%20school");
  });

  it("an event's venue is shown in full, never cut to fit", () => {
    const h: SearchHit = { ...ev("USNJNOM5", "Northern League Meet", "2099-12-06"), event: { start: "2099-12-06", end: "2099-12-06", type: "LeagueMeet", venue: "Thomas Edison EnergySmart Charter School", status: "upcoming" } };
    state.answer = answer([h, ev("B", "Old Meet", "2020-01-11", 2019)]);
    const { container } = show("/search?q=meets%20in%20nj");
    const venue = container.querySelector("[data-venue]")!;
    expect(venue.textContent).toBe("Thomas Edison EnergySmart Charter School");
    expect(venue.className).not.toContain("truncate");
  });

  it("a filter with nothing left says what's empty and offers the tab that isn't, never a dead end", () => {
    state.answer = answer([ev("A", "P2-8 Northeast League Meet", "2099-12-13", 2026), ev("B", "P3-8 Northeast League Meet", "2100-01-24", 2026)]);
    const { container } = show("/search?q=meets%20in%20river%20dell%20high%20school&when=past");
    expect(screen.getByRole("radio", { name: /^Past/ }).getAttribute("aria-label")).toBe("Past, 0 events");
    const empty = container.querySelector("[data-filtered-empty]")!;
    expect(empty.textContent).toContain("No past events in these results.");
    fireEvent.click(within(empty as HTMLElement).getByRole("button", { name: "Show 2 upcoming" }));
    expect(loc).toBe("/search?q=meets+in+river+dell+high+school&when=upcoming");
    expect(container.querySelectorAll('[data-result="event"]')).toHaveLength(2);
  });

  it("an empty season names what it narrowed: matches for a match search", () => {
    const m = (season: number): SearchHit => ({ kind: "match", ref: `${season}:X:qual:0:1`, title: "Q1", subtitle: "", season });
    state.answer = answer([m(2024), m(2025)]);
    const { container } = show("/search?q=x&season=2023");
    expect(container.querySelector("[data-filtered-empty]")!.textContent).toContain("No matches in 2023–24 in these results.");
  });

  it("an empty season offers every season, with its count", () => {
    state.answer = answer([ev("A", "Next Meet", "2099-11-17"), ev("B", "Old Meet", "2020-01-11", 2019)]);
    const { container } = show("/search?q=x&when=upcoming&season=2019");
    const empty = container.querySelector("[data-filtered-empty]")!;
    expect(empty.textContent).toContain("No upcoming events in 2019–20 in these results.");
    // Past in 2019–20 holds one, every season holds one upcoming: both offered, the time tab first.
    expect([...empty.querySelectorAll("[data-alternative]")].map((b) => b.textContent)).toEqual(["Show 1 past", "Show 1 in every season"]);
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
    expect(screen.getAllByText("2024–25").length).toBeGreaterThan(0);
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

  it("never dead-ends (results guide §8): what's missing in one sentence, the closest as full cards, searches that answer, places to go", () => {
    state.answer = answer([], { step: "recovery", recovery: { understood: ["Events in New Jersey", "at Nonexistent High School"], closest: [team(4215, "Hypnotic Robotics", "Oradell, NJ")], browse: [] } });
    const { container } = show("/search?q=meets%20at%20Nonexistent%20High%20School%20in%20New%20Jersey");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No matches found");
    // The query is in the top bar: the heading never repeats it.
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toContain("Nonexistent");
    expect(container.textContent).toContain("Search has no answer for “meets at Nonexistent High School in New Jersey”; these are the closest real results.");
    // What it was understood as stays off the page (§7): an attribute only.
    expect(container.querySelector("[data-understood]")!.getAttribute("data-understood")).toContain("Events in New Jersey");
    expect(container.querySelector("[data-no-results]")!.textContent).not.toMatch(/understood|read as/i);
    const near = screen.getByRole("region", { name: "Closest results" });
    expect(near.querySelector('[data-result="team"]')).not.toBeNull();
    // A closest team is a full card: its season numbers, as in the results list, asked for with the rest.
    expect(near.textContent).toContain("12-3-0");
    expect(paths.some((p) => p?.includes("/api/teams-summary") && p.includes("4215"))).toBe(true);
    expect(container.textContent).toContain("4215 record");
    expect(screen.getByRole("link", { name: /Browse all events/ }).getAttribute("href")).toBe("/events");
    // No example searches here: the top bar's dropdown offers those.
    expect(container.querySelectorAll("[data-example]")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Here's what we found/);
  });
  it("a closest team that opens a season asked for shows that season's numbers, never another's", () => {
    state.answer = answer([], { step: "recovery", recovery: { understood: ["4215"], closest: [{ ...team(4215, "Hypnotic Robotics", "Oradell, NJ"), linkSeason: 2023 }], browse: [] } });
    paths.length = 0;
    show("/search?q=hypnotic%20robots%202023-24%20trombone");
    const asked = paths.filter((p) => p?.includes("/api/teams-summary"));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((p) => p!.includes("season=2023"))).toBe(true);
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
    expect(card.textContent).toContain("4215Hypnotic RoboticsOradell, NJ");
    expect(card.textContent).toContain("23268UltravioletHackettstown, NJ");
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Worlds appearances for ENFORCERS (7149)");
    // The team in bold inside the heading.
    expect(container.querySelector("h1 [data-title-team]")!.textContent).toBe("ENFORCERS (7149)");
    // The reading "ENFORCERS (7149) · Worlds appearances" only repeats the heading, so no badge says it again.
    expect(container.querySelectorAll("[data-context-badge]")).toHaveLength(0);
  });
});

describe("search results page, Phase 2 cards", () => {
  const worlds = (season: string, div: string, rank: number, opr: number) => ({
    text: `FIRST Championship - Houston - World Championship - FIRST Tech Challenge - ${div} Division`,
    detail: `${season} · Apr 19–23, 2022 · Houston, TX`, results: [`Ranked #${rank}`, "4-4-0 in quals", `OPR ${opr.toFixed(1)}`], href: `/events/${season.slice(0, 4)}/X?team=7149`,
  });

  it("a 'when' answer's cards go newest first, each led by its season; the chart still reads left to right", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 3,
      lines: [worlds("2021–22", "Franklin", 20, 124.8), worlds("2022–23", "Ochoa", 3, 114.8), worlds("2023–24", "Franklin", 10, 127.2)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    const cards = [...container.querySelectorAll("[data-appearance]")];
    expect(cards.map((c) => c.getAttribute("data-appearance"))).toEqual(["2023", "2022", "2021"]);
    expect(cards[0].querySelector("[data-card-title]")!.textContent).toBe("2023–24 · Franklin Division");
    // The season leads the card, so it isn't repeated as a chip.
    expect(cards[0].textContent!.match(/2023–24/g)).toHaveLength(1);
    expect([...container.querySelectorAll("[data-node]")].map((n) => n.getAttribute("data-node"))).toEqual(["2021", "2022", "2023"]);
    // Each node still jumps to its own season's card.
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.click(container.querySelector('[data-node="2022"]')!);
    expect(container.querySelector('[data-appearance="2022"]')!.getAttribute("data-highlight")).toBe("on");
  });

  it("the timeline plots division rank (#1 at the top), never OPR across seasons; the banner has no OPR stat", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 3,
      lines: [worlds("2021–22", "Franklin", 20, 124.8), worlds("2022–23", "Ochoa", 3, 114.8), worlds("2023–24", "Franklin", 10, 127.2)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    const fig = container.querySelector("[data-timeline]")!;
    expect(fig.querySelector("figcaption")!.textContent).toBe("Division rank by season");
    const top = (season: string) => parseFloat((fig.querySelector(`[data-node="${season}"]`) as HTMLElement).style.top);
    // #3 highest, then #10, then #20 at the bottom of the band.
    expect(top("2022")).toBeLessThan(top("2023"));
    expect(top("2023")).toBeLessThan(top("2021"));
    expect(top("2021")).toBe(82);
    // A node still says its season's division, rank, record and OPR, in words.
    expect(fig.querySelector('[data-node="2021"]')!.getAttribute("aria-label")).toBe("2021–22: Franklin Division, ranked #20, 4-4-0, OPR 124.8. Go to its card.");
    const banner = container.querySelector("[data-stat-banner]")!.textContent!;
    expect(banner).not.toMatch(/OPR/);
    expect(banner).toContain("Win rate at Worlds50.0%");
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

  it("event cards: one link over the card, quick links beside it (never inside); a name held in several seasons is a card a season, no season tabs", () => {
    state.answer = answer([ev("A", "Ohio State Championship", "2020-02-11", 2019), ev("B", "Ohio State Championship", "2021-02-11", 2020)]);
    const { container } = show("/search?q=x");
    const cards = container.querySelectorAll('[data-result="event"]');
    expect(cards).toHaveLength(2);
    for (const a of container.querySelectorAll("a")) expect(a.querySelector("a, button")).toBeNull();
    expect(within(cards[0] as HTMLElement).getByRole("link", { name: "Teams" }).getAttribute("href")).toBe("/events/2019/A?tab=teams");
    expect(within(cards[1] as HTMLElement).getByRole("link", { name: "Ohio State Championship" }).getAttribute("href")).toBe("/events/2020/B");
    // One link to the event's page (the card's own): no "View event" cue repeating it, and no season tabs.
    expect(container.querySelector("[data-season-tabs], [data-cta]")).toBeNull();
  });

  it("an event's divisions under it, one family a season; the season filter leaves one, and the heading says which", () => {
    const fam = (season: number, divs: string[]) => [ev("FTCCMP1", "FIRST Championship - FIRST Tech Challenge", `${season + 1}-04-20`, season),
      ...divs.map((d) => ({ ...ev(`FTCCMP1${d.slice(0, 4).toUpperCase()}`, `FIRST Championship - FIRST Tech Challenge - ${d} Division`, `${season + 1}-04-20`, season), parent: "FTCCMP1" }))].map((h) => ({ ...h, game: season === 2025 ? "DECODE" : "INTO THE DEEP", ...(h.parent && season === 2025 && !h.ref.endsWith("EDIS") ? { eventTeams: 60 } : {}) }));
    const hits = [...fam(2025, ["Edison", "Franklin", "Ross"]), ...fam(2024, ["Jemison", "Ochoa"])];
    state.answer = answer(hits, { understood: { kind: "events", label: "FIRST Championship (Worlds) events, every season", scope: { subject: "FIRST Championship (Worlds) events", span: ", every season" }, total: hits.length } } as Partial<SearchAnswer>);
    const { container } = show("/search?q=first%20championship");
    const families = container.querySelectorAll("[data-event-family]");
    expect(families).toHaveLength(2);
    expect([...families[0].querySelectorAll('[data-division] a:not([href*="?tab"])')].map((a) => a.textContent)).toEqual(["Edison Division", "Franklin Division", "Ross Division", "Finals"]);
    // Each fact once, on the event: place, venue and dates never on a division; status once (they all agree).
    expect(families[0].textContent!.split("Oradell").length - 1).toBe(1);
    expect(families[0].querySelectorAll("[data-division]")[0].textContent).toBe("Edison DivisionMatchesRankingsTeamsPlayoffs");
    // A division's teams, and the total on the event, where the data lists them.
    expect(families[0].querySelector("[data-family-count]")!.textContent).toContain("· 120 teams");
    expect(families[0].querySelectorAll('[data-event-chip="status"]')).toHaveLength(1);
    // The type only where the name doesn't already say it.
    expect(families[0].querySelector("[data-family-type]")).toBeNull();
    // The accent is the selected control's alone: none in the tree.
    expect(container.querySelectorAll('[data-event-family] [class*="accent"]')).toHaveLength(0);
    expect(families[0].querySelector("[data-family-link]")!.getAttribute("href")).toBe("/events?season=2025&q=FTCCMP1");
    expect(families[0].querySelector("[data-family-count]")!.textContent).toBe("3 divisions and finals · 120 teams");
    // The newest finished season opens; an older one shows its event only, its divisions a tap away (still counted).
    expect(families[1].querySelectorAll("[data-division]")).toHaveLength(0);
    fireEvent.click(families[1].querySelector("[data-family-count]")!);
    expect(families[1].querySelectorAll("[data-division]")).toHaveLength(3);
    // Seasons read apart by their game, not only their years.
    expect(families[0].textContent).toContain("2025–26 DECODE season");
    expect(families[1].textContent).toContain("2024–25 INTO THE DEEP season");
    expect(container.querySelector("[data-season-tabs]")).toBeNull();
    // Every event is counted once, the same on the tab and the section.
    expect(screen.getByRole("radio", { name: "All, 7 events" })).toBeTruthy();
    cleanup();
    const again = show("/search?q=first%20championship&season=2024").container;
    expect(again.querySelectorAll("[data-event-family]")).toHaveLength(1);
    expect(again.querySelector("h1")!.textContent).toBe("FIRST Championship (Worlds) events, 2024–25");
    expect(again.querySelector("[data-context-badge]")).toBeNull();
    expect(screen.getByRole("radio", { name: "All, 3 events" })).toBeTruthy();
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

  it("every season as a chip; the team the answer is about gets no card of its own, its pages are in the summary", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 3,
      lines: [worlds("2021–22", "Franklin", 20, 124.8), worlds("2022–23", "Ochoa", 3, 114.8), worlds("2023–24", "Franklin", 10, 127.2)] } });
    const { container } = show("/search?q=when%20did%20enforcers%20go%20to%20worlds");
    expect([...container.querySelectorAll("[data-timeline-chips] button")].map((b) => b.textContent)).toEqual(["2023–24: #10", "2022–23: #3", "2021–22: #20"]);
    expect(container.querySelector('[data-result="team"]')).toBeNull();
    expect(container.querySelector("[data-answer-teams]")).toBeNull();
    expect(within(container.querySelector("[data-team-links]") as HTMLElement).getByRole("link", { name: /Scouting profile/ }).getAttribute("href")).toBe("/teams/7149");
  });

  it("each team card a VS Compare of its own, and one trip is still a chip", () => {
    state.answer = answer([team(7149, "ENFORCERS", "X")]);
    expect(show("/search?q=7149").container.querySelector("[data-vs-compare]")!.tagName).toBe("BUTTON");
    cleanup();
    state.answer = answer([team(7149, "ENFORCERS", "X")], { card: { kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, count: 1, lines: [worlds("2022–23", "Ochoa", 3, 114.8)] } });
    expect([...show("/search?q=when%20did%20enforcers%20go%20to%20worlds").container.querySelectorAll("[data-timeline-chips] button")].map((b) => b.textContent)).toEqual(["2022–23: #3"]);
  });

  it("the Compare picks keep the season the result is about", () => {
    state.answer = answer([{ ...team(7149, "ENFORCERS", "X"), linkSeason: 2024 }]);
    const { container } = show("/search?q=enforcers%202024");
    fireEvent.click(container.querySelector("[data-vs-compare]")!);
    // One team found: its pick still goes on to /compare, where the other team is added.
    expect(document.querySelector("[data-compare-go]")!.textContent).toContain("Compare (1)");
    expect(document.querySelector("[data-compare-go]")!.getAttribute("href")).toBe("/compare?teams=7149&season=2024");
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
    // On: it says so, and a second tap takes it off.
    expect(screen.getByRole("button", { name: "Shortlisted" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Shortlisted" }));
    expect(shortlisted.has(4215)).toBe(false);
    expect(screen.getByRole("button", { name: "Shortlist" }).getAttribute("aria-pressed")).toBe("false");
    // A mostly-vertical drag is a scroll, not a swipe.
    fireEvent.touchStart(card, { touches: [{ clientX: 20, clientY: 100 }] });
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 110, clientY: 300 }] });
    expect(shortlisted.has(4215)).toBe(false);
  });

  it("Matches, tapped or swiped left, lists the team's latest played matches, newest first", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
    const { container } = show("/search?q=4215");
    fireEvent.click(screen.getByRole("button", { name: "Matches" }));
    const rows = () => [...document.querySelectorAll("[data-match-history] li")].map((li) => li.textContent);
    expect(rows()).toEqual(["LQ9 · USNJQ1101–150", "WQ3 · USNJQ1120–90"]);
    fireEvent.click(within(document.querySelector("[data-matches-sheet]") as HTMLElement).getByRole("button", { name: "Close" }));
    expect(document.querySelector("[data-match-history]")).toBeNull();
    const card = container.querySelector("[data-swipe]")!;
    fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(card, { touches: [{ clientX: 80, clientY: 102 }] });
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 80, clientY: 102 }] });
    expect(rows()).toHaveLength(2);
  });

  it("two picks dock in a Compare (2) bar that goes straight to /compare; a third replaces the first", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ"), team(23268, "Ultraviolet", "Hackettstown, NJ"), team(6980, "Bad Wolf", "X")]);
    const { container } = show("/search?q=x");
    const vs = () => [...container.querySelectorAll("[data-vs-compare]")] as HTMLElement[];
    fireEvent.click(vs()[0]);
    fireEvent.click(vs()[1]);
    expect(vs()[0].getAttribute("aria-pressed")).toBe("true");
    const go = document.querySelector("[data-compare-go]")!;
    expect(go.textContent).toContain("Compare (2)");
    expect(go.getAttribute("href")).toBe("/compare?teams=4215,23268");
    fireEvent.click(vs()[2]);
    expect(document.querySelector("[data-compare-go]")!.getAttribute("href")).toBe("/compare?teams=23268,6980");
    fireEvent.click(screen.getByRole("button", { name: "Remove 6980 from the comparison" }));
    expect(document.querySelector("[data-compare-go]")!.getAttribute("href")).toBe("/compare?teams=23268");
  });

  it("a new search starts with no picks, and going back to the first doesn't bring them back", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ"), team(23268, "Ultraviolet", "Hackettstown, NJ")]);
    // One page, searched again in place (the top bar's search navigates within it).
    let go: (to: string) => void = () => {};
    function Go() { go = useNavigate(); return null; }
    const ui = render(<MemoryRouter initialEntries={["/search?q=a"]}><SearchPage /><Go /></MemoryRouter>);
    fireEvent.click(ui.container.querySelector("[data-vs-compare]")!);
    expect(document.querySelector("[data-compare-bar]")).toBeTruthy();
    const at = (q: string) => act(() => go(`/search?q=${q}`));
    at("b");
    expect(document.querySelector("[data-compare-bar]")).toBeNull();
    at("a");
    expect(document.querySelector("[data-compare-bar]")).toBeNull();
  });

  it("an open head-to-head closes when the search changes (Back included)", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "", season: 2025, href: "/compare?teams=4215,23268" };
    state.answer = answer([compare, team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
    let go: (to: string) => void = () => {};
    function Go() { go = useNavigate(); return null; }
    const ui = render(<MemoryRouter initialEntries={["/search?q=a"]}><SearchPage /><Go /></MemoryRouter>);
    fireEvent.click(ui.container.querySelector('[data-result="compare"]')!);
    expect(document.querySelector("[data-compare-sheet]")).toBeTruthy();
    act(() => go("/search?q=b"));
    expect(document.querySelector("[data-compare-sheet]")).toBeNull();
  });

  it("while a new search loads, the last results can't be picked or previewed, and a preview never outlives its answer", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "", season: 2025, href: "/compare?teams=4215,23268" };
    state.answer = answer([compare, team(6980, "Bad Wolf", "Oradell, NJ")]);
    state.stale = true;
    const ui = render(<MemoryRouter initialEntries={["/search?q=a"]}><SearchPage /></MemoryRouter>);
    fireEvent.click(ui.container.querySelector('[data-result="compare"]')!);
    expect(document.querySelector("[data-compare-sheet]")).toBeNull();
    fireEvent.click(ui.container.querySelector("[data-vs-compare]")!);
    expect(ui.container.querySelector("[data-vs-compare]")!.getAttribute("aria-pressed")).not.toBe("true");
    // Loaded: the preview opens; a new answer for the same words (a refresh) closes it rather than refill it.
    state.stale = false;
    ui.rerender(<MemoryRouter initialEntries={["/search?q=a"]}><SearchPage /></MemoryRouter>);
    fireEvent.click(ui.container.querySelector('[data-result="compare"]')!);
    expect(document.querySelector("[data-compare-sheet]")).toBeTruthy();
    state.answer = answer([compare, team(23268, "Ultraviolet", "Hackettstown, NJ")]);
    ui.rerender(<MemoryRouter initialEntries={["/search?q=a"]}><SearchPage /></MemoryRouter>);
    expect(document.querySelector("[data-compare-sheet]")).toBeNull();
  });

  it("the Compare bar waits for the privacy choice (the banner uses the same strip)", () => {
    consent.decided = false;
    try {
      state.answer = answer([team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
      const { container } = show("/search?q=x");
      fireEvent.click(container.querySelector("[data-vs-compare]")!);
      expect(document.querySelector("[data-compare-bar]")).toBeNull();
    } finally { consent.decided = true; }
  });

  it("a Compare result opens its head-to-head over the results, and closing it leaves them as they were", () => {
    const compare: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "", season: 2025, href: "/compare?teams=4215,23268" };
    state.answer = answer([compare, team(4215, "Hypnotic Robotics", "Oradell, NJ")]);
    const { container } = show("/search?q=4215%20vs%2023268");
    // A modified click (new tab) is left to the link: no preview.
    fireEvent.click(container.querySelector('[data-result="compare"]')!, { ctrlKey: true });
    expect(document.querySelector("[data-compare-sheet]")).toBeNull();
    fireEvent.click(container.querySelector('[data-result="compare"]')!);
    expect(loc).toBe("/search?q=4215%20vs%2023268");
    const sheet = document.querySelector("[data-compare-sheet]")!;
    expect(sheet.textContent).toContain("Hypnotic Robotics (4215) vs Ultraviolet (23268)");
    expect(within(sheet as HTMLElement).getByRole("link", { name: /View full comparison/ }).getAttribute("href")).toContain("/compare?teams=4215,23268");
    fireEvent.click(within(sheet as HTMLElement).getByRole("button", { name: "Close" }));
    expect(document.querySelector("[data-compare-sheet]")).toBeNull();
    expect(container.querySelector('[data-result="compare"]')).toBeTruthy();
  });
});
