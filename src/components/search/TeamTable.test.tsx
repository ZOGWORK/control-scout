// @vitest-environment jsdom
// A search answer's list of teams as one table (./TeamTable.tsx): every column, bars from the numbers shown, sorts
// by OPR first and re-sorts by a header, the phone's phase row opens on a tap; a single team's answer keeps its card.
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchCard } from "../../shared/api";
import type { TeamTable as Table, TeamTableRow } from "../../shared/teamTable";
import { AnswerCard } from "./SearchBox";
import { TeamTable } from "./TeamTable";

afterEach(cleanup);
const row = (rank: number, team: number, opr: number, auto: number, dc: number, w: number, l: number): TeamTableRow => ({
  rank, team, name: `Team ${team}`, location: "Oradell, NJ", href: `/teams/${team}?season=2025`, opr, auto, dc, endgame: 12.5, pen: 3, wins: w, losses: l, ties: 0,
});
const TABLE: Table = { by: "opr", rows: [row(1, 100, 150, 20, 90, 8, 2), row(2, 200, 120, 40, 60, 10, 0), row(3, 300, 90, 30, 40, 4, 6), row(4, 400, 60, 10, 30, 5, 5)] };
const draw = (t: Table = TABLE) => render(<MemoryRouter><TeamTable table={t} label="Teams in New Jersey" /></MemoryRouter>);
// The headers a reader sees (the phase bar's and the phone toggle's are named for screen readers only).
const heads = (c: HTMLElement) => [...c.querySelectorAll("thead th")].filter((th) => !th.querySelector(".sr-only")).map((th) => th.textContent?.trim());
const teams = (c: HTMLElement) => [...c.querySelectorAll("[data-team-row]")].map((r) => Number(r.getAttribute("data-team-row")));

describe("TeamTable", () => {
  it("draws a row per team with every column, OPR first", () => {
    const { container } = draw();
    expect(heads(container)).toEqual(["#", "Team", "OPR", "Auto", "DC", "Endgame", "Pen", "W-L-T"]);
    expect(teams(container)).toEqual([100, 200, 300, 400]);
    const first = within(container.querySelector('[data-team-row="100"]') as HTMLElement);
    expect(first.getByRole("link").getAttribute("href")).toBe("/teams/100?season=2025");
    expect(first.getByText("150.0")).toBeTruthy();
    expect(first.getByLabelText("8 wins, 2 losses, 0 ties").textContent).toBe("8-2-0");
    // Rank badges for the top three only.
    expect(container.querySelectorAll("[data-rank-badge]")).toHaveLength(3);
    // The OPR bar is scaled to the best OPR listed: #1 full, #4 at 40%.
    const bars = [...container.querySelectorAll<HTMLElement>("[data-opr-bar]")].map((b) => b.style.width);
    expect(bars[0]).toBe("calc(100% - 0.5rem)");
    expect(bars[3]).toBe("calc(40% - 0.5rem)");
    // The phases stack in one order on every row, with a legend and the note that they don't add up to the OPR.
    expect(container.querySelector("[data-phase-bar]")?.getAttribute("aria-label")).toBe("Auto 20.0, DC 90.0, Endgame 12.5, Pen (given away) 3.0");
    expect(container.querySelector("[data-phase-note]")?.textContent).toMatch(/don't add up to the OPR/);
    expect(container.querySelector("[data-sort-key]")?.getAttribute("data-sort-key")).toBe("opr");
    expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toMatch(/OPR/);
  });
  it("re-sorts by a phase OPR, by record, and back", () => {
    const { container } = draw();
    const click = (k: string) => fireEvent.click(container.querySelector(`button[data-sort="${k}"]`)!);
    click("auto");
    expect(teams(container)).toEqual([200, 300, 100, 400]);
    click("auto"); // the other way
    expect(teams(container)).toEqual([400, 100, 300, 200]);
    click("record");
    expect(teams(container)).toEqual([200, 100, 400, 300]);
    expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toMatch(/W-L-T/);
    click("rank");
    expect(teams(container)).toEqual([100, 200, 300, 400]);
  });
  it("keeps the focus on a header after it sorts (the button isn't remade)", () => {
    const { container } = draw();
    const b = container.querySelector<HTMLButtonElement>('button[data-sort="dc"]')!;
    b.focus();
    fireEvent.click(b);
    expect(document.activeElement).toBe(container.querySelector('button[data-sort="dc"]'));
  });
  it("on a phone the phases open under the row, with aria-expanded", () => {
    const { container } = draw();
    const toggle = container.querySelector<HTMLButtonElement>('button[data-expand="200"]')!;
    const more = container.querySelector<HTMLElement>('[data-phases-row="200"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(more.id);
    expect(more.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(more.hidden).toBe(false);
    expect(within(more).getByText("40.0")).toBeTruthy(); // its Auto
    expect(within(more).getByText("60.0")).toBeTruthy(); // its DC
    fireEvent.click(toggle);
    expect(more.hidden).toBe(true);
  });
  it("a list ranked by something else opens in its own order, its number a column", () => {
    const t: Table = { by: "rank", asked: { label: "Win rate" }, rows: TABLE.rows.map((r) => ({ ...r, asked: { value: r.wins / 10, display: `${r.wins * 10}%` } })) };
    const { container } = draw(t);
    expect(teams(container)).toEqual([100, 200, 300, 400]);
    expect(heads(container)).toContain("Win rate");
    fireEvent.click(container.querySelector('button[data-sort="asked"]')!);
    expect(teams(container)).toEqual([200, 100, 400, 300]);
  });
  it("a season whose TeleOp includes the endgame: named TeleOp, and the bar never draws the endgame twice", () => {
    const { container } = draw({ ...TABLE, teleopWithEndgame: true });
    expect(heads(container)).toEqual(["#", "Team", "OPR", "Auto", "TeleOp", "Endgame", "Pen", "W-L-T"]);
    const bar = container.querySelector("[data-phase-bar]")!;
    expect(bar.children).toHaveLength(3);
    expect(bar.getAttribute("aria-label")).toBe("Auto 20.0, TeleOp 90.0, Pen (given away) 3.0");
    expect(container.querySelector("[data-phase-note]")?.textContent).toMatch(/TeleOp already includes the endgame/);
  });
  it("a negative phase OPR has no segment, and its label says so", () => {
    const { container } = draw({ by: "opr", rows: [{ ...TABLE.rows[0], pen: -1.3 }, TABLE.rows[1]] });
    const bar = container.querySelector('[data-team-row="100"] [data-phase-bar]')!;
    expect(bar.getAttribute("aria-label")).toMatch(/Pen \(given away\) -1\.3 \(below zero, not drawn\)$/);
    expect((bar.lastElementChild as HTMLElement).style.width).toBe("0%");
    expect(container.querySelector("[data-phase-note]")?.textContent).toMatch(/negative OPR gets no segment/);
  });
  it("no phase numbers: no phase columns, bar or toggle", () => {
    const { container } = draw({ by: "opr", rows: TABLE.rows.map((r) => ({ ...r, auto: null, dc: null, endgame: null, pen: null })) });
    expect(heads(container)).toEqual(["#", "Team", "OPR", "W-L-T"]);
    expect(container.querySelector("[data-phase-bar]")).toBeNull();
    expect(container.querySelector("[data-expand]")).toBeNull();
  });
});

describe("AnswerCard with a team list", () => {
  const list: SearchCard = { kind: "leaderboard", title: "Teams in New Jersey · best by OPR, 2025–26", lines: TABLE.rows.map((r) => ({ text: `${r.team} ${r.name}`, results: [`#${r.rank}`] })), table: TABLE };
  it("the full page draws the table in place of the lines", () => {
    const { container } = render(<MemoryRouter><AnswerCard card={list} onOpen={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-team-table]")).toBeTruthy();
    expect(container.querySelector("li")).toBeNull();
  });
  it("the dropdown keeps its two lines", () => {
    const { container } = render(<MemoryRouter><AnswerCard card={list} compact onOpen={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-team-table]")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
  it("a single team's answer keeps its card, never a table", () => {
    const one: SearchCard = { kind: "info", title: "School or organization", team: { number: 4215, name: "Hypnotic Robotics" }, lines: [{ text: "Oradell High School", href: "/teams/4215" }] };
    const { container } = render(<MemoryRouter><AnswerCard card={one} onOpen={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-team-table]")).toBeNull();
    expect(container.querySelector("li")?.textContent).toBe("Oradell High School");
  });
});
