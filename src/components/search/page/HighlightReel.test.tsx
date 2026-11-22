// @vitest-environment jsdom
// A team's highlights as video cards: standout matches first, then every clipped match by the team's points; a card
// plays in the app's video dialog; another season's clips say which; the events' recordings when no match has a clip;
// the server's one line when nothing plays anywhere.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchVideo } from "../../../shared/api";
import type { StatAnswer, StatBlock, StatMatchRow, VideoTile } from "../../../shared/searchStat";
import { onVideoDialog, type MatchPlay } from "../../../lib/streamSeek";
import { AnswerVideoProvider } from "./AnswerVideo";
import { HighlightReel } from "./HighlightReel";

afterEach(cleanup);

const EV = { label: "NTX I-League Meet #1", href: "/events/2026/USTXNONIM1" };
const at = (n: number) => `/events/2026/USTXNONIM1?match=qual:0:${n}`;
const row = (n: number, note: string, own: number): StatMatchRow => ({ label: `Q${n}`, href: at(n), event: EV, season: "2026–27", date: "2026-10-31", alliance: "red", own, opp: 100, result: "W", note });
const tile = (n: number, own: number, over: Partial<VideoTile> = {}): VideoTile => ({ label: `Q${n}`, href: at(n), level: "qual", red: [19564, 1], blue: [2, 3], redScore: own, blueScore: 50, date: "2026-10-31", ...over });
const stat = (blocks: StatBlock[]): StatAnswer => ({ family: "superlative", intent: "team-highlights", title: "Highlights, 2026–27", team: { number: 19564, name: "ITKAN Solar" }, scope: ["2026–27"], blocks, definition: "", source: "" });
const rec = (n: number, t: number): NonNullable<SearchVideo["rows"]> => ({ [at(n)]: { videoId: "zDyuEfqXA7w", t, end: t + 230, kind: "recording", match: `Q${n}` } });
const draw = (s: StatAnswer, v?: SearchVideo | null) => render(<MemoryRouter><AnswerVideoProvider video={v}><HighlightReel stat={s} /></AnswerVideoProvider></MemoryRouter>).container;
const cards = (c: HTMLElement) => [...c.querySelectorAll("[data-reel-card]")].map((x) => x.getAttribute("data-reel-card"));

const standout: StatBlock = { kind: "matches", title: "2 standout matches", rows: [row(21, "Best score", 184), row(11, "Biggest win", 179)] };
const every: StatBlock = { kind: "videos", title: "Every match", tiles: [tile(3, 120), tile(11, 179), tile(15, 150), tile(21, 184), tile(25, 119)], streams: [{ label: "NTX I-League Meet #1", href: EV.href }] };
const video: SearchVideo = { rows: { ...rec(3, 3936), ...rec(11, 6732), ...rec(15, 10625), ...rec(21, 15482), ...rec(25, 17018), [EV.href]: { videoId: "zDyuEfqXA7w", t: 0, kind: "stream" } } };

describe("HighlightReel", () => {
  it("standout matches first, then the rest by points; title, why, score and day on each card", () => {
    const c = draw(stat([standout, every]), video);
    expect(cards(c)).toEqual(["Q21", "Q11", "Q15", "Q3", "Q25"]);
    const first = c.querySelector("[data-reel-card]")!;
    expect(first.querySelector("[data-reel-title]")?.textContent).toBe("Q21 · NTX I-League Meet #1");
    expect(first.textContent).toContain("Best score · 184–100");
    expect(first.textContent).toContain("Oct 31, 2026");
    expect(first.querySelector("[data-reel-length]")?.textContent).toBe("3:50");
    expect(first.querySelector("[data-reel-match]")?.textContent).toBe("Q21");
    expect(first.querySelector("img")?.getAttribute("src")).toContain("zDyuEfqXA7w");
    expect(first.querySelector("button")?.getAttribute("aria-label")).toBe("Play Q21 · NTX I-League Meet #1, Best score: in the event's recording, from 4:18:02");
  });

  it("a card plays its clip in the app's video dialog", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    const c = draw(stat([standout, every]), video);
    fireEvent.click(c.querySelector("[data-reel-card] button")!);
    off();
    expect(plays).toMatchObject([{ videoId: "zDyuEfqXA7w", t: 15482, end: 15712, label: "Q21 · NTX I-League Meet #1" }]);
  });

  it("six cards, the rest a tap away", () => {
    const many: StatBlock = { kind: "videos", title: "Every match", tiles: Array.from({ length: 9 }, (_, i) => tile(i + 1, 100 + i)) };
    const v: SearchVideo = { rows: Object.assign({}, ...Array.from({ length: 9 }, (_, i) => rec(i + 1, i * 300))) };
    const c = draw(stat([many]), v);
    expect(cards(c)).toHaveLength(6);
    fireEvent.click(c.querySelector("[data-reel-more]")!);
    expect(cards(c)).toHaveLength(9);
  });

  it("another season's clips when this one has none, saying which", () => {
    const href = "/events/2025/FTCCMP1JACK?match=qual:0:7";
    const other: StatBlock = { kind: "videos", title: "Match videos, 2025–26", season: 2025, tiles: [tile(7, 300, { href, event: "Jackson Division" })] };
    const c = draw(stat([every, other]), { rows: { [href]: { videoId: "pC9c2m_Z0t8", t: 0, kind: "match", match: "Q7" } } });
    expect(cards(c)).toEqual(["Q7"]);
    expect(c.querySelector("[data-reel-season]")?.textContent).toBe("· from 2025–26, none from 2026–27 yet");
    expect(c.querySelector("[data-reel-title]")?.textContent).toBe("Q7 · Jackson Division");
  });

  it("no match clip anywhere: the event's whole recording", () => {
    const c = draw(stat([standout, every]), { rows: { [EV.href]: { videoId: "zDyuEfqXA7w", t: 0, kind: "stream" } } });
    expect(c.querySelector("[data-reel-card]")?.textContent).toContain("Full recording");
    expect(c.querySelector("[data-reel-match]")).toBeNull();
  });

  it("nothing plays in any season: the server's one line, only once the video is read", () => {
    const none = stat([{ ...every, empty: { text: "No match video of 19564 in any season yet.", href: "/teams/19564" } } as StatBlock]);
    expect(draw(none, undefined).querySelector("[data-reel-empty]")).toBeNull();
    cleanup();
    expect(draw(none, null).querySelector("[data-reel-empty]")?.textContent).toContain("No match video of 19564 in any season yet.");
  });
});
