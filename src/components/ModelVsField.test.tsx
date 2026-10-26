// @vitest-environment jsdom
// Model vs field on the Rankings tab: model calls with their evidence and confidence tier, worded as calls
// (never verdicts), the track record linked as its credibility, and the reason when nothing is shown.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RULES, type DisagreementRow, type DisagreementsView } from "../shared/disagreements";
import { ModelVsField, ordinal } from "./ModelVsField";

const row = (team: number, o: Partial<DisagreementRow> = {}): DisagreementRow => ({
  team, name: `Team ${team}`, direction: "model-higher", modelPlace: 3, seedPlace: 18, gap: 15, seed: { rank: 18, of: 24, event: null },
  rating: { np: 91.2, sd: 3.2, matches: 14 }, slotRating: 61.4, margin: 29.8, z: 6.6, opr: 88.4, oprKind: "event",
  record: { wins: 3, losses: 3, ties: 0 }, rp: 1.8, tier: "confident", reason: "r", ...o,
});
const view = (o: Partial<DisagreementsView> = {}): DisagreementsView => ({
  season: 2025, code: "X", mode: "quals", ratingsAsOf: "now", compared: 24, fieldSize: 24, hidden: null, rows: [], rules: { ...RULES, minGap: 5 }, ...o,
});

let answers: Record<string, unknown>;
beforeEach(() => {
  answers = {};
  vi.stubGlobal("fetch", async (path: string) => {
    const body = answers[path.split("?")[0]];
    return new Response(JSON.stringify(body ?? { error: "not found" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (code: string, v: DisagreementsView) => {
  answers[`/api/events/2025/${code}/disagreements`] = { ...v, code };
  render(<MemoryRouter><ModelVsField season={2025} code={code} /></MemoryRouter>);
};

describe("ModelVsField", () => {
  it("states each call with its numbers and tier, as a call, not a verdict", async () => {
    show("A", view({ rows: [row(18), row(2, { direction: "seed-higher", modelPlace: 14, seedPlace: 2, seed: { rank: 2, of: 24, event: null }, tier: "moderate" })] }));
    expect(await screen.findByText(/The model rates them #3 of 24; they're/)).toBeTruthy();
    expect(screen.getByText(/the model rates them #14 of 24/)).toBeTruthy();
    expect(screen.getByText("The model rates them higher than their seed")).toBeTruthy();
    expect(screen.getByText("Seeded higher than the model rates them")).toBeTruthy();
    expect(screen.getAllByText("91.2 ± 3.2")).toHaveLength(2);
    expect(screen.getAllByText(/solid|fair/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Current seeding")).toBeTruthy();
    const text = document.body.textContent!.toLowerCase();
    for (const w of ["overrated", "underrated", "underperform", "overperform"]) expect(text).not.toContain(w);
    expect(screen.getByRole("link", { name: /Track record/ }).getAttribute("href")).toBe("/methodology#accuracy");
  });

  it("before quals, names the last event the seed comes from", async () => {
    show("B", view({ mode: "pre-quals", rows: [row(7, { seed: { rank: 20, of: 22, event: { code: "P1", name: "Valley Qualifier" } }, oprKind: "season", record: null, rp: null })] }));
    expect(await screen.findByText(/Before quals: seeds from each team's last event/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Valley Qualifier" }).getAttribute("href")).toBe("/events/2025/P1");
    expect(screen.getByText(/Season OPR/)).toBeTruthy();
  });

  it("shows three per side, the rest behind a button", async () => {
    show("C", view({ rows: [1, 2, 3, 4, 5].map((t) => row(t)) }));
    await screen.findByText("Team 1");
    expect(screen.queryByText("Team 4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show 2 more/ }));
    expect(screen.getByText("Team 5")).toBeTruthy();
  });

  it("says why nothing is shown", async () => {
    show("D", view({ hidden: "Only 8 teams here: too small a field for gaps in the order to mean much." }));
    expect(await screen.findByText(/too small a field/)).toBeTruthy();
  });

  it("says when the order and the seeding agree", async () => {
    show("E", view());
    expect(await screen.findByText(/agree here/)).toBeTruthy();
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});
