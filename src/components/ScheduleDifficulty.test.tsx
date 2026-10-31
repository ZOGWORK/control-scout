// @vitest-environment jsdom
// Schedule difficulty on the event page and the team page: every figure comes with its plain line, mid-event
// the matches still to play lead with the full schedule one tap away, and no schedule means no card.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail, TeamEventRow } from "../shared/api";
import { scheduleDifficulty } from "../shared/scheduleDifficulty";
import { ScheduleDifficultyCard, TeamScheduleSection } from "./ScheduleDifficulty";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";

afterEach(() => { cleanup(); resetFlags(); });

const rating = new Map([[1, 60], [2, 60], [3, 20], [4, 20], [5, 20], [6, 20], [7, 20], [8, 20]]);
const quals = [
  { red: [3, 4], blue: [1, 2], played: true }, { red: [5, 6], blue: [7, 8], played: true },
  { red: [3, 1], blue: [5, 7], played: false }, { red: [4, 8], blue: [2, 6], played: false },
];
const detail = (sd: ReturnType<typeof scheduleDifficulty>) => ({
  event: { season: 2025, code: "USNJQ1" }, field: [...rating.keys()].map((team) => ({ team, name: `Team ${team}` })), scheduleDifficulty: sd,
}) as unknown as EventDetail;

describe("ScheduleDifficultyCard", () => {
  it("leads with what's still to play mid-event, and switches to the full schedule", () => {
    render(<MemoryRouter><ScheduleDifficultyCard d={detail(scheduleDifficulty(rating, quals))} team={null} /></MemoryRouter>);
    const card = document.querySelector("[data-schedule-difficulty]")!;
    expect(card.getAttribute("data-schedule-difficulty")).toBe("remaining");
    expect(screen.getAllByText(/Opponents average/).length).toBe(8);
    fireEvent.mouseDown(screen.getByRole("radio", { name: /Full schedule/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Full schedule/ }));
    expect(card.getAttribute("data-schedule-difficulty")).toBe("full");
    // Team 4 drew both strong robots as opponents, then strong team 2 again: the hardest full schedule, said in words.
    const first = document.querySelector("[data-schedule-row]")!;
    expect(first.getAttribute("data-schedule-row")).toBe("4");
    expect(first.textContent).toMatch(/Hardest of 8/);
  });

  it("shows only the full schedule before the first match, and nothing without a schedule", () => {
    render(<MemoryRouter><ScheduleDifficultyCard d={detail(scheduleDifficulty(rating, quals.map((q) => ({ ...q, played: false }))))} team={null} /></MemoryRouter>);
    expect(document.querySelector("[data-schedule-difficulty]")!.getAttribute("data-schedule-difficulty")).toBe("full");
    expect(screen.queryByRole("radio")).toBeNull();
    cleanup();
    const { container } = render(<MemoryRouter><ScheduleDifficultyCard d={detail(null)} team={null} /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });
});

describe("TeamScheduleSection", () => {
  it("says where the team's draw sits at each event, in a plain line", () => {
    const sd = scheduleDifficulty(rating, quals)!;
    const t4 = sd.teams.find((t) => t.team === 4)!;
    const ev = { season: 2025, code: "USNJQ1", name: "New Jersey Qualifier 1" } as TeamEventRow;
    render(<MemoryRouter><TeamScheduleSection team={4} schedule={[{ ...t4, code: "USNJQ1", scheduled: 4, played: 2 }]} events={[ev]} /></MemoryRouter>);
    const row = document.querySelector("[data-team-schedule-row]")!;
    expect(row.textContent).toMatch(/New Jersey Qualifier 1/);
    expect(row.textContent).toMatch(/Its opponents average .* over the field's, its partners/);
    // Mid-event: what's left leads, and the full schedule is said too.
    expect(row.textContent).toMatch(/1 still to play/);
    expect(row.textContent).toMatch(/Full schedule: hardest of 8/);
  });
});

describe("the owner's scheduleDifficulty toggle", () => {
  it("off hides the event card and the team section", () => {
    resetFlags({ ...DEFAULT_FLAGS, scheduleDifficulty: false }, true);
    const sd = scheduleDifficulty(rating, quals)!;
    const t4 = sd.teams.find((t) => t.team === 4)!;
    const { container } = render(<MemoryRouter>
      <ScheduleDifficultyCard d={detail(sd)} team={null} />
      <TeamScheduleSection team={4} schedule={[{ ...t4, code: "USNJQ1", scheduled: 4, played: 2 }]} events={[]} />
    </MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });
});
