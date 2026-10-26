// @vitest-environment jsdom
// The top bar's session chip says the event and what's watched, colours its dot by alliance, and opens setup.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScoutTopBar, sessionDotClass } from "./ScoutTopBar";

afterEach(cleanup);

describe("ScoutTopBar", () => {
  it("shows the session and opens setup", () => {
    const onChange = vi.fn();
    render(<ScoutTopBar eventCode="USNJQ1" watching={{ kind: "alliance", side: "red" }} onChangeSession={onChange} actions={<span>Synced</span>}><span>Switcher</span></ScoutTopBar>);
    expect(screen.getByRole("heading", { level: 1, name: "Scout" })).toBeTruthy();
    const chip = screen.getByRole("button", { name: "Scouting USNJQ1, Red alliance. Change event or teams" });
    expect(chip.textContent).toContain("USNJQ1 · Red alliance");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByText("Synced")).toBeTruthy();
    expect(screen.getByText("Switcher")).toBeTruthy();
  });
  it("asks for an event when there is no session", () => {
    render(<ScoutTopBar eventCode={null} watching={null} onChangeSession={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pick an event and teams to scout" }).textContent).toContain("Pick an event");
  });
  it("colours the dot by what's watched", () => {
    expect(sessionDotClass({ kind: "alliance", side: "red" })).toBe("bg-red-alliance");
    expect(sessionDotClass({ kind: "alliance", side: "blue" })).toBe("bg-blue-alliance");
    expect(sessionDotClass({ kind: "slot", slot: "blue2" })).toBe("bg-blue-alliance");
    expect(sessionDotClass({ kind: "slot", slot: "red1" })).toBe("bg-red-alliance");
    expect(sessionDotClass({ kind: "all" })).toContain("linear-gradient");
    expect(sessionDotClass(null)).toContain("muted");
  });
});
