// @vitest-environment jsdom
// A NJ league page's conference rankings: the label on the table, the league order as the rank (sorting reorders,
// never renumbers), an unranked team shown as unranked (no RS 0, no rank), the marked team's row and page, the
// going-in view labelled registered with its fetch date, and the winner from the awards.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ConferenceSection, CONFERENCE_PAGE, pickConference, sortConferenceRows } from "./ConferenceSection";
import type { Conference, ConferenceRow, LeagueConferences } from "../shared/conferences";

afterEach(cleanup);

const row = (team: number, rank: number | null, leagueRank: number | null, rs: number | null, extra: Partial<ConferenceRow> = {}): ConferenceRow => ({
  team, name: `Team ${team}`, rank, leagueRank, wins: rs == null ? null : 10, losses: rs == null ? null : 0, ties: rs == null ? null : 0, rs, tbp: rs == null ? null : rs * 20,
  played: rs == null ? null : 16, meets: rs == null ? null : 3, rating: rs == null ? null : 100 - (rank ?? 50), opr: rs == null ? null : 10 + team / 1000, ...extra,
});

const EB: Conference = {
  season: 2025, code: "USNJNOLT2", name: "East Bergen Conference", slug: "east-bergen-conference", firstName: null,
  event: "East Bergen Conference Northern League Tournament", start: "2026-03-08", venue: "Emerson Jr. Sr. High School", city: "Emerson",
  status: "finished", teamsFrom: "field", registered: null, rs: { kind: "final", asOf: "2026-11-10T09:43:14.710Z", lastMeet: "2026-02-01" }, leagueOf: 48,
  rows: [row(6980, 1, 7, 4.0, { opr: 5 }), row(23717, 2, 9, 3.9), row(15762, 3, 11, 3.9), row(4215, 4, 12, 3.8, { opr: 101.64, tbp: 92.4 }), row(18155, 5, 44, 0.7, { played: 5, meets: 1 }), row(30680, null, null, null)],
  winner: { captain: { team: 4215, name: "Hypnotic Robotics" }, picks: [{ team: 207, name: "Critical Mass" }] },
  seasons: [{ season: 2026, region: "USNJ", league: "NE", code: "USNJNELT2", name: "Hudson/East Bergen Conference", slug: "hudson-east-bergen-conference" }],
};
const FN: Conference = { ...EB, code: "USNJNOLT", name: "Far North Conference", slug: "far-north-conference", rows: [row(14450, 1, 1, 5)], winner: null, seasons: [] };
const NO: LeagueConferences = { season: 2025, region: "USNJ", code: "NO", conferences: [FN, EB] };

const show = (data = NO, o: { slug?: string | null; team?: number | null } = {}) =>
  render(<MemoryRouter><ConferenceSection data={data} leagueName="Northern" slug={o.slug ?? null} team={o.team ?? null} /></MemoryRouter>);
const ranks = () => [...document.querySelectorAll("[data-conference-table] tbody tr")].map((tr) => [Number(tr.getAttribute("data-team")), tr.querySelector("[data-rank]")!.textContent]);

describe("conference section", () => {
  it("shows the conference the team is in, labelled, in league order, with the unranked team as unranked", () => {
    show(NO, { team: 4215 });
    expect(screen.getByRole("tab", { name: "East Bergen Conference" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-conference-label]")!.textContent).toBe("League meets only — excludes this tournament.");
    expect(document.querySelector("[data-rs-source]")!.textContent).toBe("Final league RS — league meets ended Feb 1, 2026, before this tournament.");
    expect(ranks().map(([t]) => t)).toEqual([6980, 23717, 15762, 4215, 18155, 30680]);
    const mine = document.querySelector("tr[data-marked]")!;
    expect(mine.getAttribute("data-team")).toBe("4215");
    expect(mine.querySelector("[data-rank]")!.textContent).toContain("4th in conference");
    expect(mine.querySelector("[data-rank]")!.textContent).toContain("12th in league");
    expect(within(mine as HTMLElement).getByText("92.4")).toBeTruthy();
    expect(within(mine as HTMLElement).getByText("12 of 48")).toBeTruthy();
    // 18155: one meet, five matches, beside its RS.
    const thin = document.querySelector('tr[data-team="18155"]')!;
    expect([thin.querySelector("[data-played]")!.textContent, thin.querySelector("[data-meets]")!.textContent]).toEqual(["5", "1"]);
    // 30680: no league row, so no rank, RS, TBP or record, never 0.
    const none = document.querySelector('tr[data-team="30680"]')!;
    expect(none.querySelector("[data-unranked]")!.textContent).toBe("Not ranked yet — no league meets played");
    expect([...none.querySelectorAll("td")].slice(2).map((td) => td.textContent)).toEqual(["—", "—", "—", "—", "—", "—", "—", "—"]);
    expect(document.querySelector("[data-conference-winner]")!.textContent).toContain("Won by 4215 Hypnotic Robotics (Winning Alliance Captain) with 207 Critical Mass");
    expect(screen.getByRole("link", { name: /Hudson\/East Bergen Conference, 2026–27/ }).getAttribute("href")).toBe("/leagues/2026/USNJ/NE?conference=hudson-east-bergen-conference&team=4215#conferences");
  });

  it("sorts by OPR then RS without changing a rank number, the marked row still marked", () => {
    show(NO, { team: 4215 });
    const before = new Map(ranks().map(([t, r]) => [t, r]));
    fireEvent.click(screen.getByRole("button", { name: /^OPR/ }));
    // Highest OPR first (4215 101.6, 23717 33.7, 18155 28.2, 15762 25.8, 6980 5), the team with none last.
    expect(ranks().map(([t]) => t)).toEqual([4215, 23717, 18155, 15762, 6980, 30680]);
    fireEvent.click(screen.getByRole("button", { name: /^RS/ }));
    // Highest RS first; 23717 and 15762 tie at 3.9 and keep league order.
    expect(ranks().map(([t]) => t)).toEqual([6980, 23717, 15762, 4215, 18155, 30680]);
    fireEvent.click(screen.getByRole("button", { name: /^RS/ }));
    expect(ranks().map(([t]) => t)).toEqual([18155, 4215, 23717, 15762, 6980, 30680]);
    for (const [t, r] of ranks()) expect(r).toBe(before.get(t as number));
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("4215");
  });

  it("opens on the page that holds the marked team", () => {
    const many = { ...EB, rows: Array.from({ length: 70 }, (_, i) => row(1000 + i, i + 1, i + 1, 4 - i / 100)) };
    show({ ...NO, conferences: [many] }, { team: 1065 });
    expect(document.querySelectorAll("[data-conference-table] tbody tr")).toHaveLength(70 - CONFERENCE_PAGE);
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("1065");
  });

  it("before the tournament: the teams going in, registered via FTC New Jersey with the fetch date, never the field", () => {
    const going: Conference = {
      ...EB, season: 2026, code: "USNJNELT2", name: "Hudson/East Bergen Conference", slug: "hudson-east-bergen-conference", firstName: "East Bergen Conference",
      status: "upcoming", teamsFrom: "registered", winner: null, rs: { kind: "live", asOf: "2026-11-16T21:49:28.125Z" },
      registered: { count: 27, fetchedAt: "2026-11-15T23:47:01.825Z", url: "https://www.newjerseyftc.com/upcoming-events.html", sessionUnknown: false },
      rows: [row(4215, 1, 24, 1.2, { meets: 1, played: 6, registered: "registered" }), row(5555, null, null, null, { registered: "pending" })],
    };
    show({ season: 2026, region: "USNJ", code: "NE", conferences: [going] }, { team: 4215 });
    expect(document.querySelector("[data-going-in]")!.textContent).toContain("Tournament hasn't started yet — 27 teams registered via FTC New Jersey, fetched Nov 15, 2026.");
    expect(document.querySelector("[data-going-in]")!.textContent).toContain("not the final field");
    expect(document.querySelector("[data-rs-source]")!.textContent).toContain("League RS as of Nov 16, 2026");
    expect(screen.getByText("(waitlist)")).toBeTruthy();
    expect(document.querySelector("[data-conference-winner]")).toBeNull();
  });

  it("says plainly when the conferences aren't known, or a link names none", () => {
    show({ ...NO, conferences: [] });
    expect(document.querySelector("[data-conference-none]")!.textContent).toContain("aren't known yet");
    cleanup();
    show(NO, { slug: "nowhere-conference", team: 4215 });
    expect(document.querySelector("[data-conference-unknown]")).toBeTruthy();
    expect(document.querySelector("[data-conference-table]")).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false"]);
  });

  it("picks by slug, then the team's conference, and leaves rows with no value last either way", () => {
    expect(pickConference(NO.conferences, "far-north-conference", 4215)!.code).toBe("USNJNOLT");
    expect(pickConference(NO.conferences, null, 4215)!.code).toBe("USNJNOLT2");
    expect(pickConference(NO.conferences, null, null)!.code).toBe("USNJNOLT2");
    // Records by win share, a tie half: 5-0-0 above 12-4-0 above 5-0-5's equal .750 (league order between those).
    const recs = [row(1, 1, 1, 3, { wins: 12, losses: 4, ties: 0 }), row(2, 2, 2, 3, { wins: 5, losses: 0, ties: 5 }), row(3, 3, 3, 3, { wins: 5, losses: 0, ties: 0 })];
    expect(sortConferenceRows(recs, "record", "desc").map((r) => r.team)).toEqual([3, 1, 2]);
    expect(pickConference([EB, { ...FN, rows: [] }], null, null)!.code).toBe("USNJNOLT2");
    expect(sortConferenceRows(EB.rows, "rs", "asc").map((r) => r.team)).toEqual([18155, 4215, 23717, 15762, 6980, 30680]);
    expect(sortConferenceRows(EB.rows, "rs", "desc").map((r) => r.team)).toEqual([6980, 23717, 15762, 4215, 18155, 30680]);
  });

  it("shows FIRST's RS as given, never rounded, and a lone conference's tab after a bad link", () => {
    show({ ...NO, conferences: [{ ...EB, rows: [row(1, 1, 1, 3.85), row(2, 2, 2, 3.8)] }] }, { slug: "nowhere-conference" });
    fireEvent.click(screen.getByRole("tab", { name: "East Bergen Conference" }));
    expect([...document.querySelectorAll("[data-conference-table] tbody tr")].map((tr) => tr.querySelectorAll("td")[2].textContent)).toEqual(["3.85", "3.8"]);
  });

  it("refuses a slug two conferences share, and a clicked tab shows its own table", () => {
    const twin = { ...FN, code: "USNJNOLT9", slug: EB.slug };
    show({ ...NO, conferences: [FN, EB, twin] }, { slug: EB.slug });
    expect(document.querySelector("[data-conference-unknown]")).toBeTruthy();
    expect(document.querySelector("[data-conference-table]")).toBeNull();
    fireEvent.click(screen.getAllByRole("tab", { name: "Far North Conference" })[1]);
    expect(screen.getAllByRole("tab", { name: "Far North Conference" })[1].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-conference-unknown]")).toBeNull();
    expect([...document.querySelectorAll("[data-conference-table] tbody tr")].map((tr) => tr.getAttribute("data-team"))).toEqual(["14450"]);
  });

  it("a sort lands on the first page of the new order, not back on the marked team's page", () => {
    const many = { ...EB, rows: Array.from({ length: 70 }, (_, i) => row(1000 + i, i + 1, i + 1, 4 - i / 100)) };
    show({ ...NO, conferences: [many] }, { team: 1010 });
    expect(document.querySelector("tr[data-marked]")!.getAttribute("data-team")).toBe("1010");
    // Lowest RS first: 1010 is now on the second page, and the sort shows the first.
    fireEvent.click(screen.getByRole("button", { name: /^RS/ }));
    fireEvent.click(screen.getByRole("button", { name: /^RS/ }));
    const shown = [...document.querySelectorAll("[data-conference-table] tbody tr")].map((tr) => tr.getAttribute("data-team"));
    expect(shown).toHaveLength(CONFERENCE_PAGE);
    expect(shown[0]).toBe("1069");
    expect(document.querySelector("tr[data-marked]")).toBeNull();
  });

  it("says when FTC New Jersey's list doesn't split the teams by session", () => {
    const going: Conference = {
      ...EB, season: 2026, status: "upcoming", teamsFrom: "registered", winner: null, rs: { kind: "live", asOf: "2026-11-16T21:49:28.125Z" },
      registered: { count: 1, fetchedAt: "2026-11-15T23:47:01.825Z", url: "https://www.newjerseyftc.com/upcoming-events.html", sessionUnknown: true },
      rows: [row(4215, 1, 24, 1.2, { registered: "registered" })],
    };
    show({ season: 2026, region: "USNJ", code: "NE", conferences: [going] });
    expect(document.querySelector("[data-session-unknown]")!.textContent).toContain("doesn't say which session each team is in");
    cleanup();
    show({ season: 2026, region: "USNJ", code: "NE", conferences: [{ ...going, registered: { ...going.registered!, sessionUnknown: false } }] });
    expect(document.querySelector("[data-session-unknown]")).toBeNull();
  });
});
