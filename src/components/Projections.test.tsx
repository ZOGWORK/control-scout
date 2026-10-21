// @vitest-environment jsdom
// The event page's Projections: the header says how many simulations and after which match; every team
// has a median rank with its range (never a bare rank); advancement odds carry their label; tracked teams
// are pinned first; a finished event becomes "Final results vs projections".
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import type { ProjectionRun, ProjectionsView, ProjectionTeam } from "../shared/projections";

let view: ProjectionsView | undefined;
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: view, error: undefined, loading: false, reload: () => {} }), load: () => Promise.resolve() }));
let tracked: number[] = [];
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: tracked, events: [] } } }) }));

const { Projections, projectionHeadline } = await import("./Projections");
const { TooltipProvider } = await import("./ui/overlay");

const t = (team: number, p10: number, p50: number, p90: number, pAdvance: number | null = 0.3): ProjectionTeam => ({ team, rank: { p10, p50, p90, mean: p50 }, pPlayoff: 0.6, pCaptain: 0.3, pPicked: 0.3, pAdvance, pWin: 0.1, pFinalist: 0.1 });
const run = (o: Partial<ProjectionRun> = {}): ProjectionRun => ({
  kind: "current", runs: 10000, target: 10000, stage: "live", played: 24, scheduled: 48, through: "Q24", slots: 4, slotsSource: "official", seed: 1, engineVersion: "2.1.1", ms: 3000, computedAt: "2026-10-21T15:00:00Z",
  teams: [t(101, 1, 2, 4), t(102, 2, 4, 6), t(103, 1, 1, 3, null), t(104, 3, 3, 4)], ...o,
});
const detail = (status: "live" | "finished"): EventDetail => ({
  event: { season: 2026, code: "TQ1", status, matchesPlayed: 24 },
  field: [101, 102, 103, 104].map((n, i) => ({ team: n, name: `Team ${n}`, rank: i + 1 })),
  matches: [{ level: "qual" }], live: null,
} as unknown as EventDetail);
const mount = (d: EventDetail) => render(<MemoryRouter><TooltipProvider><Projections d={d} team={null} /></TooltipProvider></MemoryRouter>);

afterEach(() => { cleanup(); tracked = []; });

describe("Projections (live)", () => {
  it("heads with the simulation count and the last match", () => {
    expect(projectionHeadline(run())).toBe("10,000 simulations • updated after Match 24");
    expect(projectionHeadline(run({ through: null, played: 0 }))).toBe("10,000 simulations • before the first match");
    view = { season: 2026, code: "TQ1", current: run(), baseline: run({ kind: "baseline", played: 0, through: null, computedAt: "x" }), lastOpen: null };
    mount(detail("live"));
    expect(screen.getByText("10,000 simulations • updated after Match 24")).toBeTruthy();
    expect(screen.getAllByText(/performance-based — awards can also advance teams/).length).toBeGreaterThan(0);
  });

  it("shows a median with its range for every team, and Qualified instead of odds for a pre-qualified team", () => {
    view = { season: 2026, code: "TQ1", current: run(), baseline: null, lastOpen: null };
    mount(detail("live"));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(within(r).getByRole("img").getAttribute("aria-label")).toMatch(/80% range/);
    expect(within(rows[0]).getByText("#1–3")).toBeTruthy(); // 103: median 1, sorted first
    expect(within(rows[0]).getByText("Qualified")).toBeTruthy();
  });

  it("pins tracked teams first and sorts by a column", () => {
    tracked = [104];
    view = { season: 2026, code: "TQ1", current: run(), baseline: null, lastOpen: null };
    mount(detail("live"));
    const first = () => within(screen.getAllByRole("row")[1]).getByRole("link").textContent;
    expect(first()).toBe("104");
    fireEvent.click(screen.getByRole("button", { name: /^Team/ }));
    expect(first()).toBe("104"); // still pinned whatever the sort
    expect(within(screen.getAllByRole("row")[2]).getByRole("link").textContent).toBe("101");
  });

  it("says when the event ran fewer simulations to stay in budget", () => {
    view = { season: 2026, code: "TQ1", current: run({ runs: 5000 }), baseline: null, lastOpen: null };
    mount(detail("live"));
    expect(screen.getByText("5,000 simulations • updated after Match 24")).toBeTruthy();
    expect(screen.getByText(/of 10,000/)).toBeTruthy();
  });
});

describe("Projections (finished)", () => {
  it("becomes Final results vs projections, judged by the last open bands", () => {
    view = { season: 2026, code: "TQ1", current: run({ stage: "selected", played: 48 }), baseline: run({ kind: "baseline" }), lastOpen: run({ kind: "last_open", teams: [t(101, 1, 1, 1), t(102, 3, 4, 5), t(103, 2, 3, 4), t(104, 4, 4, 4)] }) };
    mount(detail("finished"));
    expect(screen.getByText("Final results vs projections")).toBeTruthy();
    // Actual seeds 1–4: 101 at 1 (inside 1–1), 102 at 2 (outside 3–5), 103 at 3 (inside), 104 at 4 (inside).
    expect(screen.getByText(/inside their projected range after Match 24/).previousSibling?.textContent).toMatch(/^3 of 4/);
  });

  it("shows nothing for an event that finished before projections existed", () => {
    view = { season: 2026, code: "TQ1", current: null, baseline: null, lastOpen: null };
    const { container } = mount(detail("finished"));
    expect(container.textContent).toBe("");
  });
});
