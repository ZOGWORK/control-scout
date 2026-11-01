// @vitest-environment jsdom
// The header's search with the whole answer (docs/search.md): live as you type, an older reply never replacing a
// newer one, the keyboard, Escape, what a screen reader hears, Bruno AI's suggestion arriving after search's own
// results (labelled as his), the gap note, the pages and the recovery state.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const t = (ref: string, name: string): SearchHit => ({ kind: "team", ref, title: `${ref} ${name}`, subtitle: "Oradell, NJ, USA", season: 2026 });
const answer = (q: string, a: Partial<SearchAnswer>): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...a });

/** Each request waits until the test answers it: replies can arrive in any order. */
const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
const flags = { brunoSearch: true, searchLearning: true };
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: (n: keyof typeof flags) => flags[n] }));

const { SearchBox, SEARCH_DEBOUNCE_MS } = await import("./SearchBox");

const beacon = vi.fn(() => true);
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
});
afterEach(() => { cleanup(); pending.length = 0; beacon.mockClear(); vi.useRealTimers(); });

function mount(onPick = vi.fn()) {
  render(<SearchBox onPick={onPick} placeholder="Search teams, events, matches…" label="Search" />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  act(() => input.focus());
  return { input, onPick };
}
const type = async (input: HTMLInputElement, v: string) => { fireEvent.change(input, { target: { value: v } }); await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); }); };
const reply = async (match: RegExp, body: unknown) => {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
};

describe("live search", () => {
  it("a whole season's card (no team, no other results) shows in the dropdown, not \"nothing matches\"", async () => {
    const { input } = mount();
    await type(input, "world record score decode");
    await reply(/q=world/, answer("world record score decode", { card: { kind: "high-scores", title: "Highest scores in 2025–26 (DECODE)", lines: [{ text: "714 points: Q49 at Carolinas Premier Event", href: "/events/2025/FPECAR?match=qual:0:49" }] } }));
    expect(screen.getByRole("note", { name: "Highest scores in 2025–26 (DECODE)" }).textContent).toContain("714 points");
    expect(screen.queryByText(/No team, event or match matches/)).toBeNull();
  });
  it("asks once typing pauses, shows that it's searching, and never opens anything on its own (T15, T21)", async () => {
    const { input, onPick } = mount();
    fireEvent.change(input, { target: { value: "hyp" } });
    fireEvent.change(input, { target: { value: "hypno" } });
    expect(input.value).toBe("hypno"); // typing is never blocked
    expect(screen.getByText("Searching…")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=hypno&limit=15&answer=1")]);
    await reply(/q=hypno/, answer("hypno", { hits: [t("4215", "Hypnotic Robotics")] }));
    expect(screen.getByRole("option", { name: /4215 Hypnotic Robotics/ })).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });
  it("waits for typing to pause: nothing is asked letter by letter, and a pause shorter than the wait asks nothing", async () => {
    const { input } = mount();
    for (const v of ["w", "wo", "wor", "worl", "world"]) {
      fireEvent.change(input, { target: { value: v } });
      await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 100); });
    }
    expect(pending).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(105); });
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=world&")]);
  });
  it("Enter before the pause is over opens the full results page with one press", async () => {
    const { input, onPick } = mount();
    fireEvent.change(input, { target: { value: "bio buzz record" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=bio%20buzz%20record");
  });
  it("a picker box (no results page): one Enter before its results are in asks now and opens the top one when they arrive", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} kinds={["team"]} seeAll={false} placeholder="Find a team" label="Find a team" />);
    const input = screen.getByRole("combobox", { name: "Find a team" }) as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "hypno" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=hypno&")]); // no pause
    expect(onPick).not.toHaveBeenCalled();
    await reply(/q=hypno/, { hits: [t("4215", "Hypnotic Robotics")] });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: "4215" }));
  });
  it("a picker's pending Enter is dropped when it closes (Escape): the late reply opens nothing", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} kinds={["team"]} seeAll={false} placeholder="Find a team" label="Find a team" />);
    const input = screen.getByRole("combobox", { name: "Find a team" }) as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "hypno" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    await reply(/q=hypno/, { hits: [t("4215", "Hypnotic Robotics")] });
    expect(onPick).not.toHaveBeenCalled();
  });
  it("an older reply arriving last never replaces the newer one (T15)", async () => {
    const { input } = mount();
    await type(input, "bad");
    await type(input, "bad wolf");
    await reply(/q=bad%20wolf/, answer("bad wolf", { hits: [t("6980", "Bad Wolf")] }));
    await reply(/q=bad&/, answer("bad", { hits: [t("1", "Bad News Bots")] }));
    expect(screen.getByRole("option", { name: /6980 Bad Wolf/ })).toBeTruthy();
    expect(screen.queryByText(/Bad News Bots/)).toBeNull();
  });
});

describe("typing on (the last answer stays while the next is on its way)", () => {
  it("the list never empties between replies: the last results stay, dimmed and marked busy", async () => {
    const { input } = mount();
    await type(input, "4215");
    await reply(/q=4215&/, answer("4215", { hits: [t("4215", "Hypnotic Robotics")] }));
    await type(input, "4215 versus");
    expect(screen.getByRole("option", { name: /4215 Hypnotic Robotics/ })).toBeTruthy();
    expect(screen.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Searching…")).toBeNull();
    await reply(/q=4215%20versus/, answer("4215 versus", { hits: [t("4215", "Hypnotic Robotics"), t("28252", "Vertus Robotics")] }));
    expect(screen.getByRole("listbox").hasAttribute("aria-busy")).toBe(false);
    expect(screen.getByRole("option", { name: /28252 Vertus Robotics/ })).toBeTruthy();
  });
  it("plain Enter on a stale list opens the full results page for what's typed, never an older query's result", async () => {
    const { input, onPick } = mount();
    await type(input, "4215");
    await reply(/q=4215&/, answer("4215", { hits: [t("4215", "Hypnotic Robotics")] }));
    await type(input, "4215 vs 6980");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: "/search?q=4215%20vs%206980" }));
  });
});

describe("Enter and the full results page", () => {
  it("plain Enter (nothing highlighted) opens /search?q=…; the last row goes there too; ArrowUp from nothing reaches it", async () => {
    const { input, onPick } = mount();
    const ask = async () => { act(() => input.focus()); await type(input, "hypnotic"); await reply(/q=hypnotic/, answer("hypnotic", { hits: [t("4215", "Hypnotic Robotics")] })); };
    await ask();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=hypnotic" }));
    await ask();
    fireEvent.click(screen.getByRole("option", { name: /See all results for “hypnotic”/ }));
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=hypnotic" }));
    await ask();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /See all results/ }).getAttribute("aria-selected")).toBe("true");
    expect(beacon).not.toHaveBeenCalled(); // the full page is no result: nothing counted
  });
  it("typing again drops the highlight: Enter on the older list opens the full page for what's typed, never the old row", async () => {
    const { input, onPick } = mount();
    await type(input, "4215");
    await reply(/q=4215&/, answer("4215", { hits: [t("4215", "Hypnotic Robotics")] }));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    await type(input, "4215 vs 6980");
    expect(screen.getAllByRole("option").some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // a row of the older list, still on screen
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: "/search?q=4215%20vs%206980" }));
  });
  it("where Bruno AI's suggestion isn't shown (refine off), he's never asked", async () => {
    const { useSearchHits } = await import("./SearchBox");
    function Page() { const { hits } = useSearchHits("zz", undefined, 15, null, false); return <p>{hits.length}</p>; }
    render(<Page />);
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    await reply(/\/api\/search\?q=zz/, answer("zz", { step: "did-you-mean", weak: true, hits: [t("1", "Zz Bots")] }));
    expect(pending.some((p) => p.url.includes("/refine"))).toBe(false);
  });
  it("each row shows where it goes: the full address, anchor included", async () => {
    const { input } = mount();
    await type(input, "hypnotic opr");
    await reply(/q=hypnotic/, answer("hypnotic opr", { hits: [{ ...t("4215", "Hypnotic Robotics"), section: "opr" }, { ...t("4215", "Hypnotic Robotics vs 6980 Bad Wolf"), href: "/compare?teams=4215,6980" }] }));
    const paths = [...document.querySelectorAll("[data-path]")].map((p) => p.textContent);
    expect(paths).toEqual(["controlscout.org/teams/4215#opr", "controlscout.org/compare?teams=4215,6980"]);
  });
  it("nothing found is never a bare dead end: a hint and the row to the full page", async () => {
    const { input } = mount();
    await type(input, "asdfgh");
    await reply(/q=asdfgh/, answer("asdfgh", { step: "recovery", weak: true, hits: [] }));
    expect(screen.getByText(/No team, event or match matches “asdfgh” yet/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /See all results for “asdfgh”/ })).toBeTruthy();
  });
  it("a question's answer card sits above the results, from the answer's own records", async () => {
    const { input } = mount();
    await type(input, "when did hypnotic go to worlds");
    await reply(/q=when/, answer("when did hypnotic go to worlds", {
      hits: [{ ...t("4215", "Hypnotic Robotics"), section: "events" }],
      card: { kind: "worlds", title: "Worlds appearances", team: { number: 4215, name: "Hypnotic Robotics" }, lines: [{ text: "2024 FIRST Championship - Edison Division", detail: "2023–24 · ranked #3", href: "/events/2023/FTCCMP1EDIS?team=4215" }] },
    }));
    const card = screen.getByRole("note", { name: /Worlds appearances: Hypnotic Robotics \(4215\)/ });
    expect(card.textContent).toContain("Edison Division");
  });
  it("a picker box (seeAll off) has no full-page row, and Enter takes its top result", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} kinds={["team"]} seeAll={false} placeholder="Team" label="Pick" />);
    const input = screen.getByRole("combobox", { name: "Pick" }) as HTMLInputElement;
    act(() => input.focus());
    await type(input, "hyp");
    await reply(/q=hyp/, { hits: [t("4215", "Hypnotic Robotics")] });
    expect(screen.queryByRole("option", { name: /See all results/ })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ref: "4215" }));
  });
});

describe("keyboard and screen readers (T16, T57, T58)", () => {
  it("Down and Up move, Enter opens the highlighted one, the list is a listbox the field controls", async () => {
    const { input, onPick } = mount();
    await type(input, "robotics");
    const hits = [t("4215", "Hypnotic Robotics"), t("6980", "Bad Wolf")];
    await reply(/q=robotics/, answer("robotics", { hits }));
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("4215 Hypnotic Robotics"), expect.stringContaining("6980 Bad Wolf"), "See all results for “robotics”"]);
    // Nothing is highlighted until a key or the pointer picks a row.
    expect(screen.getAllByRole("option").some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(hits[0]);
  });
  it("Escape closes the list and keeps the field focused; again, it clears", async () => {
    const { input } = mount();
    await type(input, "hypnotic");
    await reply(/q=hypnotic/, answer("hypnotic", { hits: [t("4215", "Hypnotic Robotics")] }));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });
});

describe("the answer's parts", () => {
  it("Bruno AI's suggestion arrives after search's own results, labelled as his (T66)", async () => {
    const { input } = mount();
    await type(input, "robots that hypnotise");
    await reply(/\/api\/search\?q=/, answer("robots that hypnotise", { step: "did-you-mean", didYouMean: "Dread Pirate Robots", weak: true, hits: [t("11545", "Dread Pirate Robots")] }));
    // Search's own results are on screen while he's asked.
    expect(screen.getByRole("option", { name: /Dread Pirate Robots/ })).toBeTruthy();
    expect(screen.getByText(/Asking Bruno AI/)).toBeTruthy();
    await reply(/\/api\/search\/refine/, answer("robots that hypnotise", { step: "ai", refined: "hypnotic robotics", hits: [t("4215", "Hypnotic Robotics")] }));
    expect(screen.getByRole("group", { name: "Bruno AI suggestion" })).toBeTruthy();
    expect(screen.getByText(/Bruno AI read this as/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dread Pirate Robots/ })).toBeTruthy();
  });
  it("Bruno AI's group arriving keeps the highlight on its row; a new query drops his old suggestion", async () => {
    const onPick = vi.fn();
    const { input } = mount(onPick);
    await type(input, "robots that hypnotise");
    const base = [t("11545", "Dread Pirate Robots"), t("7", "Robot Seven")];
    await reply(/\/api\/search\?q=/, answer("robots that hypnotise", { step: "did-you-mean", weak: true, hits: base }));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // on "Robot Seven"
    await reply(/\/api\/search\/refine/, answer("robots that hypnotise", { step: "ai", refined: "hypnotic robotics", hits: [t("4215", "Hypnotic Robotics")] }));
    const selected = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Robot Seven");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(base[1]);
    // Typed again: his old suggestion is gone until he answers the new query.
    act(() => input.focus());
    await type(input, "robots that hypnotise");
    await reply(/\/api\/search\?q=/, answer("robots that hypnotise", { step: "did-you-mean", weak: true, hits: base }));
    expect(screen.queryByRole("group", { name: "Bruno AI suggestion" })).toBeNull();
  });
  it("Bruno AI off: never asked", async () => {
    flags.brunoSearch = false;
    try {
      const { input } = mount();
      await type(input, "zz");
      await reply(/\/api\/search\?q=/, answer("zz", { step: "did-you-mean", weak: true, hits: [t("1", "Zz Bots")] }));
      expect(pending.some((p) => p.url.includes("/refine"))).toBe(false);
    } finally { flags.brunoSearch = true; }
  });
  it("a missing view: what was understood, the closest result, and the gap note (T73)", async () => {
    const { input } = mount();
    await type(input, "hypnotic robot specs");
    await reply(/q=hypnotic/, answer("hypnotic robot specs", {
      step: "closest", hits: [t("4215", "Hypnotic Robotics")],
      intent: { kind: "robot-specs", pattern: "[team] robot specs", met: false, understood: ["Team 4215 Hypnotic Robotics", "Their robot specs"], gap: "Robot specs (drivetrain, weight, design) aren't tracked yet." },
    }));
    expect(screen.getByText(/Understood: Team 4215 Hypnotic Robotics · Their robot specs/)).toBeTruthy();
    expect(screen.getByText("Robot specs (drivetrain, weight, design) aren't tracked yet.")).toBeTruthy();
    expect(screen.getByRole("option", { name: /4215 Hypnotic Robotics/ })).toBeTruthy();
  });
  it("pages below the results; the recovery state is never a bare dead end (T10, T13)", async () => {
    const { input, onPick } = mount();
    await type(input, "records");
    await reply(/q=records/, answer("records", { step: "recovery", weak: true, pages: [{ title: "Team records", href: "/teams" }], recovery: { understood: ['No team, event or match matched "records"'], closest: [], browse: [{ title: "Browse all teams", href: "/teams" }, { title: "Browse all events", href: "/events" }] } }));
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Pages", "Browse"]);
    expect(screen.getByText(/No team, event or match matched/)).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Browse all events/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ href: "/events" }));
  });
  it("an opened result is counted with its query only (aggregate: no account)", async () => {
    const { input } = mount();
    await type(input, "hypnotic");
    await reply(/q=hypnotic/, answer("hypnotic", { hits: [t("4215", "Hypnotic Robotics")] }));
    fireEvent.click(screen.getByRole("option", { name: /4215/ }));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/search/click");
    expect(JSON.parse(await blob.text())).toEqual({ q: "hypnotic", kind: "team", ref: "4215" });
  });
  it("a pick that opens a feature (Compare) is sent too, so its question is counted", async () => {
    const { input } = mount();
    await type(input, "hypnotic vs bad wolf reputation");
    await reply(/q=hypnotic/, answer("hypnotic vs bad wolf reputation", { step: "closest", hits: [{ ...t("4215", "Hypnotic Robotics vs 6980 Bad Wolf"), href: "/compare?teams=4215,6980" }] }));
    fireEvent.click(screen.getByRole("option", { name: /vs 6980/ }));
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});
