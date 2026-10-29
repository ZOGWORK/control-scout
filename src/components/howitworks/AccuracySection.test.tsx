// @vitest-environment jsdom
// The methodology ledger: it opens on the same headline as the home page's track record, its title says
// which mode the numbers are (a season replay is never "predictions this site made"), each mode shows its
// sample size, the replay says how much of the season it covers, and the numbers agree with each other.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AccuracyBlock, TrackRecord } from "../../shared/api";

let data: unknown;
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data, error: undefined, loading: !data, reload: () => {} }),
}));

vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useCurrentSeason: () => 2026 }));

class FakeIO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("ResizeObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const blk = (n: number, decided: number, right: number, brier: number, baselineBrier: number): AccuracyBlock => ({
  n, decided, accuracy: decided ? right / decided : 0, upsets: decided - right, brier, logLoss: 0.66, baselineBrier, reliability: [], weekly: [],
  byTier: { provisional: { n, accuracy: decided ? right / decided : 0, brier }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
  byLevel: { qual: { n, accuracy: decided ? right / decided : 0 }, playoff: { n: 0, accuracy: 0 } },
});
const RECORD: TrackRecord = {
  seasons: [
    { season: 2026, label: "2026–27 BIOBUZZ", live: blk(33, 33, 16, 0.248, 0.25), backtest: blk(207, 198, 126, 0.226, 0.239), replay: { scored: 231, replayed: 207, eventSkipped: 0, shortHanded: 24, other: 0 } },
    { season: 2025, label: "2025–26 DECODE", live: null, backtest: blk(41743, 41405, 30554, 0.17, 0.247), replay: { scored: 41743, replayed: 41743, eventSkipped: 0, shortHanded: 0, other: 0 } },
  ],
  engineVersion: "2.1.1", liveThreshold: 10_000, headline: { kind: "backtest", season: 2025, accuracy: 30554 / 41405, n: 41743 }, recentCalls: [], generatedAt: "2026-10-20T03:36:40Z",
};

let AccuracySection: typeof import("./AccuracySection").AccuracySection;
beforeAll(async () => { ({ AccuracySection } = await import("./AccuracySection")); }, 120_000);

async function mount() {
  render(<MemoryRouter><AccuracySection /></MemoryRouter>);
  return document.getElementById("ledger")!;
}

describe("methodology ledger", () => {
  it("says the season under way is early and still moving, with last season's final figure; a finished season doesn't", async () => {
    data = RECORD;
    const card = within(await mount());
    // Opens on 2025–26 (the headline): no note.
    expect(card.queryByText(/Early season: a work in progress/)).toBeNull();
    fireEvent.click(card.getByRole("button", { name: /^2026–27$/ }));
    const note = card.getByRole("note");
    // The season's scored matches (the replay's 231), not the selected sample.
    expect(note.textContent).toMatch(/Early season: a work in progress\. Only 231 matches scored this season so far/);
    expect(note.textContent).toMatch(/2025–26's season replay ended at 73\.8% over 41,405 decided matches\./);
    // Live selected: last season has no live record, so the comparison says it's the replay.
    fireEvent.click(card.getByRole("button", { name: /Logged live/ }));
    expect(card.getByRole("note").textContent).toMatch(/2025–26's season replay ended at 73\.8%/);
  });

  it("opens on the headline (the replay while live is still calibrating) and titles it as a replay", async () => {
    data = RECORD;
    const card = within(await mount());
    expect(card.getByText("Season replay, scored")).toBeTruthy();
    expect(card.queryByText(/Every match prediction this site made/)).toBeNull();
    expect(card.getByText(/Season replay · not calls made in advance · the headline/)).toBeTruthy();
    expect(card.getByText("The headline is the 2025–26 DECODE replay, the newest with at least 10,000 replayed matches. Live calls take over once a season has 10,000 scored (2026–27 BIOBUZZ: 33 so far).", { exact: false })).toBeTruthy();
  });

  it("titles live numbers as live calls, shows each mode's sample size, and the replay's coverage", async () => {
    data = RECORD;
    const card = within(await mount());
    fireEvent.click(card.getByRole("button", { name: /^2026–27$/ }));
    // Same season, replay still selected: 207 of 231, and why the other 24 aren't in it.
    expect(card.getByText("207 of 231 scored matches replayed.")).toBeTruthy();
    expect(card.getByText(/24 skipped because an alliance didn't have two robots on the field/)).toBeTruthy();
    expect(card.getByText("126 right, 72 missed", { exact: false })).toBeTruthy();
    expect(card.getByRole("button", { name: /^Logged live\s*33$/ })).toBeTruthy();
    expect(card.getByRole("button", { name: /^Season replay\s*207$/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card.getByRole("button", { name: /^Logged live/ }));
    expect(card.getByText("Live calls, logged before each match")).toBeTruthy();
    expect(card.getByText(/Logged live · still calibrating/)).toBeTruthy(); // 33 of 10,000: not yet the headline
    expect(card.getByText("16 right, 17 missed", { exact: false })).toBeTruthy();
    expect(card.queryByText(/scored matches replayed/)).toBeNull();
  });

  it("says when the ledger was last scored: relative, with the exact time", async () => {
    const generatedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    data = { ...RECORD, generatedAt };
    const card = within(await mount());
    const stamp = card.getByText(/^Updated 3 h ago \(/);
    const time = stamp.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(generatedAt);
    expect(time.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M$/);
  });

  it("names every 2025–26 match count with what it counts, once", async () => {
    data = RECORD;
    await mount();
    expect(document.getElementById("match-counts")!.textContent).toBe("Match counts on this page: 37,395 in this held-out test; 37,414 in the Prediction Engine 2.0 replay of the whole 2025–26 season, 37,140 of them with a winner (the rest were ties). They are separate tests with their own match lists, so the counts differ slightly.");
  });

  it("shows no percentage and no skill when nothing was decided", async () => {
    data = { ...RECORD, headline: null, seasons: [{ season: 2026, label: "2026–27 BIOBUZZ", live: blk(2, 0, 0, 0, 0), backtest: null }] } satisfies TrackRecord;
    const card = within(await mount());
    expect(card.getByText(/no decided match yet/)).toBeTruthy();
    expect(card.getAllByText("—")).toHaveLength(2);
    expect(card.queryByText("0.0%")).toBeNull();
  });
});
