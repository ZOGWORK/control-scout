// @vitest-environment jsdom
// Official result changes: the timeline on the event's Matches tab and in a match's details — old → new values,
// source, when the sync saw it, a link to the exact match, and honest empty / not-tracked-yet states.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResultChange, ResultChangesView, ResultScoreSide } from "../shared/api";
import { ResultChanges } from "./ResultChanges";

const S = 2025;
const side = (total: number, o: Partial<ResultScoreSide> = {}): ResultScoreSide => ({ total, np: total - 5, auto: 20, teleop: total - 40, endgame: 15, pen: 5, tips: null, bonus: { movement: true, goal: false, pattern: false }, ...o });
const labels = { total: "Total", pen: "Penalty points given away", teleop: "TeleOp (without base)", "bonus.goal": "Goal RP", dq: "Disqualified teams", time: "Scheduled time", field: "Field", red: "Red alliance", blue: "Blue alliance" };

const posted: ResultChange = { id: 3, kind: "posted", match: { key: "qual:0:4", label: "Q4" }, fields: [], before: null, after: { red: side(120), blue: side(98), dq: [] }, source: "first", prevSource: "first", checkedAt: "2026-11-07T15:05:00.000Z" };
const revised: ResultChange = {
  id: 2, kind: "revised", match: { key: "qual:0:2", label: "Q2" }, fields: ["red.total", "red.pen", "blue.bonus.goal", "dq"],
  before: { red: side(100), blue: side(90), dq: [] }, after: { red: side(110, { pen: 0 }), blue: side(90, { bonus: { movement: true, goal: true, pattern: false } }), dq: [204] },
  source: "first", prevSource: "ftc-scout", checkedAt: "2026-11-07T15:04:00.000Z",
};
const moved: ResultChange = {
  id: 1, kind: "schedule", match: { key: "qual:0:9", label: "Q9" }, fields: ["field", "red"],
  before: { time: "2026-11-07T10:00:00", field: "1", red: [201, 202], blue: [203, 204] }, after: { time: "2026-11-07T10:00:00", field: "2", red: [201, 205], blue: [203, 204] },
  source: "first", prevSource: "first", checkedAt: "2026-11-07T15:00:00.000Z",
};
const view = (code: string, changes: ResultChange[], o: Partial<ResultChangesView> = {}): ResultChangesView => ({
  season: S, code, match: null, trackedSince: "2026-11-07T14:00:00.000Z", lastChecked: "2026-11-07T15:05:00.000Z", labels, changes, cap: 500, pruned: 0, ...o,
});

let answers: Record<string, ResultChangesView>;
let asked: string[];
beforeEach(() => {
  answers = {}; asked = [];
  vi.stubGlobal("fetch", async (path: string) => {
    asked.push(path);
    const body = answers[path];
    return new Response(JSON.stringify(body ?? { error: "not found" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (code: string, matchKey?: string) => render(<MemoryRouter><ResultChanges season={S} code={code} matchKey={matchKey} /></MemoryRouter>);

describe("ResultChanges", () => {
  it("lists an event's changes with old → new values, source, time seen and a link to the exact match", async () => {
    answers[`/api/events/${S}/EVA/result-changes`] = view("EVA", [posted, revised, moved]);
    show("EVA");
    const region = await screen.findByRole("region", { name: "Result changes" });
    const items = await within(region).findAllByRole("listitem");
    expect(items).toHaveLength(3);

    expect(within(items[0]).getByText("Result posted")).toBeTruthy();
    expect(within(items[0]).getByRole("link", { name: "Match Q4" }).getAttribute("href")).toBe(`/events/${S}/EVA?tab=matches&match=qual%3A0%3A4`);
    expect(items[0].textContent).toContain("120 – 98");

    const rev = items[1];
    expect(within(rev).getByText("Score revised")).toBeTruthy();
    expect(within(rev).getByText("Red total")).toBeTruthy();
    expect(within(rev).getByText("Red penalty points given away")).toBeTruthy();
    expect(within(rev).getByText("Blue Goal RP")).toBeTruthy();
    expect(within(rev).getByText("Disqualified teams")).toBeTruthy();
    const total = within(rev).getByText("Red total").nextElementSibling!;
    expect(total.textContent).toBe("100changed to110");
    expect(within(rev).getByText("Blue Goal RP").nextElementSibling!.textContent).toBe("not earnedchanged toearned");
    expect(within(rev).getByText("Disqualified teams").nextElementSibling!.textContent).toBe("nonechanged to204");
    expect(rev.textContent).toContain("FIRST Events API (was FTC Scout (fallback))");
    expect(within(rev).getByText((_, el) => el?.tagName === "TIME" && el.getAttribute("datetime") === "2026-11-07T15:04:00.000Z")).toBeTruthy();

    const sched = items[2];
    expect(within(sched).getByText("Schedule changed")).toBeTruthy();
    expect(within(sched).getByText("Field").nextElementSibling!.textContent).toBe("1changed to2");
    expect(within(sched).getByText("Red alliance").nextElementSibling!.textContent).toBe("201, 202changed to201, 205");
    expect(region.textContent).toContain("not tracked before then");
  });

  it("says when nothing changed, and when the event isn't tracked yet", async () => {
    answers[`/api/events/${S}/EVB/result-changes`] = view("EVB", []);
    answers[`/api/events/${S}/EVC/result-changes`] = view("EVC", [], { trackedSince: null });
    show("EVB");
    expect((await screen.findByText(/^No changes recorded since/)).textContent).toMatch(/^No changes recorded since .*2026\.$/);
    cleanup();
    show("EVC");
    expect(await screen.findByText("No changes recorded.")).toBeTruthy();
    expect(screen.getByText(/Not tracked yet/)).toBeTruthy();
  });

  it("shows the first few and expands to all, and says when old changes were dropped", async () => {
    const many = Array.from({ length: 11 }, (_, i): ResultChange => ({ ...posted, id: 100 - i, match: { key: `qual:0:${i + 1}`, label: `Q${i + 1}` } }));
    answers[`/api/events/${S}/EVD/result-changes`] = view("EVD", many, { pruned: 3 });
    show("EVD");
    expect(await screen.findAllByRole("listitem")).toHaveLength(8);
    const more = screen.getByRole("button", { name: "Show all 11 changes" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/3 older ones were dropped/)).toBeTruthy();
  });

  it("asks for one match's changes in match details, without linking to itself", async () => {
    answers[`/api/events/${S}/EVE/matches/qual:0:2/result-changes`] = view("EVE", [revised], { match: "qual:0:2" });
    show("EVE", "qual:0:2");
    expect(await screen.findByText("Score revised")).toBeTruthy();
    expect(asked).toEqual([`/api/events/${S}/EVE/matches/qual:0:2/result-changes`]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Q2")).toBeTruthy();
  });

  it("shows a withdrawn result with what it was", async () => {
    const withdrawn: ResultChange = { ...revised, fields: ["result"], after: null };
    answers[`/api/events/${S}/EVF/result-changes`] = view("EVF", [withdrawn]);
    show("EVF");
    expect((await screen.findByText(/Result withdrawn/)).textContent).toBe("Result withdrawn (was 100 – 90)");
  });
});
