// @vitest-environment jsdom
// An answer's video on /search: the card's player is a picture until clicked (no player loads, nothing plays on its
// own), a listed match with a clip gets a play button that opens the app's video dialog, and no video draws nothing.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchVideo } from "../../../shared/api";
import type { StatAnswer } from "../../../shared/searchStat";
import { onVideoDialog, type MatchPlay } from "../../../lib/streamSeek";
import { AnswerVideoProvider, videoCaption } from "./AnswerVideo";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);

const M10 = "/events/2025/USMACMP?match=playoff:10:1";
const Q12 = "/events/2025/USMACMP?match=qual:0:12";
const stat: StatAnswer = {
  family: "superlative", intent: "season-top-matches", title: "Highest-scoring matches at Massachusetts Championship", scope: [],
  headline: { value: "404 points", label: "M10", href: M10 },
  blocks: [{ kind: "matches", title: "Top alliance scores", rows: [M10, Q12].map((href, i) => ({
    label: i ? "Q12" : "M10", href, event: { label: "Massachusetts Championship", href: "/events/2025/USMACMP" }, season: "2025–26", date: null, alliance: "red" as const, own: 404, opp: 302, result: "W" as const,
  })) }],
  definition: "", source: "",
};
const video: SearchVideo = {
  main: { videoId: "xnQFL9T27fY", t: 33152, kind: "recording", match: "M10" },
  rows: { [Q12]: { videoId: "xnQFL9T27fY", t: 9991, kind: "recording", match: "Q12" } },
};
const draw = (v?: SearchVideo) => render(<MemoryRouter><AnswerVideoProvider video={v}><StatAnswerCard stat={stat} /></AnswerVideoProvider></MemoryRouter>).container;

describe("AnswerVideo", () => {
  it("is a play button until clicked; the click loads the player at the match's second", () => {
    const c = draw(video);
    expect(c.querySelector("iframe")).toBeNull();
    // A recording's picture is whatever was on the field then (another match, an award): none, its caption instead.
    expect(c.querySelector("[data-answer-video] img")).toBeNull();
    expect(c.querySelector("[data-video-caption]")?.textContent).toBe("M10 in the event's recording, from 9:12:32");
    fireEvent.click(c.querySelector("[data-video-facade]")!);
    const src = new URL(c.querySelector("iframe")!.getAttribute("src")!);
    expect(src.origin + src.pathname).toBe("https://www.youtube-nocookie.com/embed/xnQFL9T27fY");
    expect(src.searchParams.get("start")).toBe("33152");
  });

  it("a match's own video shows its picture", () => {
    const c = draw({ main: { videoId: "ruupjlPEQns", t: 0, kind: "match", match: "M10" } });
    expect(c.querySelector("[data-answer-video] img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/ruupjlPEQns/hqdefault.jpg");
  });

  it("one player only: the other listed matches get play buttons that open the video dialog", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    try {
      const c = draw(video);
      expect(c.querySelectorAll("[data-answer-video]")).toHaveLength(1);
      const buttons = c.querySelectorAll<HTMLButtonElement>("[data-row-play]");
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);
      expect(plays).toEqual([{ videoId: "xnQFL9T27fY", t: 9991, label: "Q12 · Massachusetts Championship" }]);
    } finally { off(); }
  });

  it("a row's clip stops the card's player first: never two videos at once", () => {
    const off = onVideoDialog(() => {});
    try {
      const c = draw(video);
      fireEvent.click(c.querySelector("[data-video-facade]")!);
      expect(c.querySelector("iframe")).not.toBeNull();
      fireEvent.click(c.querySelector("[data-row-play]")!);
      expect(c.querySelector("iframe")).toBeNull();
      expect(c.querySelector("[data-video-facade]")).not.toBeNull();
    } finally { off(); }
  });

  it("no video: no player, no button, no empty box or words about it", () => {
    const c = draw(undefined);
    expect(c.querySelector("[data-answer-video], [data-row-play], iframe")).toBeNull();
    expect(c.textContent).not.toMatch(/video/i);
  });

  it("captions name the match once, or the event's stream", () => {
    expect(videoCaption({ videoId: "ruupjlPEQns", t: 0, kind: "match", match: "M1" })).toBe("M1: official match video");
    expect(videoCaption({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream" })).toBe("The event's recording");
    expect(videoCaption({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream", live: true })).toBe("The event's live stream");
  });
});
