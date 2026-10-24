// @vitest-environment jsdom
// Simulated rankings: nothing is asked for until the click, then the warning comes first and the odds after;
// with no schedule, the matches-per-team choice asks again; with one published, there's no choice to make.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail } from "../shared/api";

const asked: (string | null)[] = [];
let fail = false;
const reload = vi.fn(async () => {});
vi.mock("../lib/api", () => ({
  useApi: (path: string | null) => {
    asked.push(path);
    if (path && fail) return { data: undefined, error: { message: "Couldn't reach the server." }, loading: false, reload };
    return path ? { data: { status: "ok", runs: 2000, schedule: "random", perTeam: 5, teams: [
      { team: 207, played: 0, mean: 3.1, p10: 1, p90: 6, first: 0.43, top4: 0.79, top8: 0.91 },
      { team: 251, played: 4, mean: 10.4, p10: 7, p90: 13, first: 0.004, top4: 0.11, top8: 0.36 },
    ] }, error: undefined, loading: false, reload: async () => {} } : { data: undefined, error: undefined, loading: false, reload: async () => {} };
  },
}));
const { SimulatedRankings } = await import("./SimulatedRankings");

const qual = (n: number, red: number[], blue: number[]) => ({ level: "qual", played: false, key: `qual:0:${n}`, red: { teams: red.map((number) => ({ number })) }, blue: { teams: blue.map((number) => ({ number })) } });
const d = (quals: boolean, schedule = [qual(1, [207, 251], [300, 301])]) => ({
  event: { season: 2026, code: "USNJNEM1" },
  field: [{ team: 207, name: "Critical Mass" }, { team: 251, name: "Red Raiders" }],
  matches: quals ? schedule : [],
}) as unknown as EventDetail;
const base = (p: string | null | undefined) => p?.replace(/[?&]v=[a-z0-9]+$/, "");
afterEach(() => { cleanup(); asked.length = 0; fail = false; reload.mockClear(); });

describe("simulated rankings", () => {
  it("asks for nothing until the click, then shows the warning and each team's odds", () => {
    render(<MemoryRouter><SimulatedRankings d={d(false)} team={null} /></MemoryRouter>);
    expect(asked.every((p) => p === null)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Simulate the rankings/ }));
    expect(base(asked.at(-1))).toBe("/api/events/2026/USNJNEM1/simulated-rankings?perTeam=5");
    expect(screen.getByRole("note").textContent).toMatch(/Highly uncertain\..*random one \(5 matches each\)/);
    const row = document.querySelector('[data-team="207"]')!;
    expect(row.textContent).toContain("Critical Mass");
    expect(row.textContent).toContain("est., no matches yet");
    expect(row.textContent).toContain("43%");
    expect(document.querySelector('[data-team="251"]')!.textContent).toContain("<1%");
    expect(document.querySelector('[data-team="251"]')!.textContent).not.toContain("est.");
  });
  it("matches per team asks again with the new count", () => {
    render(<MemoryRouter><SimulatedRankings d={d(false)} team={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Simulate the rankings/ }));
    fireEvent.click(screen.getByRole("radio", { name: "8" }));
    expect(base(asked.at(-1))).toBe("/api/events/2026/USNJNEM1/simulated-rankings?perTeam=8");
  });
  it("with a published schedule there's no matches-per-team choice", () => {
    render(<MemoryRouter><SimulatedRankings d={d(true)} team={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Simulate the rankings/ }));
    expect(base(asked.at(-1))).toBe("/api/events/2026/USNJNEM1/simulated-rankings");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("The published schedule is used");
  });
  it("a corrected schedule asks again with the open table", () => {
    const { rerender } = render(<MemoryRouter><SimulatedRankings d={d(true)} team={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Simulate the rankings/ }));
    const before = asked.at(-1);
    rerender(<MemoryRouter><SimulatedRankings d={d(true, [qual(1, [207, 300], [251, 301])])} team={null} /></MemoryRouter>);
    expect(asked.at(-1)).not.toBe(before);
    expect(base(asked.at(-1))).toBe(base(before));
  });
  it("a failed simulation can be tried again", () => {
    fail = true;
    render(<MemoryRouter><SimulatedRankings d={d(true)} team={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Simulate the rankings/ }));
    expect(screen.getByText("Couldn't reach the server.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
