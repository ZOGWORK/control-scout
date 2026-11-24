// @vitest-environment jsdom
// Bruno sooner (the search audit, S6): a question the first paint already answered (not directly) asks him straight
// away, while the page's own refresh of that same answer is still on its way; with nothing in hand he waits for it.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "../shared/api";

const Q = "what makes 16091 worth picking as a partner";
const seed: SearchAnswer = { q: Q, hits: [{ kind: "team", ref: "16091", title: "16091 | Rogue Robotics", subtitle: "", season: 2025 }], pages: [], step: "deterministic", weak: false };
const boot = vi.hoisted(() => ({ hits: null as unknown }));
vi.mock("../lib/searchBoot", () => ({ get BOOT_HITS() { return boot.hits; }, readBootHits: () => null }));
// The page's own search is still running (busy), with the seeded answer on screen.
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: seed.hits, answer: seed, busy: true, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "", live: false }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025 }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, error: null, loading: true }) }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: (n: string) => n === "brunoAnswers" }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), useTeamFlags: () => ({ bookmarked: false, toggleBookmark: () => {} }),
  usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
const asked = vi.hoisted(() => [] as string[]);
vi.mock("../lib/brunoStream", () => ({ streamBrunoAnswer: (url: string) => { asked.push(url); return new Promise(() => {}); } }));

const { default: SearchPage } = await import("./SearchPage");
const show = () => render(<MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(Q)}`]}><SearchPage /></MemoryRouter>);

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); asked.length = 0; });
afterEach(() => { cleanup(); boot.hits = null; vi.useRealTimers(); });

describe("Bruno asked as soon as the answer he reads is on screen", () => {
  it("the first paint's answer in hand: asked at once, not after the page's refresh", async () => {
    boot.hits = seed;
    show();
    await act(async () => { vi.advanceTimersByTime(5); });
    expect(asked).toEqual([`/api/search/bruno?q=${encodeURIComponent(Q)}&stream=1`]);
  });
  it("nothing in hand: he waits for the page's own search", async () => {
    show();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(asked).toEqual([]);
  });
});
