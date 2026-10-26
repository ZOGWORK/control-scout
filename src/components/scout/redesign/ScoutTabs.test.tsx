// @vitest-environment jsdom
// The Scout sections are the app's tab list: three tabs, one tab stop, arrows and Home/End move and select,
// the selected section's content is the panel, and URL values parse.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseScoutTab, ScoutTabs, type ScoutTab } from "./ScoutTabs";

afterEach(cleanup);

function Harness({ start = "match" as ScoutTab, spy = vi.fn() }) {
  const [tab, setTab] = useState<ScoutTab>(start);
  return <ScoutTabs tab={tab} onTab={(t) => { spy(t); setTab(t); }}><p>Panel {tab}</p></ScoutTabs>;
}
const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!.textContent;
// Radix moves focus on the next tick, and selects the tab that takes it.
const key = async (k: string, to: string) => { fireEvent.keyDown(document.activeElement!, { key: k }); await waitFor(() => expect(selected()).toBe(to)); };

describe("ScoutTabs", () => {
  it("renders three tabs, the other two out of the tab order, and the selected one's panel", () => {
    render(<Harness start="matches" />);
    expect(screen.getByRole("tablist", { name: "Scout sections" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Match", "Matches", "Data"]);
    expect([tabs[0], tabs[2]].map((t) => t.tabIndex)).toEqual([-1, -1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toBe("Panel matches");
    expect(tabs[1].getAttribute("aria-controls")).toBe(panel.id);
  });
  it("arrow keys wrap, Home and End jump, and the selection follows focus", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    screen.getByRole("tab", { name: "Match" }).focus();
    await key("ArrowRight", "Matches");
    await key("ArrowRight", "Data");
    await key("ArrowRight", "Match");
    await key("ArrowLeft", "Data");
    await key("Home", "Match");
    await key("End", "Data");
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["matches", "data", "match", "data", "match", "data"]);
    expect(document.activeElement?.textContent).toBe("Data");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel data");
  });
  it("a click selects", () => {
    render(<Harness />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Data" }), { button: 0 });
    expect(selected()).toBe("Data");
  });
  it("parses the URL value, falling back to Match", () => {
    expect(parseScoutTab("data")).toBe("data");
    expect(parseScoutTab("matches")).toBe("matches");
    expect(parseScoutTab("Data")).toBe("match");
    expect(parseScoutTab(null)).toBe("match");
    expect(parseScoutTab("constructor")).toBe("match");
  });
});
