// @vitest-environment jsdom
// Assign teams' event field: type a name, pick from that season's events (by keyboard or pointer), and
// the chosen event shows by name; "Change event" clears it. A default code shows its event's name.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventListItem } from "../../shared/api";

const EVENTS = [
  { code: "USNJBRQ", name: "Bergen Qualifier", start: "2026-11-08", end: "2026-11-08", city: "Oradell", state: "NJ" },
  { code: "USNJSPQ", name: "Spring Valley Qualifier", start: "2026-12-06", end: "2026-12-06", city: "Princeton", state: "NJ" },
  { code: "USNYQ2", name: "Big Apple Qualifier", start: "2026-11-15", end: "2026-11-15", city: "New York", state: "NY" },
] as unknown as EventListItem[];
const calls: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  apiFetch: async (url: string) => {
    calls.push(url);
    const q = (new URL(url, "http://x").searchParams.get("q") ?? "").toLowerCase();
    return { events: EVENTS.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.city ?? "").toLowerCase().includes(q)) };
  },
}));

const { EventPicker, EVENT_SEARCH_DEBOUNCE } = await import("./EventPicker");
let value = "";
function Harness({ start = "" }: { start?: string }) {
  const [code, setCode] = useState(start);
  value = code;
  return <EventPicker id="ev" season={2026} code={code} onChange={setCode} />;
}
const settle = () => act(async () => { vi.advanceTimersByTime(EVENT_SEARCH_DEBOUNCE + 10); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers(); calls.length = 0; value = ""; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("EventPicker", () => {
  it("finds events by name in the season and picks one with the keyboard", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "qualifier" } });
    await settle();
    expect(calls.at(-1)).toContain("season=2026");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Bergen Qualifier"), expect.stringContaining("Big Apple Qualifier"), expect.stringContaining("Spring Valley Qualifier"),
    ]);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(value).toBe("USNYQ2");
    expect(screen.getByText("Big Apple Qualifier")).toBeTruthy();
  });

  it("puts names that start with the text first, and picks with the pointer", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "spring" } });
    await settle();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Spring Valley Qualifier/ }));
    expect(value).toBe("USNJSPQ");
  });

  it("doesn't turn an unmatched word into an event code", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "nowhere" } });
    await settle();
    expect(screen.getByText(/No 2026 event matches/)).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(value).toBe("");
  });

  it("shows a default code's event by name, and Change event clears it", async () => {
    render(<Harness start="USNJBRQ" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("Bergen Qualifier")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change event" }));
    expect(value).toBe("");
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
