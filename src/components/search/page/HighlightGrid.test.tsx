// @vitest-environment jsdom
// A highlights answer as a video grid: a tile per match with its reason as its label, a match's own video its picture,
// a recording's second no picture, a match with no clip still listed ("No video"), and one line when nothing has video.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchVideo } from "../../../shared/api";
import type { StatAnswer, StatMatchRow } from "../../../shared/searchStat";
import { onVideoDialog, type MatchPlay } from "../../../lib/streamSeek";
import { AnswerVideoProvider } from "./AnswerVideo";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);

const EV = { label: "Worlds · Jackson Division", href: "/events/2025/FTCCMP1JACK" };
const at = (key: string) => `/events/2025/FTCCMP1JACK?match=${key}`;
const row = (label: string, key: string, note: string): StatMatchRow => ({ label, href: at(key), event: EV, season: "2025–26", date: "2026-04-30", alliance: "red", own: 300, opp: 200, result: "W", note });
const rows = [row("Q12", "qual:0:12", "Best score"), row("Q30", "qual:0:30", "Biggest win"), row("M4", "playoff:4:1", "Best Auto")];
const stat: StatAnswer = {
  family: "superlative", intent: "team-highlights", title: "Highlights at Worlds · Jackson Division, 2025–26", team: { number: 9848, name: "GearView" }, scope: ["2025–26"],
  headline: { value: "300 points", label: "Best score: Q12 at Worlds · Jackson Division", href: rows[0].href },
  blocks: [{ kind: "matches", title: "3 standout matches", rows }], definition: "", source: "",
};
const video: SearchVideo = {
  main: { videoId: "abcdefghijk", t: 0, kind: "match", match: "Q12" }, mainRow: rows[0].href,
  rows: { [rows[1].href]: { videoId: "recordingid", t: 5000, kind: "recording", match: "Q30" } },
};
const draw = (v?: SearchVideo, s: StatAnswer = stat) => render(<MemoryRouter><AnswerVideoProvider video={v}><StatAnswerCard stat={s} /></AnswerVideoProvider></MemoryRouter>).container;

describe("HighlightGrid", () => {
  it("a tile per match, its reason the label; the best one's tile plays the card's own clip", () => {
    const c = draw(video);
    const tiles = [...c.querySelectorAll("[data-video-tile]")];
    expect(tiles.map((t) => [t.getAttribute("data-video-tile"), t.querySelector("[data-tile-note]")?.textContent])).toEqual([["Q12", "Best score"], ["Q30", "Biggest win"], ["M4", "Best Auto"]]);
    // The reason once, on the tile: not again in its match box.
    expect(c.querySelectorAll("[data-note]")).toHaveLength(0);
    expect(tiles[0].querySelector("img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
    // A second in the recording: no picture of whatever else was on the field, its time instead.
    expect(tiles[1].querySelector("img")).toBeNull();
    expect(tiles[1].textContent).toContain("In the event's recording, from 1:23:20");
    expect(tiles[2].querySelector("[data-tile-play]")).toBeNull();
    expect(tiles[2].querySelector("[data-no-video]")?.textContent).toBe("No video");
    expect(c.querySelector("[data-no-recording]")).toBeNull();
    // The tile's picture plays it; the box under it has no second button.
    expect(c.querySelectorAll("[data-row-play]")).toHaveLength(0);
  });

  it("a tile plays in the video dialog and stops the card's player: one video at a time", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    try {
      const c = draw(video);
      fireEvent.click(c.querySelector("[data-video-facade]")!);
      expect(c.querySelector("iframe")).not.toBeNull();
      fireEvent.click(c.querySelectorAll("[data-tile-play]")[1]);
      expect(plays).toEqual([{ videoId: "recordingid", t: 5000, label: "Q30 · Worlds · Jackson Division" }]);
      expect(c.querySelector("iframe")).toBeNull();
    } finally { off(); }
  });

  it("no video for any of them: the same tiles, stat-led, and one line once", () => {
    const c = draw(undefined);
    expect(c.querySelectorAll("[data-video-tile]")).toHaveLength(3);
    expect(c.querySelectorAll("[data-no-recording]")).toHaveLength(1);
    expect(c.querySelector("[data-no-recording]")?.textContent).toBe("No recording for this event — stats only.");
    expect(c.querySelector("[data-answer-video], [data-tile-play], img")).toBeNull();
  });

  it("matches at several events with no video: said of the matches, not of an event", () => {
    const two = { ...stat, blocks: [{ kind: "matches" as const, title: "2 standout matches", rows: [rows[0], { ...rows[1], event: { label: "Garden Qualifier", href: "/events/2025/USNJQ1" }, href: "/events/2025/USNJQ1?match=qual:0:1" }] }] };
    expect(draw(undefined, two).querySelector("[data-no-recording]")?.textContent).toBe("No video for these matches — stats only.");
  });

  it("a list without reasons stays a list of match boxes", () => {
    const plain = { ...stat, blocks: [{ kind: "matches" as const, title: "Matches", rows: rows.map((r) => ({ ...r, note: undefined })) }] };
    const c = draw(video, plain);
    expect(c.querySelector("[data-video-grid]")).toBeNull();
    expect(c.querySelectorAll("[data-match-box]")).toHaveLength(3);
  });
});
