// @vitest-environment jsdom
// Settings › Appearance › Phone tab bar: the switches hold the 2–5 limits, the arrows reorder, the preview
// follows, and Reset goes back to the default.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TAB_KEY } from "../../lib/tabBar";

vi.mock("../../lib/yoursRow", () => ({ useYoursRow: () => ({ row: { to: "/my-team", label: "My team" }, active: false }) }));
const { TabBarSettings } = await import("./TabBarSettings");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const preview = () => within(screen.getByRole("list", { name: "Tab bar preview" })).getAllByRole("listitem").map((li) => li.textContent);
const sw = (name: string) => screen.getByRole("switch", { name });

describe("Phone tab bar settings", () => {
  it("shows the default, says it's kept on this device and that the menu has every page", () => {
    render(<TabBarSettings />);
    expect(preview()).toEqual(["Home", "Events", "Predict", "My team", "Scout"]);
    expect(screen.getByText(/Kept on this device only/)).toBeTruthy();
    expect(screen.getByText(/always in the menu behind the top-left button/)).toBeTruthy();
  });

  it("a full bar locks the switches that are off; removing one frees them", () => {
    render(<TabBarSettings />);
    expect((sw("Teams") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sw("Events"));
    expect(preview()).toEqual(["Home", "Predict", "My team", "Scout"]);
    expect((sw("Teams") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sw("Teams"));
    expect(preview()).toEqual(["Home", "Predict", "My team", "Scout", "Teams"]);
    expect(JSON.parse(localStorage.getItem(TAB_KEY)!)).toEqual(["home", "predict", "myTeam", "scout", "teams"]);
  });

  it("two pages left: their switches are locked on", () => {
    localStorage.setItem(TAB_KEY, JSON.stringify(["home", "scout"]));
    render(<TabBarSettings />);
    expect((sw("Home") as HTMLButtonElement).disabled).toBe(true);
    expect((sw("Scout") as HTMLButtonElement).disabled).toBe(true);
    expect((sw("Events") as HTMLButtonElement).disabled).toBe(false);
  });

  it("the arrows move a page, and do nothing at the ends", () => {
    render(<TabBarSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Move Scout left" }));
    expect(preview()).toEqual(["Home", "Events", "Predict", "Scout", "My team"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Home left" }));
    expect(preview()[0]).toBe("Home");
    expect(screen.getByRole("status").textContent).toBe("Scout moved to place 4 of 5.");
  });

  it("Reset to default", () => {
    localStorage.setItem(TAB_KEY, JSON.stringify(["teams", "rankings"]));
    render(<TabBarSettings />);
    fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
    expect(preview()).toEqual(["Home", "Events", "Predict", "My team", "Scout"]);
    expect(localStorage.getItem(TAB_KEY)).toBeNull();
  });
});
