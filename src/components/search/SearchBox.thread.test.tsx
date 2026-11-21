// @vitest-environment jsdom
// Enter on a follow-up ("who beat them?", "and last season?", "and 2025?") asks about the team the last answer was
// about, so the results page answers it instead of reading a question with no subject (./thread.ts). A question of its
// own is asked as typed, and the dropdown answering the words as they are typed never wipes the team the thread holds.
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const t = (ref = "6980"): SearchHit => ({ kind: "team", ref, title: `${ref} | Bad Wolf`, subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" });
const place = (): SearchHit => ({ kind: "place", ref: "nj", title: "New Jersey", subtitle: "USA", season: null, match: "exact" });
const answer = (q: string, hits: SearchHit[]): SearchAnswer => ({ q, hits, pages: [], step: "deterministic", weak: false });

/** Each request waits until the test answers it. */
const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS, useSearchHits } = await import("./SearchBox");
const { forgetTurn, lastTurn, rememberTurn } = await import("./thread");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); forgetTurn(); pending.length = 0; Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });

function mount() {
  const onPick = vi.fn();
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  act(() => input.focus());
  return { input, onPick };
}

/** Type a question and press Enter, as a visitor does. */
async function ask(input: HTMLInputElement, q: string) {
  fireEvent.change(input, { target: { value: q } });
  await act(async () => {});
  fireEvent.keyDown(input, { key: "Enter" });
}

/** The typing pause, then the test answers the request it sends (or none, for Enter before it). */
const pause = async () => { await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); }); };
async function reply(match: RegExp, body: unknown) {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
}

describe("the box keeps the thread", () => {
  it("asks a follow-up about the team the last question named", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t()] });
    const { input, onPick } = mount();
    await ask(input, "who beat them?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=who%20beat%206980%3F");
  });

  it("fills a bare follow-up in: \"and last season?\" is last season of that team", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t()] });
    const { input, onPick } = mount();
    await ask(input, "and last season?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=6980%20last%20season%3F");
  });

  it("a season is when, not which team: \"and 2025?\" is that team's 2025", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t()] });
    const { input, onPick } = mount();
    await ask(input, "and 2025?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=6980%202025");
  });

  it("leaves a question of its own alone: a team it names is its own subject", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t()] });
    const { input, onPick } = mount();
    await ask(input, "and 4215?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=and%204215%3F");
  });

  it("the dropdown answering the words as typed doesn't wipe the team the thread holds", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t()] });
    const { input } = mount();
    fireEvent.change(input, { target: { value: "who beat them?" } });
    await pause();
    await reply(/q=who%20beat%20them/, answer("who beat them?", [place()]));
    expect(lastTurn()?.team).toBe(6980);
  });

  it("the results page's own answer is what becomes the thread", async () => {
    vi.useRealTimers();
    renderHook(() => useSearchHits("6980 worlds", undefined, 25, null, false, null, true));
    // The page asks at once (its query was submitted, not typed).
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(pending.length, "the page's request").toBeGreaterThan(0);
    const p = pending.shift()!;
    await act(async () => { p.resolve(answer("6980 worlds", [t()])); });
    expect(lastTurn()).toMatchObject({ q: "6980 worlds", team: 6980 });
  });
});
