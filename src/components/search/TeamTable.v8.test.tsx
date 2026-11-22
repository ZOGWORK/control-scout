// @vitest-environment jsdom
// v8's search answer table (./TeamTable.tsx): straight on its card with a header rule and row hairlines, the team on
// one line from md up, no floating OPR bar, the phases' note folded into "What the columns mean". v8 off: unchanged.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeamTable as Table, TeamTableRow } from "../../shared/teamTable";
import { TeamTable } from "./TeamTable";

const row = (rank: number, team: number): TeamTableRow => ({
  rank, team, name: `A Very Long Team Name ${team}`, location: "Oradell, NJ", href: `/teams/${team}`, opr: 100 - rank, auto: 20, dc: 60, endgame: 10, pen: 2, wins: 8, losses: 0, ties: 0,
});
const TABLE: Table = { by: "opr", rows: [row(1, 100), row(2, 200), row(3, 300)] };
const draw = () => render(<MemoryRouter><TeamTable table={TABLE} label="Undefeated teams" /></MemoryRouter>);
const v8Off = (c: string) => c.split(" ").filter((t) => !t.startsWith("v8:")).join(" ");

afterEach(cleanup);

describe("TeamTable in v8", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => document.documentElement.removeAttribute("data-v8"));

  it("hairlines, one-line names from md up, 48px rows, no OPR bar, the note behind the columns' disclosure", () => {
    const { container } = draw();
    const frame = container.querySelector("[data-team-table] > div")!;
    expect(frame.className).toContain("v8:border-0");
    expect(container.querySelector("thead")!.className).toContain("v8:[&_tr]:border-b");
    const tr = container.querySelector('[data-team-row="100"]')!;
    expect(tr.className).toMatch(/v8:h-12 .*v8:border-ink\/\[0\.07\]/);
    expect(tr.querySelector("[title='100 A Very Long Team Name 100']")!.className).toContain("v8:@min-[44rem]/tt:truncate");
    expect(container.querySelector("[data-opr-bar]")!.parentElement!.className).toContain("v8:hidden");
    expect(container.querySelector("[data-legend]")!.className).toContain("v8:hidden");
    expect(container.querySelector("[data-column-defs] [data-phase-note-v8]")).toBeTruthy();
    // Numbers stay right-aligned in tabular figures.
    expect(tr.querySelector("[data-opr]")!.className).toMatch(/text-right.*tabular-nums/);
  });

  it("v8 off: the classic classes are as they were", () => {
    document.documentElement.removeAttribute("data-v8");
    const { container } = draw();
    expect(v8Off(container.querySelector('[data-team-row="100"]')!.className)).toBe("border-t border-border");
    expect(v8Off(container.querySelector("[data-team-table] > div")!.className)).toBe("overflow-x-auto rounded-lg border border-border bg-card");
    expect(v8Off(container.querySelector("[data-legend]")!.className)).toBe("mt-1.5 space-y-1 text-[11px] text-muted-foreground");
  });
});
