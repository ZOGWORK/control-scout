// @vitest-environment jsdom
// Home's search block: it says any search works, the chips are this UTC hour's six (and change on the hour), the
// placeholder walks through the ones that fit it (holding while the field has focus, and never moving under reduced
// motion), each chip runs its own full query on /search, and Enter on an empty field never searches for the example
// showing in it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RECENT_KEY } from "../search/discover";
import { HOME_SUGGESTIONS, SUGGESTION_HOUR_MS, fitChips, placeholderable, suggestionLabel, suggestionsAt, teamSuggestions } from "../../shared/homeSuggestions";
import { ACCOUNT_WAIT_MS, HERO_EXAMPLE_MS, HeroSearch, heroPlaceholder } from "./HeroSearch";

let reduced = false;
let myTeam: number | null = null;
let summary: { data?: unknown; error?: Error; loading: boolean } = { loading: true };
const asked: (string | null)[] = [];
vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => reduced }));
type Account = { here: boolean; syncReady: boolean; user: { id: number } | null; providers: object | null; offlineAccount?: boolean; sync?: string };
let account: Account = { here: false, syncReady: false, user: null, providers: null };
vi.mock("../../lib/personal", () => ({
  hasAccountOnDevice: () => account.here,
  usePersonal: () => ({ user: account.user, providers: account.providers, syncReady: account.syncReady, offlineAccount: account.offlineAccount ?? false, sync: account.sync ?? "local", state: { myTeam, tracked: { teams: [], events: [] }, bookmarks: [] } }),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  apiFetch: () => new Promise(() => {}),
  useApi: (path: string | null) => {
    asked.push(path);
    if (path?.startsWith("/api/teams-summary")) return { ...summary, reload: () => {} };
    return { data: undefined, error: undefined, loading: !!path, reload: () => {} };
  },
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

beforeEach(() => { reduced = false; myTeam = null; account = { here: false, syncReady: false, user: null, providers: null }; summary = { loading: true }; asked.length = 0; localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(HOUR); });
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

  it("names no team in its chips and placeholder, all day, for a visitor with no team of their own", () => {
    const teams = (text: string) => text.match(/(?<!\bover )\b\d{3,5}\b(?!\+)/g) ?? [];
    show();
    expect(asked.some((p) => p?.startsWith("/api/teams-summary"))).toBe(false);
    for (let h = 0; h < 24; h++) {
      const shown = [...chips().map((b) => b.textContent ?? ""), field().getAttribute("placeholder") ?? ""];
      expect(shown.flatMap(teams), shown.join(" | ")).toEqual([]);
      act(() => { vi.advanceTimersByTime(SUGGESTION_HOUR_MS); });
    }
  });

  it("with My team set: two chips about that team, by number and name, among the pool's, and they run by number", () => {
    myTeam = 4215;
    summary = { loading: false, data: { teams: [{ team: 4215, name: "Hypnotic Robotics" }] } };
    show();
    expect(asked.some((p) => p?.startsWith("/api/teams-summary") && p.includes("teams=4215"))).toBe(true);
    const want = suggestionsAt(HOUR, HOME_SUGGESTIONS, teamSuggestions(4215, "Hypnotic Robotics"));
    expect(chips().map((b) => b.textContent)).toEqual(want.map(suggestionLabel));
    const own = want.filter((s) => s.mine);
    expect(own).toHaveLength(2);
    for (const s of own) expect(suggestionLabel(s)).toMatch(/^4215 Hypnotic/);
    fireEvent.click(chips()[want.indexOf(own[0])]);
    expect(screen.getByTestId("at").textContent).toBe(`/search?q=${encodeURIComponent(own[0].q)}`);
    expect(own[0].q).toMatch(/\b4215\b/);
  });

  it("with My team set, holds the chips' rows hidden until the team's name is in, then draws them once", () => {
    myTeam = 4215;
    const { rerender } = show();
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.className).toContain("invisible");
    expect(list.getAttribute("aria-busy")).toBe("true");
    summary = { loading: false, data: { teams: [{ team: 4215, name: "Hypnotic Robotics" }] } };
    rerender(<MemoryRouter initialEntries={["/"]}><HeroSearch inputRef={null} onEscape={() => {}} hint="Ctrl K" /><Where /></MemoryRouter>);
    expect(list.className).not.toContain("invisible");
    expect(list.getAttribute("aria-busy")).toBeNull();
    expect(chips().some((b) => b.textContent?.startsWith("4215 Hypnotic"))).toBe(true);
  });

  it("on a device synced with an account, holds the chips until the account's copy is in, so its My team draws once", () => {
    account = { here: true, syncReady: false, user: { id: 7 }, providers: {} };
    const again = () => rerender(<MemoryRouter initialEntries={["/"]}><HeroSearch inputRef={null} onEscape={() => {}} hint="Ctrl K" /><Where /></MemoryRouter>);
    const { rerender } = show();
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.className).toContain("invisible");
    // The account's copy arrives with a My team: the chips draw once, with that team's among them.
    account = { ...account, syncReady: true };
    myTeam = 4215;
    summary = { loading: false, data: { teams: [{ team: 4215, name: "Hypnotic Robotics" }] } };
    again();
    expect(list.className).not.toContain("invisible");
    expect(chips().some((b) => b.textContent?.startsWith("4215 Hypnotic"))).toBe(true);
  });

  it("once drawn, never hides: My team set later (or a sign-in bringing one) keeps the chips until its name is in, then swaps them once", () => {
    const { rerender } = show();
    const again = () => rerender(<MemoryRouter initialEntries={["/"]}><HeroSearch inputRef={null} onEscape={() => {}} hint="Ctrl K" /><Where /></MemoryRouter>);
    const list = screen.getByRole("list", { name: "Example searches" });
    const before = chips().map((b) => b.textContent);
    expect(list.className).not.toContain("invisible");
    // A sign-in on this page: the account's sync starts and its My team arrives, its name still loading.
    account = { here: true, syncReady: false, user: { id: 7 }, providers: {} };
    myTeam = 4215;
    summary = { loading: true };
    again();
    expect(list.className).not.toContain("invisible");
    expect(chips().map((b) => b.textContent)).toEqual(before);
    act(() => { vi.advanceTimersByTime(ACCOUNT_WAIT_MS * 3); });
    expect(list.className).not.toContain("invisible");
    // The name arrives: one swap, with the team's chips.
    summary = { loading: false, data: { teams: [{ team: 4215, name: "Hypnotic Robotics" }] } };
    again();
    expect(list.className).not.toContain("invisible");
    expect(chips().some((b) => b.textContent?.startsWith("4215 Hypnotic"))).toBe(true);
  });

  it("a team name that never comes holds the first draw no longer than ACCOUNT_WAIT_MS: its chips draw by number, and the name swaps in if it comes", () => {
    myTeam = 4215;
    summary = { loading: true };
    const { rerender } = show();
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.className).toContain("invisible");
    act(() => { vi.advanceTimersByTime(ACCOUNT_WAIT_MS); });
    expect(list.className).not.toContain("invisible");
    const own = chips().map((b) => b.textContent ?? "").filter((t) => t.startsWith("4215"));
    expect(own).toHaveLength(2);
    expect(own.some((t) => t.includes("Hypnotic"))).toBe(false);
    summary = { loading: false, data: { teams: [{ team: 4215, name: "Hypnotic Robotics" }] } };
    rerender(<MemoryRouter initialEntries={["/"]}><HeroSearch inputRef={null} onEscape={() => {}} hint="Ctrl K" /><Where /></MemoryRouter>);
    expect(list.className).not.toContain("invisible");
    expect(chips().some((b) => b.textContent?.startsWith("4215 Hypnotic"))).toBe(true);
  });

  it("never holds for an account whose sync failed, is offline, or opened from the offline copy", () => {
    for (const extra of [{ sync: "error" }, { sync: "offline" }, { offlineAccount: true }]) {
      account = { here: true, syncReady: false, user: { id: 7 }, providers: {}, ...extra };
      show();
      const list = screen.getByRole("list", { name: "Example searches" });
      expect(list.className, JSON.stringify(extra)).not.toContain("invisible");
      expect(list.getAttribute("aria-busy")).toBeNull();
      expect(chips().length).toBeGreaterThan(0);
      cleanup();
    }
    // The same account still syncing does hold (the guard is what lets the three above through).
    account = { here: true, syncReady: false, user: { id: 7 }, providers: {}, sync: "syncing" };
    show();
    expect(screen.getByRole("list", { name: "Example searches" }).className).toContain("invisible");
  });

  it("waits no longer than ACCOUNT_WAIT_MS for the account, and not at all once it's known signed out", () => {
    account = { here: true, syncReady: false, user: null, providers: null };
    show();
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.className).toContain("invisible");
    act(() => { vi.advanceTimersByTime(ACCOUNT_WAIT_MS); });
    expect(list.className).not.toContain("invisible");
    cleanup();
    account = { here: true, syncReady: false, user: null, providers: {} };
    show();
    expect(screen.getByRole("list", { name: "Example searches" }).className).not.toContain("invisible");
  });

  it("with My team set and its name unknown (the request failed), its chips go by number alone", () => {
    myTeam = 4215;
    summary = { loading: false, error: new Error("offline") };
    show();
    const own = suggestionsAt(HOUR, HOME_SUGGESTIONS, teamSuggestions(4215, null)).filter((s) => s.mine);
    expect(own.map(suggestionLabel).every((l) => /^4215 [a-zA-Z]/.test(l) && !l.includes("Hypnotic"))).toBe(true);
    expect(chips().map((b) => b.textContent)).toEqual(expect.arrayContaining(own.map(suggestionLabel)));
    const list = screen.getByRole("list", { name: "Example searches" });
    expect(list.className).not.toContain("invisible");
    expect(list.getAttribute("aria-busy")).toBeNull();
  });

  it("never searches for the example in the placeholder", () => {
    show();
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByTestId("at").textContent).toBe("/");
  });

  it("never scrolls sideways, and draws only the chips that fit its rows whole, the placeholder skipping the rest", () => {
    // jsdom lays nothing out: give the list room for two rows of 300px and each chip a width, longer labels wider.
    const W = (b: Element) => 60 + 7 * (b.textContent ?? "").length;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = this.tagName === "BUTTON" ? W(this) : this.tagName === "UL" ? 300 : 0, height = this.tagName === "BUTTON" ? 30 : 0;
      return { top: 0, bottom: height, left: 0, right: width, width, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const size = (k: "clientWidth" | "clientHeight", v: number) => vi.spyOn(HTMLElement.prototype, k, "get").mockImplementation(function (this: HTMLElement) { return this.tagName === "UL" ? v : 0; });
    const cw = size("clientWidth", 300), ch = size("clientHeight", 60);
    try {
      show();
      const list = screen.getByRole("list", { name: "Example searches" });
      expect(list.className).toContain("flex-wrap");
      expect(list.className).not.toContain("overflow-x-auto");
      const all = six();
      const order = fitChips(all.map((s) => 60 + 7 * suggestionLabel(s).length), 300, 0, 2, all.map((s) => s.kind));
      const drawn = order.map((i) => all[i]);
      expect(drawn.length).toBeLessThan(all.length);
      expect(chips().map((b) => b.textContent)).toEqual(drawn.map(suggestionLabel));
      const kept = drawn.filter(placeholderable);
      for (let n = 0; n < kept.length * 2; n++) {
        expect(kept.map(heroPlaceholder)).toContain(field().getAttribute("placeholder"));
        act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS); });
      }
    } finally { rect.mockRestore(); cw.mockRestore(); ch.mockRestore(); }
  });

  it("draws no chip, and stays put, when none fits the list", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = this.tagName === "BUTTON" ? 400 : this.tagName === "UL" ? 300 : 0, height = this.tagName === "BUTTON" ? 30 : 0;
      return { top: 0, bottom: height, left: 0, right: width, width, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const ch = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.tagName === "UL" ? 60 : 0; });
    try {
      show();
      expect(chips()).toEqual([]);
      act(() => { vi.advanceTimersByTime(HERO_EXAMPLE_MS * 3); });
      expect(chips()).toEqual([]);
      expect(field().getAttribute("placeholder")).toBe(heroPlaceholder(six()[0]));
    } finally { rect.mockRestore(); ch.mockRestore(); }
  });
});
