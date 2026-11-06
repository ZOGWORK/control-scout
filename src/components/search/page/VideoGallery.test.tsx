// @vitest-environment jsdom
// A video page: the event's stream, every match with a video (none without), the qualifications/playoffs filter, a
// tap playing in the video dialog, the first 24 then "Show all", and one line when nothing has a video.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchVideo } from "../../../shared/api";
import type { StatAnswer, VideoTile } from "../../../shared/searchStat";
import { onVideoDialog, type MatchPlay } from "../../../lib/streamSeek";
import { AnswerVideoProvider } from "./AnswerVideo";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);

const EV = "/events/2025/FTCCMP1JACK";
const tile = (label: string, key: string, level: "qual" | "playoff", red = 100, blue = 90): VideoTile => ({ label, href: `${EV}?match=${key}`, level, red: [4215], blue: [6980], redScore: red, blueScore: blue, date: "2026-04-30" });
const quals = Array.from({ length: 30 }, (_, i) => tile(`Q${i + 1}`, `qual:0:${i + 1}`, "qual"));
const tiles = [...quals, tile("M1", "playoff:1:1", "playoff", 80, 95), tile("M2", "playoff:2:1", "playoff")];
const stat = (empty?: { text: string; href?: string }): StatAnswer => ({
  family: "superlative", intent: "scope-highlights", title: "Match videos at Worlds · Jackson Division, 2025–26", scope: ["2025–26"], definition: "", source: "",
  blocks: [{ kind: "videos", title: "Every match", tiles, streams: [{ label: "Worlds · Jackson Division", href: EV }], ...(empty ? { empty } : {}) }],
});
// Every match has a video but Q30 and M2; the event has its recording.
const video: SearchVideo = { rows: {
  ...Object.fromEntries(tiles.filter((t) => t.label !== "Q30" && t.label !== "M2").map((t, i) => [t.href, { videoId: "abcdefghijk", t: i, kind: "match" as const, match: t.label }])),
  [EV]: { videoId: "recordingid", t: 0, kind: "stream" },
} };
const draw = (v?: SearchVideo, s = stat()) => render(<MemoryRouter><AnswerVideoProvider video={v}><StatAnswerCard stat={s} /></AnswerVideoProvider></MemoryRouter>).container;
const labels = (c: HTMLElement) => [...c.querySelectorAll("[data-video-tile]")].map((t) => t.getAttribute("data-video-tile"));

describe("VideoGallery", () => {
  it("the stream, then every match with a video in order (24 first), its teams and score in their alliance's colours", () => {
    const c = draw(video);
    expect(c.querySelector("[data-video-stream]")?.textContent).toContain("Worlds · Jackson Division");
    expect(labels(c)).toEqual(quals.slice(0, 24).map((t) => t.label));
    expect(c.querySelector('section[aria-label="Every match"] h3')?.textContent).toBe("Every match · 30");
    fireEvent.click(c.querySelector("[data-video-more]")!);
    // Q30 and M2 have no video: not drawn.
    expect(labels(c)).toEqual([...quals.slice(0, 29).map((t) => t.label), "M1"]);
    const m1 = c.querySelector('[data-video-tile="M1"] [data-tile-score]')!;
    expect(m1.querySelector(".text-blue-alliance-text.font-bold")?.textContent).toBe("95");
  });

  it("the filter: qualifications or playoffs, every tile of either", () => {
    const c = draw(video);
    fireEvent.click(c.querySelector('[data-video-level="playoff"]')!);
    expect(labels(c)).toEqual(["M1"]);
    fireEvent.click(c.querySelector('[data-video-level="qual"]')!);
    expect(labels(c)).toHaveLength(24);
    expect(c.querySelector('[data-video-level="all"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("a tap plays in the video dialog; the stream plays from its start", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    try {
      const c = draw(video);
      fireEvent.click(c.querySelector('[data-video-tile="Q2"] button')!);
      fireEvent.click(c.querySelector("[data-video-stream] button")!);
      expect(plays).toEqual([{ videoId: "abcdefghijk", t: 1, label: "Q2" }, { videoId: "recordingid", t: 0, label: "Worlds · Jackson Division" }]);
    } finally { off(); }
  });

  it("a filter the last answer had and this one lacks: all of this one's tiles", () => {
    const r = render(<MemoryRouter><AnswerVideoProvider video={video}><StatAnswerCard stat={stat()} /></AnswerVideoProvider></MemoryRouter>);
    fireEvent.click(r.container.querySelector('[data-video-level="playoff"]')!);
    const qualsOnly: StatAnswer = { ...stat(), blocks: [{ kind: "videos", title: "Every match", tiles: quals.slice(0, 3) }] };
    r.rerender(<MemoryRouter><AnswerVideoProvider video={video}><StatAnswerCard stat={qualsOnly} /></AnswerVideoProvider></MemoryRouter>);
    expect(labels(r.container)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("a list cut short (too many matches): why, never that there's no video", () => {
    const big: StatAnswer = { ...stat(), blocks: [{ kind: "videos", title: "Every match", tiles: [], more: "Too many matches to list here; open an event for each match's video." }] };
    const c = draw(video, big);
    expect(c.querySelector("[data-videos-more]")?.textContent).toBe("Too many matches to list here; open an event for each match's video.");
    expect(c.querySelector("[data-videos-empty]")).toBeNull();
  });

  it("nothing with a video: one line and where to look; no line when the page has none to say", () => {
    const c = draw(undefined, stat({ text: "No match videos at Worlds · Jackson Division in 2025–26 yet.", href: EV }));
    expect(c.querySelector("[data-videos-empty]")?.textContent).toBe("No match videos at Worlds · Jackson Division in 2025–26 yet. Open the event");
    expect(c.querySelector("[data-video-tile], [data-video-stream]")).toBeNull();
    expect(draw(undefined).querySelector("[data-block=videos], [data-videos-empty]")).toBeNull();
  });
});
