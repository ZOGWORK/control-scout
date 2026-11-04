// @vitest-environment jsdom
// Swing (the consistency stat) is a score stat outside the part × aggregate grid: the picker still shows it as its own
// row, in seasons with and without predictions, and picking it picks "swing".
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatPicker } from "./StatPicker";

afterEach(cleanup);

describe("StatPicker: Swing", () => {
  for (const scope of ["teamEvent", "teamSeason"] as const) {
    for (const predictable of [true, false]) {
      it(`renders a Swing row for ${scope} (predictions ${predictable ? "on" : "off"})`, () => {
        const onPick = vi.fn();
        render(<StatPicker scope={scope} predictable={predictable} mode="multi" selected={new Set()} onPick={onPick} />);
        const section = screen.getByRole("region", { name: "Score Stats" });
        const row = Array.from(section.querySelectorAll("button")).find((b) => b.textContent?.includes("Swing (consistency)"));
        expect(row).toBeTruthy();
        fireEvent.click(row!);
        expect(onPick).toHaveBeenCalledWith("swing");
      });
    }
  }
});
