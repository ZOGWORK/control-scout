// @vitest-environment jsdom
// Home's search block: it says any search works, the placeholder walks through the examples (holding while the
// field has focus, and never moving under reduced motion), each example chip runs its own query on /search, and
// Enter on an empty field never searches for the example showing in it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RECENT_KEY } from "../search/discover";
import { HERO_EXAMPLES, HERO_EXAMPLE_MS, HeroSearch, heroPlaceholder } from "./HeroSearch";

let reduced = false;
vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => reduced }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: null, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  apiFetch: () => new Promise(() => {}),
  useApi: () => ({ data: undefined, error: undefined, loading: true, reload: () => {} }),
}));

function Where() { const l = useLocation(); return <output data-testid="at">{l.pathname + l.search}</output>; }
const show = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <HeroSearch inputRef={null} onEscape={() => {}} hint="Ctrl K" />
    <Where />
  </MemoryRouter>,
);
const field = () => screen.getByRole("combobox");

beforeEach(() => { reduced = false; localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("HeroSearch", () => {
  it("lets the field speak for itself: no heading, tag or line of copy around it", () => {
    show();
    expect(screen.getByRole("region", { name: "Search" })).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("Type whatever you want")).toBeNull();
    expect(screen.queryByText("FTC One Search")).toBeNull();
    expect(field().getAttribute("aria-label") ?? screen.getByLabelText("Search teams, events and matches")).toBeTruthy();
  });

  it("cycles the placeholder through every example, and holds while the field has focus", () => {
    show();
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(0));
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(1));
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * (HERO_EXAMPLES.length - 1)); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(0));
    fireEvent.focus(field());
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * 3); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(0));
    fireEvent.blur(field());
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(1));
  });

  it("never moves under reduced motion", () => {
    reduced = true;
    show();
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * 4); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(0));
  });

  it("runs an example's query when its chip is tapped", () => {
    show();
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.querySelectorAll("button")).toHaveLength(HERO_EXAMPLES.length);
    const { q } = HERO_EXAMPLES[1];
    fireEvent.click(screen.getByRole("button", { name: `Versus: search “${q}”` }));
    expect(screen.getByTestId("at").textContent).toBe(`/search?q=${encodeURIComponent(q)}`);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toContain(q);
  });

  it("never searches for the example in the placeholder", () => {
    show();
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByTestId("at").textContent).toBe("/");
  });
});
