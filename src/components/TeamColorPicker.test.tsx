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
});
