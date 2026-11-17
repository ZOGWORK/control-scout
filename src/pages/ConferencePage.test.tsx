// @vitest-environment jsdom
// /leagues/:season/:region/:code/conferences, laid out as region rankings is: the header and season picker, the
// conference switch (each segment its league, date and team count, a link that keeps the team), the season note with
// the exact label, the count line, the winner banner from the awards, the movers by Scout rating, then the table (league
// order as the rank: sorting reorders, never renumbers), its unranked teams labelled (no RS 0, no rank), next season as
// a labelled link, and the links around it. Gated as the league page's button is; none outside New Jersey.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Conference, ConferenceRow, LeagueConferences } from "../shared/conferences";
import type { LeagueStandings } from "../shared/leagues";

const row = (team: number, rank: number | null, leagueRank: number | null, rs: number | null, extra: Partial<ConferenceRow> = {}): ConferenceRow => ({
  team, name: `Team ${team}`, rank, leagueRank, wins: rs == null ? null : 10, losses: rs == null ? null : 0, ties: rs == null ? null : 0, rs, tbp: rs == null ? null : rs * 20,
  played: rs == null ? null : 16, meets: rs == null ? null : 3, rating: rs == null ? null : 100 - (rank ?? 50), opr: rs == null ? null : 10 + team / 1000, ...extra,
});
const EB: Conference = {
  season: 2025, code: "USNJNOLT2", name: "East Bergen Conference", slug: "east-bergen-conference", firstName: null,
  event: "East Bergen Conference Northern League Tournament", start: "2026-03-08", venue: "Emerson Jr. Sr. High School", city: "Emerson",
  status: "finished", teamsFrom: "field", registered: null, rs: { kind: "final", asOf: "2026-11-10T09:43:14.710Z", lastMeet: "2026-02-01" }, leagueOf: 48,
  moves: { week: "2026-03-02", baseline: "2026-02-23" },
  rows: [row(6980, 1, 7, 4.0, { opr: 5, move: 1, ratingRank: 2, rating: 40, trend: "up" }), row(23717, 2, 9, 3.9, { move: -1, ratingRank: 3, rating: 35, trend: "flat" }),
    row(15762, 3, 11, 3.9, { move: "new", ratingRank: 4, rating: 30 }), row(4215, 4, 12, 3.8, { opr: 101.64, tbp: 92.4, move: 0, ratingRank: 1, rating: 50, trend: "flat" }),
    row(18155, 5, 44, 0.7, { played: 5, meets: 1, move: null, ratingRank: null, rating: null }), row(30680, null, null, null)],
  winner: { captain: { team: 4215, name: "Hypnotic Robotics" }, picks: [{ team: 207, name: "Critical Mass" }] },
  seasons: [{ season: 2026, region: "USNJ", league: "NE", code: "USNJNELT2", name: "Hudson/East Bergen Conference", slug: "hudson-east-bergen-conference" }],
};
const FN: Conference = { ...EB, code: "USNJNOLT", name: "Far North Conference", slug: "far-north-conference", start: "2026-02-07", rows: [row(14450, 1, 1, 5)], winner: null, seasons: [] };
const NO: LeagueStandings = { season: 2025, region: "USNJ", code: "NO", name: "Northern", location: null, place: "New Jersey", placeKey: "USA:NJ", readAt: null, meets: [], rows: [] };

let myTeam: number | null = null;
let myNj = true;
let conferences: Conference[] = [FN, EB];
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), useMyTeamNumber: () => myTeam }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({
    data: !path ? undefined : path.endsWith("/conferences") ? ({ season: 2025, region: "USNJ", code: "NO", conferences } satisfies LeagueConferences)
      : path.startsWith("/api/teams/") ? { team: myTeam, season: 2025, nj: myNj, league: null, conference: null }
      : path.startsWith("/api/leagues/") ? NO : undefined,
    error: undefined, loading: false, reload: () => {},
  }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2025, game: "DECODE", predictable: true }, { season: 2026, game: "BIOBUZZ", predictable: true }] }) }));

const { default: ConferencePage } = await import("./ConferencePage");
afterEach(() => { cleanup(); myTeam = null; myNj = true; conferences = [FN, EB]; });

const open = (url = "/leagues/2025/USNJ/NO/conferences?conference=east-bergen-conference&team=4215") =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/leagues/:season/:region/:code/conferences" element={<ConferencePage />} /></Routes></MemoryRouter>);
const ranks = () => [...document.querySelectorAll("[data-conference-table] tbody tr")].map((tr) => [Number(tr.getAttribute("data-team")), tr.querySelector("[data-rank]")!.textContent]);
/** Whether `a` comes before `b` in the page. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("a conference's rankings page", () => {
  it("puts the header, switch, note, count, winner and movers before the table", () => {
    open();
    const table = document.querySelector("[data-conference-table]")!;
    for (const sel of ["[data-conference-switch]", "[data-season-note]", "[data-conference-count]", "[data-conference-winner]", "[data-movers]"]) {
      expect(before(document.querySelector(sel)!, table), sel).toBe(true);
    }
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Rankings: East Bergen Conference");
    expect(document.querySelector("[data-conference-label]")!.textContent).toBe("League meets only — excludes this tournament.");
    expect(document.querySelector("[data-rs-source]")!.textContent).toBe("Final league RS — league meets ended Feb 1, 2026, before this tournament.");
    expect(document.querySelector("[data-conference-count]")!.textContent).toContain("5 ranked teams of 48 in the league · league meets ended Feb 1, 2026, before this tournament · moves by Scout rating since the week of");
    expect(document.querySelector("[data-conference-winner]")!.textContent).toBe("Won by 4215 Hypnotic Robotics (Winning Alliance Captain) with 207 Critical Mass, from FIRST's awards.");
  });

  it("switches conferences by links that keep the season, league and team, each segment with its context", () => {
    open();
    const tabs = within(document.querySelector("[data-conference-switch]") as HTMLElement).getAllByRole("link");
    expect(tabs.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["Far North ConferenceNorthern League · Feb 7, 2026 · 1 team", "/leagues/2025/USNJ/NO/conferences?conference=far-north-conference&team=4215", null],
      ["East Bergen ConferenceNorthern League · Mar 8, 2026 · 6 teams", "/leagues/2025/USNJ/NO/conferences?conference=east-bergen-conference&team=4215", "page"],
    ]);
  });

  it("shows the movers by Scout rating, the table in league order with Move and Trend, and the unranked team below", () => {
    open();
    const m = document.querySelector("[data-movers]")!;
    expect([...m.querySelectorAll("[data-mover]")].map((li) => li.getAttribute("data-mover"))).toEqual(["6980", "23717"]);
    expect([...m.querySelectorAll("[data-newcomer]")].map((li) => li.getAttribute("data-newcomer"))).toEqual(["15762"]);
    expect(document.querySelector("[data-moves-note]")!.textContent).toContain("not FIRST's league table");
    expect(ranks().map(([t]) => t)).toEqual([6980, 23717, 15762, 4215, 18155]);
    const mine = document.querySelector("[data-conference-table] tr[data-marked]")!;
    expect(mine.getAttribute("data-team")).toBe("4215");
    expect(mine.querySelector("[data-rank]")!.textContent).toBe("4th in conference4th12th in league12th lg");
    expect(within(mine as HTMLElement).getByText("92.4")).toBeTruthy();
    expect(within(mine as HTMLElement).getByText("12 of 48")).toBeTruthy();
    expect(document.querySelector('tr[data-team="15762"] [data-trend]')!.textContent).toBe("New");
    // 30680: not in the table; listed below, labelled, with no RS, rank or record.
    expect(document.querySelector('[data-conference-table] tr[data-team="30680"]')).toBeNull();
    const none = document.querySelector('[data-conference-unranked] [data-team="30680"]')!;
    expect(none.querySelector("[data-unranked]")!.textContent).toBe("Not ranked yet — no league meets played");
  });

  it("sorts by OPR then RS without changing a rank number, the marked row still marked", () => {
    open();
    const was = new Map(ranks());
    fireEvent.click(screen.getByRole("button", { name: /^OPR/ }));
    expect(ranks().map(([t]) => t)).toEqual([4215, 23717, 18155, 15762, 6980]);
    fireEvent.click(screen.getByRole("button", { name: /^RS/ }));
    expect(ranks().map(([t]) => t)).toEqual([6980, 23717, 15762, 4215, 18155]);
    for (const [t, r] of ranks()) expect(r).toBe(was.get(t as number));
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("4215");
  });

  it("opens on the page holding the marked team, and marks My team when the link names none", () => {
    conferences = [{ ...EB, rows: Array.from({ length: 70 }, (_, i) => row(1000 + i, i + 1, i + 1, 4 - i / 100)) }];
    open("/leagues/2025/USNJ/NO/conferences?team=1065");
    expect(document.querySelectorAll("[data-conference-table] tbody tr")).toHaveLength(20);
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("1065");
    cleanup();
    conferences = [FN, EB];
    myTeam = 4215;
    open("/leagues/2025/USNJ/NO/conferences");
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("4215");
  });

  it("links next season by name, and the pages around it", () => {
    open();
    expect(screen.getByRole("link", { name: /Next season: Hudson\/East Bergen Conference, 2026–27/ }).getAttribute("href")).toBe("/leagues/2026/USNJ/NE/conferences?conference=hudson-east-bergen-conference&team=4215");
    const links = within(screen.getByRole("navigation", { name: "More rankings" })).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["World rankings", "/rankings?season=2025"], ["New Jersey rankings", "/rankings/regions/USA/NJ?season=2025"], ["All regions", "/rankings/regions?season=2025"],
      ["All leagues", "/leagues?season=2025"], ["Northern League standings", "/leagues/2025/USNJ/NO"], ["East Bergen Conference Northern League Tournament", "/events/2025/USNJNOLT2"]]);
  });

  it("before the tournament: the teams going in, registered via FTC New Jersey with the fetch date, never the field", () => {
    conferences = [{ ...EB, season: 2025, status: "upcoming", teamsFrom: "registered", winner: null, rs: { kind: "live", asOf: "2026-11-16T21:49:28.125Z" },
      registered: { count: 27, fetchedAt: "2026-11-15T23:47:01.825Z", url: "https://www.newjerseyftc.com/upcoming-events.html", sessionUnknown: true },
      rows: [row(4215, 1, 24, 1.2, { meets: 1, played: 6, registered: "registered" }), row(5555, null, null, null, { registered: "pending" })] }];
    open();
    const going = document.querySelector("[data-going-in]")!.textContent!;
    expect(going).toContain("Tournament hasn't started yet — 27 teams registered via FTC New Jersey, fetched Nov 15, 2026.");
    expect(going).toContain("not the final field");
    expect(going).toContain("doesn't say which session each team is in");
    expect(document.querySelector("[data-conference-winner]")).toBeNull();
    expect(document.querySelector('[data-conference-unranked] [data-team="5555"]')!.textContent).toContain("(waitlist)");
  });

  it("says plainly when a link names no one conference, or none are known", () => {
    open("/leagues/2025/USNJ/NO/conferences?conference=nowhere-conference");
    expect(document.querySelector("[data-conference-unknown]")).toBeTruthy();
    expect(document.querySelector("[data-conference-table]")).toBeNull();
    cleanup();
    conferences = [];
    open("/leagues/2025/USNJ/NO/conferences");
    expect(screen.getByText("No conferences known yet")).toBeTruthy();
  });

  it("is hidden from a My team outside New Jersey, and exists for no league elsewhere", () => {
    myTeam = 1111;
    myNj = false;
    open();
    expect(document.querySelector("[data-conference-table]")).toBeNull();
    expect(screen.getByText("Conference rankings are New Jersey's")).toBeTruthy();
    cleanup();
    myTeam = null;
    render(<MemoryRouter initialEntries={["/leagues/2025/USMI/AA/conferences"]}><Routes><Route path="/leagues/:season/:region/:code/conferences" element={<ConferencePage />} /></Routes></MemoryRouter>);
    expect(screen.getByText("No conference rankings here")).toBeTruthy();
  });
});
