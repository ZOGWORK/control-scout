// @vitest-environment jsdom
// The magnifier is a submit button (it searches like Enter and closes the keyboard, never just focuses the field),
// the dropdown always shows the CURRENT query's results (typing fast never leaves an older query's list as current),
// and on a phone with the keyboard up the list ends above the keyboard.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const t = (ref: string, name: string): SearchHit => ({ kind: "team", ref, title: `${ref} ${name}`, subtitle: "Oradell, NJ, USA", season: 2026 });
const ev = (code: string, name: string): SearchHit => ({ kind: "event", ref: `2026:${code}`, title: name, subtitle: "NJ, USA", season: 2026 });
const answer = (q: string, a: Partial<SearchAnswer>): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...a });

/** Each request waits until the test answers it: replies can arrive in any order. */
const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS } = await import("./SearchBox");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });

function mount(extra: Partial<Parameters<typeof SearchBox>[0]> = {}) {
  const onPick = vi.fn();
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" {...extra} />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  act(() => input.focus());
  return { input, onPick, magnifier: screen.getByRole("button", { name: "Run search" }) };
}
const change = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });
const pause = async () => { await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); }); };
const reply = async (match: RegExp, body: unknown) => {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
};
const shown = () => screen.queryAllByRole("option").map((o) => o.textContent ?? "");

describe("the magnifier searches (Req 5, test 10)", () => {
  it("tapping it with a query typed opens /search?q=… like Enter, closes the list and leaves the field (keyboard down)", async () => {
    const { input, onPick, magnifier } = mount();
    change(input, "meets in New Jersey");
    // The press never takes focus from the field (so it can't just bring the keyboard back)…
    expect(fireEvent.pointerDown(magnifier)).toBe(false);
    expect(fireEvent.mouseDown(magnifier)).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.click(magnifier);
    // …and the click searches at once, without waiting out the typing pause, and goes when the answer is in.
    await reply(/q=meets/, answer("meets in New Jersey", { hits: [] }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=meets%20in%20New%20Jersey");
    expect(document.activeElement).not.toBe(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("it's the same search Enter runs: the full results page, even with a row highlighted by the pointer", async () => {
    const { input, onPick, magnifier } = mount();
    change(input, "hypnotic");
    await pause();
    await reply(/q=hypnotic&/, answer("hypnotic", { hits: [t("4215", "Hypnotic Robotics")] }));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.click(magnifier);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: "/search?q=hypnotic" }));
  });
  it("on an empty field there's nothing to search: it focuses the field and opens nothing", () => {
    const { input, onPick, magnifier } = mount();
    act(() => input.blur());
    fireEvent.click(magnifier);
    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
  it("a picker box (no results page) opens its top result, asking at once if it isn't in yet", async () => {
    const { input, onPick, magnifier } = mount({ kinds: ["team"], seeAll: false });
    change(input, "hypno");
    fireEvent.click(magnifier);
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=hypno&")]);
    await reply(/q=hypno/, { hits: [t("4215", "Hypnotic Robotics")] });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: "4215" }));
  });
  it("a picker whose list was closed (Escape) still opens its top result when the magnifier is tapped", async () => {
    const { input, onPick, magnifier } = mount({ kinds: ["team"], seeAll: false });
    change(input, "hypno");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(magnifier);
    await reply(/q=hypno/, { hits: [t("4215", "Hypnotic Robotics")] });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: "4215" }));
  });
});

describe("the dropdown always shows the current query (Req 3, test 9)", () => {
  it("\"Meets\" retyped fast to \"Meets in New Jersey\": the older reply, arriving last, is never shown", async () => {
    const { input } = mount();
    change(input, "Meets");
    await pause();
    change(input, "Meets in New Jersey");
    await pause();
    await reply(/q=Meets%20in%20New%20Jersey/, answer("Meets in New Jersey", { hits: [ev("USNJNEM6", "P2-8 Northeast League Meet")] }));
    await reply(/q=Meets&/, answer("Meets", { hits: [ev("USMOSLU", "SLU Meet")] }));
    expect(shown().join("|")).toContain("P2-8 Northeast League Meet");
    expect(shown().join("|")).not.toContain("SLU Meet");
    expect(screen.getByRole("listbox").hasAttribute("aria-busy")).toBe(false);
  });
  it("while the newer query is on its way the older list is dimmed and marked stale, then replaced; again on another fast retype", async () => {
    const { input } = mount();
    change(input, "Meets");
    await pause();
    await reply(/q=Meets&/, answer("Meets", { hits: [ev("USMOSLU", "SLU Meet")] }));
    expect(screen.getByRole("listbox").hasAttribute("aria-busy")).toBe(false);
    for (const [q, hit] of [["Meets in New Jersey", ev("USNJNEM6", "P2-8 Northeast League Meet")], ["Meets in New Jersey at River Dell", ev("USNJNEM7", "P2-9 Northeast League Meet")]] as const) {
      change(input, q);
      // Not current: still on screen, but marked stale (aria-busy, dimmed) — never presented as this query's answer.
      const list = screen.getByRole("listbox");
      expect(list.getAttribute("aria-busy")).toBe("true");
      expect(list.className).toContain("opacity-60");
      await pause();
      await reply(new RegExp(`q=${encodeURIComponent(q)}&`), answer(q, { hits: [hit] }));
      // Settled: exactly the typed query's results.
      expect(screen.getByRole("listbox").hasAttribute("aria-busy")).toBe(false);
      expect(shown().filter((s) => !s.startsWith("See all"))).toEqual([expect.stringContaining(hit.title)]);
      expect(shown().at(-1)).toContain(`See all results for “${q}”`);
    }
  });
});

describe("phone keyboard (Bug J)", () => {
  const real = Object.getOwnPropertyDescriptor(window, "visualViewport");
  afterEach(() => { if (real) Object.defineProperty(window, "visualViewport", real); else delete (window as { visualViewport?: unknown }).visualViewport; });
  const viewport = (height: number) => Object.defineProperty(window, "visualViewport", {
    configurable: true, value: Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 }),
  });
  it("with the keyboard up, the list's height ends above it (so no row sits under the keyboard)", async () => {
    viewport(window.innerHeight - 340);
    const { input } = mount();
    change(input, "hawaii");
    // jsdom has no layout: the list's top is 0, so the room is the visible height less the margin.
    expect(screen.getByRole("listbox").style.maxHeight).toBe(`min(26rem, ${window.innerHeight - 340 - 12}px)`);
  });
  it("with little room left, the list is only as tall as that room (its last rows never sit under the keyboard)", async () => {
    viewport(60);
    const { input } = mount();
    change(input, "hawaii");
    expect(screen.getByRole("listbox").style.maxHeight).toBe("min(26rem, 48px)");
  });
  it("without a keyboard the list keeps its usual height", async () => {
    viewport(window.innerHeight);
    const { input } = mount();
    change(input, "hawaii");
    expect(screen.getByRole("listbox").style.maxHeight).toBe("");
  });
});
