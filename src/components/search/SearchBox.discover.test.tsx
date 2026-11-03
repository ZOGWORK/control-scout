// @vitest-environment jsdom
// FTC One Search's teaching parts in the search list (Requirement 12): this device's recent searches (one tap to run
// again, clearable, never from a picker), example chips that run a real query, and a correction always labelled
// "Did you mean …?", never a silent swap.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const t = (ref: string, name: string): SearchHit => ({ kind: "team", ref, title: `${ref} ${name}`, subtitle: "Oradell, NJ, USA", season: 2026 });
const answer = (q: string, a: Partial<SearchAnswer>): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...a });

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS } = await import("./SearchBox");
const { RECENT_KEY, SEARCH_EXAMPLES, addRecentSearch, clearRecentSearches } = await import("./discover");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; localStorage.clear(); });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); localStorage.clear(); });

function mount(extra: Partial<Parameters<typeof SearchBox>[0]> = {}) {
  const onPick = vi.fn();
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" {...extra} />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  return { input, onPick, focus: () => act(() => { input.blur(); input.focus(); }) };
}
const reply = async (match: RegExp, body: unknown) => {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
};

describe("recent searches (on this device only)", () => {
  it("newest first, the same query (any case) kept once, at most six; Clear empties it", () => {
    for (const q of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "A3"]) addRecentSearch(q);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(["A3", "a7", "a6", "a5", "a4", "a2"]);
    clearRecentSearches();
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });
  it("a search that was run shows next time the empty field is focused; one tap runs it again", async () => {
    const { input, onPick, focus } = mount({ discover: true });
    focus();
    expect(screen.queryByRole("listbox")).toBeNull(); // nothing yet: no empty list
    fireEvent.change(input, { target: { value: "4215 vs 6980" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await reply(/q=4215%20vs/, answer("4215 vs 6980", { hits: [{ ...t("4215", "Hypnotic Robotics vs 6980 Bad Wolf"), href: "/compare?teams=4215,6980" }] }));
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=4215%20vs%206980" }));
    focus();
    const recent = screen.getByRole("group", { name: "Recent searches" });
    const row = within(recent).getByRole("option", { name: "4215 vs 6980" });
    expect(fireEvent.pointerDown(row)).toBe(false); // the tap keeps the list open until it lands
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=4215%20vs%206980" }));
  });
  it("opening a result row remembers what was typed too", async () => {
    const { input, focus } = mount({ discover: true });
    focus();
    fireEvent.change(input, { target: { value: "hypnotic" } });
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    await reply(/q=hypnotic/, answer("hypnotic", { hits: [t("4215", "Hypnotic Robotics")] }));
    fireEvent.click(screen.getByRole("option", { name: /4215 Hypnotic Robotics/ }));
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(["hypnotic"]);
  });
  it("Clear removes them all and the empty list goes", () => {
    addRecentSearch("4215 record");
    const { focus } = mount({ discover: true });
    focus();
    fireEvent.click(within(screen.getByRole("group", { name: "Recent searches" })).getByRole("button", { name: "Clear" }));
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("a picker (a box limited to some kinds) never records what it picked", () => {
    const { input } = mount({ discover: true, kinds: ["team"], seeAll: false });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "hypno" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });
});

describe("the suggestions are options (keyboard)", () => {
  it("Down and Up walk recent searches then examples; Enter runs the highlighted one", () => {
    addRecentSearch("hypnotic robotics");
    const { input, onPick, focus } = mount({ discover: true, examples: true });
    focus();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["hypnotic robotics", ...SEARCH_EXAMPLES]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" }); // wraps to the last example
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: `/search?q=${encodeURIComponent(SEARCH_EXAMPLES.at(-1)!)}` }));
  });
});

describe("a dismissed suggestion", () => {
  it("Down, Escape, Enter: the closed list's highlight is gone, so nothing runs", () => {
    const { input, onPick, focus } = mount({ examples: true });
    focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("example chips", () => {
  it("an empty field's list offers real example queries; tapping one runs it on the full results page", () => {
    const { onPick, focus } = mount({ examples: true });
    focus();
    const chips = within(screen.getByRole("group", { name: "Example searches" })).getAllByRole("option");
    expect(chips.map((c) => c.textContent)).toEqual([...SEARCH_EXAMPLES]);
    fireEvent.click(chips[0]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: `/search?q=${encodeURIComponent(SEARCH_EXAMPLES[0])}` }));
  });
  it("Enter on the empty field searches nothing (an example is never sent on its own)", () => {
    const { input, onPick, focus } = mount({ examples: true });
    focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });
});

describe("answer card links", () => {
  it("opening a link in a question's answer card remembers the question", async () => {
    const { input, onPick, focus } = mount({ discover: true });
    focus();
    fireEvent.change(input, { target: { value: "when did 4215 go to worlds" } });
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    await reply(/q=when/, answer("when did 4215 go to worlds", { hits: [t("4215", "Hypnotic Robotics")], card: { kind: "worlds", title: "Worlds appearances", lines: [{ text: "2024–25: FIRST Championship", href: "/events/2024/FTCCMP1" }] } }));
    fireEvent.click(screen.getByRole("link", { name: "2024–25: FIRST Championship" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: "/events/2024/FTCCMP1" }));
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(["when did 4215 go to worlds"]);
  });
});

describe("did you mean", () => {
  it("a correction is labelled as one, with what was typed", async () => {
    const { input, focus } = mount();
    focus();
    fireEvent.change(input, { target: { value: "hypnotik robotcs" } });
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    await reply(/q=hypnotik/, answer("hypnotik robotcs", { step: "did-you-mean", didYouMean: "hypnotic robotics", hits: [t("4215", "Hypnotic Robotics")] }));
    expect(document.querySelector("[data-did-you-mean]")?.textContent).toBe("Did you mean “hypnotic robotics”? Showing results for that, not “hypnotik robotcs”.");
    // Typing on: the old correction (dimmed, stale) never names the new text as the mistake.
    fireEvent.change(input, { target: { value: "6980" } });
    expect(document.querySelector("[data-did-you-mean]")?.textContent).toBe("Did you mean “hypnotic robotics”? Showing results for that.");
  });
});
