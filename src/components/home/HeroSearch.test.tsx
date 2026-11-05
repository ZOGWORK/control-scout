// @vitest-environment jsdom
// Home's search block: it says any search works, the chips are this UTC hour's six (and change on the hour), the
// placeholder walks through the ones that fit it (holding while the field has focus, and never moving under reduced
// motion), each chip runs its own full query on /search, and Enter on an empty field never searches for the example
// showing in it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RECENT_KEY } from "../search/discover";
import { SUGGESTION_HOUR_MS, placeholderable, suggestionLabel, suggestionsAt } from "../../shared/homeSuggestions";
import { HERO_EXAMPLE_MS, HeroSearch, heroPlaceholder } from "./HeroSearch";

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

/** A fixed hour, so the six are known. */
const HOUR = Date.UTC(2026, 10, 4, 15, 20);
const six = () => suggestionsAt(HOUR);
const typeable = () => six().filter(placeholderable);
const chips = () => [...screen.getByRole("list", { name: "Example searches" }).querySelectorAll("button")];

beforeEach(() => { reduced = false; localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(HOUR); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("HeroSearch", () => {
  it("lets the field speak for itself: no heading, tag or line of copy around it", () => {
    show();
    expect(screen.getByRole("region", { name: "Search" })).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("Type whatever you want")).toBeNull();
    expect(screen.queryByText("FTC One Search")).toBeNull();
    // The field names itself, and the line that used to sit above it is gone too.
    expect(screen.getByLabelText("Search teams, events and matches")).toBe(field());
    expect(screen.queryByText("Search teams, events, matches, predictions, and records.")).toBeNull();
  });

  it("shows this hour's six, by their short labels, and the next hour's six once the hour turns", () => {
    show();
    expect(chips().map((b) => b.textContent)).toEqual(six().map(suggestionLabel));
    const next = suggestionsAt(HOUR + SUGGESTION_HOUR_MS);
    act(() => { vi.advanceTimersByTime(SUGGESTION_HOUR_MS); });
    expect(chips().map((b) => b.textContent)).toEqual(next.map(suggestionLabel));
  });

  it("cycles the placeholder through the six it can show, and holds while the field has focus", () => {
    expect(typeable().length).toBeGreaterThan(1);
    show();
    const [a, b] = typeable();
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(a));
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(b));
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * (typeable().length - 1)); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(a));
    fireEvent.focus(field());
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * 3); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(a));
    fireEvent.blur(field());
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(b));
  });

  it("never moves under reduced motion", () => {
    reduced = true;
    show();
    act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * 4); });
    expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(typeable()[0]));
  });

  it("runs a chip's full query when it is tapped, not its short label", () => {
    show();
    expect(chips()).toHaveLength(6);
    const board = six().find((s) => s.kind === "leaderboard")!;
    fireEvent.click(screen.getByRole("button", { name: `Leaderboard: search “${board.q}”` }));
    expect(screen.getByTestId("at").textContent).toBe(`/search?q=${encodeURIComponent(board.q)}`);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toContain(board.q);
  });

  it("never searches for the example in the placeholder", () => {
    show();
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByTestId("at").textContent).toBe("/");
  });
});
