// @vitest-environment jsdom
// A team's highlights on /search (v8): the team's card and its related searches first, so the search reads as
// understood as that team; then its videos; then its standout matches (the owner, 11-26: "desoto technix highlights
// at worlds" led with the videos and the team sat under them).
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchVideo } from "../shared/api";
import type { StatAnswer, StatBlock, StatMatchRow, VideoTile } from "../shared/searchStat";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: false, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../components/search/page/FollowUps", async (orig) => ({
  ...(await orig<typeof import("../components/search/page/FollowUps")>()),
  useFollowUps: () => ({ ask: [], related: [{ q: "23521 record" }, { q: "23521 rating" }, { q: "23521 awards" }], pending: false }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useMediaQuery: () => false }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, error: null, loading: false }) }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }), useTeamFlags: () => ({ bookmarked: false, toggleBookmark: () => {} }) }));

const { default: SearchPage } = await import("./SearchPage");

const EV = { label: "Worlds · Ross Division", href: "/events/2025/FTCCMPROSS" };
const at = (n: number) => `${EV.href}?match=qual:0:${n}`;
const row = (n: number, note: string, own: number): StatMatchRow => ({ label: `Q${n}`, href: at(n), event: EV, season: "2025–26", date: "2026-05-01", alliance: "red", own, opp: 300, result: "W", note });
const tile = (n: number, own: number): VideoTile => ({ label: `Q${n}`, href: at(n), level: "qual", red: [23521, 1], blue: [2, 3], redScore: own, blueScore: 300, date: "2026-05-01" });
const standout: StatBlock = { kind: "matches", title: "2 standout matches", rows: [row(84, "Biggest win", 443), row(48, "Closest win", 350)] };
const every: StatBlock = { kind: "videos", title: "Every match", tiles: [tile(84, 443), tile(48, 350)] };
const video: SearchVideo = { rows: { [at(84)]: { videoId: "zDyuEfqXA7w", t: 100, end: 330, kind: "recording", match: "Q84" }, [at(48)]: { videoId: "zDyuEfqXA7w", t: 900, end: 1130, kind: "recording", match: "Q48" } } };
const highlights = (blocks: StatBlock[]): StatAnswer => ({ family: "superlative", intent: "team-highlights", title: "Highlights at Worlds · Ross Division, 2025–26", team: { number: 23521, name: "DeSoto Technix" }, scope: ["2025–26"], headline: { value: "443 points", label: "Biggest win: Q84", href: at(84) }, blocks, definition: "", source: "" });
const show = (stat: StatAnswer) => {
  state.answer = { q: "desoto technix highlights at worlds", hits: [], pages: [], step: "deterministic", weak: false, stat, video };
  return render(<MemoryRouter initialEntries={["/search?q=desoto%20technix%20highlights%20at%20worlds"]}><SearchPage /></MemoryRouter>).container;
};
/** The answer column's pieces, in page order. */
const order = (c: HTMLElement) => [...c.querySelectorAll('[data-v8-answer="team"], [data-follow-chips], [data-reel], [data-v8-group="standout"]')].map((e) =>
  e.hasAttribute("data-v8-answer") ? "team" : e.hasAttribute("data-follow-chips") ? "chips" : e.hasAttribute("data-reel") ? "videos" : "standout");

afterEach(() => { cleanup(); state.answer = undefined; });

describe("a team's highlights answer, v8", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => document.documentElement.removeAttribute("data-v8"));

  it("puts the team's card and its related searches first, then its videos, then its standout matches", () => {
    expect(order(show(highlights([standout, every])))).toEqual(["team", "chips", "videos", "standout"]);
  });

  it("a team's match videos page keeps the same order", () => {
    expect(order(show({ ...highlights([every]), title: "Match videos at Worlds · Ross Division, 2025–26" }))).toEqual(["team", "chips", "videos"]);
  });

  it("standout matches only (no video list): their clips after the related searches too", () => {
    expect(order(show(highlights([standout])))).toEqual(["team", "chips", "videos", "standout"]);
  });
});
