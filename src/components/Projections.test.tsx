// @vitest-environment jsdom
// The event page's Projections: the header says how many simulations and after which match; every team
// has a median rank with its range (never a bare rank); advancement odds carry their label; tracked teams
// are pinned first; a finished event becomes "Final results vs projections".
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import type { ProjectionRun, ProjectionsView, ProjectionTeam } from "../shared/projections";
import { markOffline } from "../lib/offline/saved";

let view: ProjectionsView | undefined;
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: view, error: undefined, loading: false, reload: () => {} }), load: () => Promise.resolve() }));
let localResult: unknown = null;
let localUnavailable: string | null = null, localError: string | null = null;
vi.mock("../lib/localProjection/run", () => ({
  prepareLocal: async () => (localUnavailable ? { unavailable: localUnavailable } : localResult || localError ? { key: "k" } : { unavailable: "none" }),
  cacheKey: () => "k",
  localProjectionFor: async () => { if (localError) throw new Error(localError); return localResult; },
}));
let tracked: number[] = [];
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: tracked, events: [] } } }) }));

const { Projections, projectionHeadline } = await import("./Projections");
const { TooltipProvider } = await import("./ui/overlay");

const t = (team: number, p10: number, p50: number, p90: number, pAdvance: number | null = 0.3, advance: ProjectionTeam["advance"] = pAdvance == null ? "qualified" : "odds"): ProjectionTeam => ({ team, rank: { p10, p50, p90, mean: p50 }, pPlayoff: 0.6, pCaptain: 0.3, pPicked: 0.3, pAdvance, advance, pWin: 0.1, pFinalist: 0.1 });
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

  it("an ineligible team reads 'Not eligible', never 'Qualified'; a row without a status stays neutral", () => {
    view = { season: 2026, code: "TQ1", current: run({ teams: [t(101, 1, 1, 2, null, "qualified"), t(102, 2, 2, 3, null, "ineligible"), { ...t(103, 3, 3, 4, null), advance: undefined }, t(104, 4, 4, 4)] }), baseline: null, lastOpen: null };
    mount(detail("live"));
    const rows = screen.getAllByRole("row").slice(1);
    const cell = (i: number) => rows[i].lastElementChild!;
    expect(within(cell(0) as HTMLElement).getByText("Qualified")).toBeTruthy();
    expect(within(cell(1) as HTMLElement).getByText("Not eligible")).toBeTruthy();
    expect(within(cell(1) as HTMLElement).queryByText("Qualified")).toBeNull();
    expect(cell(2).textContent).toBe("—");
    expect(cell(3).textContent).toMatch(/30%/);
    expect(screen.getAllByText("Qualified")).toHaveLength(1);
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

describe("Projections (local estimate)", () => {
  const local = (o: Partial<ProjectionRun> = {}) => ({ local: true as const, packVersion: "v1", ratingsAsOf: "2026-10-17T12:00:00Z", computeMs: 800, stopped: false, cacheKey: "k", run: run({ runs: 1500, target: 1500, ...o }) });
  const can = () => {
    localStorage.setItem("cs-pack-meta", JSON.stringify({ version: "v1", bytes: 1, savedAt: 1, builtAt: "x", engineVersion: "x" }));
    localStorage.setItem("cs-offline-seasons", JSON.stringify([{ season: 2026, version: "v1", sha256: "x", bytes: 1, savedAt: 1, dataAsOf: null, builtAt: "x" }]));
    vi.stubGlobal("Worker", class {});
  };
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); localResult = null; localUnavailable = null; localError = null; });

  const offlineView = () => markOffline({ season: 2026, code: "TQ1", current: null, baseline: null, lastOpen: null }, { season: 2026, savedAt: 1, dataAsOf: null });

  it("offline, says why the device can't estimate and what to do, never promising a server run soon", async () => {
    can();
    localUnavailable = "Your offline ratings and your saved season are from different releases, so this device can't tell which results the ratings already include.";
    view = offlineView();
    mount(detail("live"));
    expect(await screen.findByText("No local estimate on this device")).toBeTruthy();
    expect(screen.getByText(/different releases/)).toBeTruthy();
    expect(screen.getByText(/once you're back online/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Update your offline packs on Download/ }).getAttribute("href")).toBe("/download");
    expect(screen.queryByText(/within a minute or two/)).toBeNull();
    expect(screen.queryByText("The first projection is on its way")).toBeNull();
  });

  it("shows the failure when the device's run fails", async () => {
    can();
    localError = "Worker crashed";
    view = offlineView();
    mount(detail("live"));
    expect(await screen.findByText(/The estimate on this device failed: Worker crashed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Update your offline packs on Download/ })).toBeTruthy();
    expect(screen.queryByText(/within a minute or two/)).toBeNull();
  });

  it("offline with no packs: no promise of a server run either", () => {
    view = offlineView();
    mount(detail("live"));
    expect(screen.getByText("No projection saved for this event")).toBeTruthy();
    expect(screen.queryByText(/within a minute or two/)).toBeNull();
  });

  it("labels it as a local estimate, one tier lower, with no pre-event movement mixed in", async () => {
    can();
    localResult = local();
    view = { season: 2026, code: "TQ1", current: null, baseline: run({ kind: "baseline", played: 0, through: null, computedAt: "x" }), lastOpen: null };
    mount(detail("live"));
    expect(await screen.findByText("Local estimate · 1,500 simulations on this device • after Match 24")).toBeTruthy();
    expect(screen.getAllByText("Local estimate").length).toBeGreaterThan(0);
    expect(screen.getByText(/simulated on this device from your offline pack \(ratings as of Oct 17\)/)).toBeTruthy();
    expect(screen.getByText("Provisional")).toBeTruthy(); // the server's run of this state would be Moderate
    expect(screen.queryByText("before the event")).toBeNull(); // the server's baseline isn't compared against
    expect(screen.queryByText(/^10,000 simulations/)).toBeNull();
  });

  it("says when the time cap stopped it, with the real count", async () => {
    can();
    localResult = { ...local({ runs: 912 }), stopped: true };
    view = { season: 2026, code: "TQ1", current: null, baseline: null, lastOpen: null };
    mount(detail("live"));
    expect(await screen.findByText("Local estimate · 912 simulations on this device • after Match 24")).toBeTruthy();
    expect(screen.getByText("912 of 1,500")).toBeTruthy();
  });

  it("never replaces a stored server run", async () => {
    can();
    localResult = local();
    view = { season: 2026, code: "TQ1", current: run(), baseline: null, lastOpen: null };
    mount(detail("live"));
    expect(screen.getByText("10,000 simulations • updated after Match 24")).toBeTruthy();
    expect(screen.queryByText(/Local estimate/)).toBeNull();
  });

  it("without the offline packs, stays the server's empty state", () => {
    localResult = local();
    view = { season: 2026, code: "TQ1", current: null, baseline: null, lastOpen: null };
    mount(detail("live"));
    expect(screen.getByText("The first projection is on its way")).toBeTruthy();
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
