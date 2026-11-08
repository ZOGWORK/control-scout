// @vitest-environment jsdom
// The answer's season picker (./SeasonPick.tsx): the chip opens the subject's seasons, newest first, and a pick asks
// the same query about that season.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnswerSeason, SeasonPickContext, pickedSeason, seasonChoices, type SeasonPick } from "./SeasonPick";

afterEach(cleanup);

// Radix Select measures and captures the pointer: jsdom has neither.
Object.assign(window.HTMLElement.prototype, { scrollIntoView() {}, hasPointerCapture: () => false, releasePointerCapture() {} });

const on = (ctx: Partial<SeasonPick> = {}) => ({ picked: null, pending: false, pick: vi.fn(), ...ctx });

describe("the seasons offered", () => {
  it("are the subject's own, the shown one among them, newest first", () => {
    expect(seasonChoices(2024, [2022, 2025, 2023], [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026])).toEqual([2025, 2024, 2023, 2022]);
  });
  it("are every season held for an answer about no team", () => {
    expect(seasonChoices(2025, null, [2023, 2024, 2025, 2026])).toEqual([2026, 2025, 2024, 2023]);
  });
});

describe("the picked season in the address", () => {
  it("is a season the app holds, else none", () => {
    expect(pickedSeason("2024", [2023, 2024])).toBe(2024);
    expect(pickedSeason("2031", [2023, 2024])).toBeNull();
    expect(pickedSeason("abc", [2024])).toBeNull();
    expect(pickedSeason(null, [2024])).toBeNull();
  });
});

describe("AnswerSeason", () => {
  it("is the plain chip away from /search", () => {
    render(<AnswerSeason season={2025} seasons={[2025, 2024]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("2025–26")).toBeTruthy();
  });

  it("is a labelled control on /search that opens the seasons and picks one", () => {
    const ctx = on();
    render(<SeasonPickContext.Provider value={ctx}><AnswerSeason season={2025} seasons={[2023, 2025, 2024]} /></SeasonPickContext.Provider>);
    const chip = screen.getByRole("combobox", { name: "Season: 2025–26. Change season" });
    fireEvent.pointerDown(chip, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.keyDown(chip, { key: "Enter" });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.getAttribute("data-season-option"))).toEqual(["2025", "2024", "2023"]);
    fireEvent.click(screen.getByRole("option", { name: /2023–24/ }));
    expect(ctx.pick).toHaveBeenCalledWith(2023);
  });

  it("shows the pick at once while its answer is on the way", () => {
    render(<SeasonPickContext.Provider value={on({ picked: 2023, pending: true })}><AnswerSeason season={2025} /></SeasonPickContext.Provider>);
    expect(screen.getByRole("combobox").textContent).toContain("2023–24");
  });

  it("waits for the team's seasons before it opens", () => {
    render(<SeasonPickContext.Provider value={on()}><AnswerSeason season={2025} waiting /></SeasonPickContext.Provider>);
    expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
  });
});
