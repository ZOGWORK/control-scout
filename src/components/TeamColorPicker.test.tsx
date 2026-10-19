// @vitest-environment jsdom
// The shortlist's colour dot: pick a colour from the palette, change it, or clear it; the choice is
// saved to the personal teamColors key.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let colors: Record<string, string> = {};
const update = vi.fn((key: string, fn: (prev: Record<string, string>) => Record<string, string>) => { if (key === "teamColors") colors = fn(colors); return true; });
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { teamColors: colors }, update }) }));

const { TeamColorPicker } = await import("./TeamColorPicker");
afterEach(() => { cleanup(); colors = {}; update.mockClear(); });

describe("TeamColorPicker", () => {
  it("gives a team a colour, and clears it", () => {
    const { rerender } = render(<TeamColorPicker team={4215} />);
    fireEvent.click(screen.getByRole("button", { name: "Give 4215 a colour" }));
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    expect(colors).toEqual({ "4215": "teal" });
    rerender(<TeamColorPicker team={4215} />);
    expect(screen.getByRole("button", { name: "4215's colour: Teal. Change it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No colour" }));
    expect(colors).toEqual({});
  });

  it("is a radio group, and No colour hands focus to the palette as it goes away", async () => {
    colors = { "7": "gold" };
    render(<TeamColorPicker team={7} />);
    fireEvent.click(screen.getByRole("button", { name: "7's colour: Gold. Change it" }));
    expect(screen.getByRole("radiogroup", { name: "7's colour" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Gold" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "No colour" }));
    expect(colors).toEqual({});
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement?.getAttribute("role")).toBe("radio");
  });

  it("is one Tab stop, with arrow keys moving across and down the grid", () => {
    render(<TeamColorPicker team={16} />);
    fireEvent.click(screen.getByRole("button", { name: "Give 16 a colour" }));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(8);
    // Roving focus: only one colour is in the tab order.
    expect(radios.filter((r) => r.getAttribute("tabindex") !== "-1")).toHaveLength(1);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[5]);
    fireEvent.keyDown(radios[5], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radios[4]);
  });
});
