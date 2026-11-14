// @vitest-environment jsdom
// An answer's video on /search: the card's player is a picture until clicked (no player loads, nothing plays on its
// own), a listed match with a clip gets a play button that opens the app's video dialog, one without says "No video", and
// an answer listing matches with no video at all says so in one line.
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
  main: { videoId: "xnQFL9T27fY", t: 33152, kind: "recording", match: "M10" }, mainRow: M10,
  rows: { [Q12]: { videoId: "xnQFL9T27fY", t: 9991, kind: "recording", match: "Q12" } },
};
const draw = (v?: SearchVideo) => render(<MemoryRouter><AnswerVideoProvider video={v}><StatAnswerCard stat={stat} /></AnswerVideoProvider></MemoryRouter>).container;

describe("AnswerVideo", () => {
  it("is a play button until clicked; the click loads the player at the match's second", () => {
    const c = draw(video);
    expect(c.querySelector("iframe")).toBeNull();
    // A recording shows its cover, never a blank player; the caption says which match and from when.
    expect(c.querySelector("[data-answer-video] img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/xnQFL9T27fY/hqdefault.jpg");
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

  it("no video: no player, no button; one line says the event has no recording", () => {
    const c = draw(undefined);
    expect(c.querySelector("[data-answer-video], [data-row-play], [data-row-no-video], iframe")).toBeNull();
    expect(c.querySelectorAll("[data-no-recording]")).toHaveLength(1);
    expect(c.querySelector("[data-no-recording]")?.textContent).toBe("No recording for this event — stats only.");
  });

  it("matches at several events with no video: one line for them all", () => {
    const at = (code: string, key: string, label: string) => ({ label, href: `/events/2025/${code}?match=${key}`, event: { label: code, href: `/events/2025/${code}` }, season: "2025–26", date: null, alliance: "red" as const, own: 1, opp: 0, result: "W" as const });
    const two: StatAnswer = { ...stat, headline: undefined, blocks: [{ kind: "matches", title: "x", rows: [at("USMACMP", "qual:0:1", "Q1"), at("USNJCMP", "qual:0:2", "Q2")] }] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={undefined}><StatAnswerCard stat={two} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.querySelector("[data-no-recording]")?.textContent).toBe("No video for these matches — stats only.");
  });

  it("matches still to play say nothing about video", () => {
    const ahead: StatAnswer = { ...stat, headline: undefined, blocks: [{ kind: "table", title: "Still to play", upcoming: true, columns: [{ key: "match", label: "Match" }], rows: [{ cells: { match: "Q3" }, href: "/events/2026/USMACMP?match=qual:0:3" }] }] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={undefined}><StatAnswerCard stat={ahead} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.querySelector("[data-no-recording]")).toBeNull();
    // A predicted score's match, still to play, too.
    const next: StatAnswer = { ...stat, headline: { value: "120–90", label: "Q3", href: "/events/2026/USMACMP?match=qual:0:3", upcoming: true }, blocks: [] };
    const d = render(<MemoryRouter><AnswerVideoProvider video={undefined}><StatAnswerCard stat={next} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(d.querySelector("[data-no-recording]")).toBeNull();
  });

  it("a match still to play beside played ones gets no \"No video\"", () => {
    const Q1 = "/events/2025/USMACMP?match=qual:0:1", Q2 = "/events/2025/USMACMP?match=qual:0:2";
    const mixed: StatAnswer = { ...stat, headline: undefined, blocks: [{ kind: "table", title: "Before and after", columns: [{ key: "match", label: "Match" }, { key: "after", label: "After" }], rows: [{ cells: { match: "Q1", after: "W 120–90" }, href: Q1 }, { cells: { match: "Q2", after: "Not played yet" }, href: Q2, upcoming: true }] }] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={{ rows: { [Q1]: { videoId: "xnQFL9T27fY", t: 100, end: 300, kind: "recording", match: "Q1" } } }}><StatAnswerCard stat={mixed} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-row-play]").length).toBeGreaterThan(0);
    expect(c.querySelector("[data-row-no-video]")).toBeNull();
  });

  it("a table whose only clip is the card's own match: the other rows say No video", () => {
    const Q1 = "/events/2025/USMACMP?match=qual:0:1", Q2 = "/events/2025/USMACMP?match=qual:0:2";
    const t: StatAnswer = { ...stat, headline: undefined, blocks: [{ kind: "table", title: "Matches", columns: [{ key: "match", label: "Match" }], rows: [{ cells: { match: "Q1" }, href: Q1 }, { cells: { match: "Q2" }, href: Q2 }] }] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={{ main: { videoId: "xnQFL9T27fY", t: 100, end: 300, kind: "recording", match: "Q1" }, mainRow: Q1 }}><StatAnswerCard stat={t} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-row-no-video]")).toHaveLength(1);
  });

  it("an answer about no match says nothing about video", () => {
    const none: StatAnswer = { ...stat, headline: { value: "115.7", label: "OPR" }, blocks: [] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={undefined}><StatAnswerCard stat={none} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.textContent).not.toMatch(/video|recording/i);
  });

  it("the card's own match the only clip: the other listed match says No video", () => {
    const c = draw({ main: video.main, mainRow: M10 });
    expect(c.querySelectorAll("[data-row-play]")).toHaveLength(0);
    expect(c.querySelector("[data-match-box='Q12'] [data-row-no-video]")).not.toBeNull();
    expect(c.querySelector("[data-match-box='M10'] [data-row-no-video]")).toBeNull();
  });

  it("the event's recording from its start is no match's clip: rows say nothing", () => {
    const c = draw({ main: { videoId: "xnQFL9T27fY", t: 0, kind: "stream" } });
    expect(c.querySelector("[data-row-no-video]")).toBeNull();
  });

  it("a listed match with no clip says No video, never a Play that goes nowhere; the card's own match says nothing", () => {
    const Q1 = "/events/2025/USMACMP?match=qual:0:1";
    const three: StatAnswer = { ...stat, blocks: [{ kind: "matches", title: "x", rows: [M10, Q12, Q1].map((href, i) => ({ ...(stat.blocks[0] as Extract<StatAnswer["blocks"][number], { kind: "matches" }>).rows[0], label: ["M10", "Q12", "Q1"][i], href })) }] };
    const c = render(<MemoryRouter><AnswerVideoProvider video={video}><StatAnswerCard stat={three} /></AnswerVideoProvider></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-row-play]")).toHaveLength(1);
    const none = c.querySelectorAll("[data-row-no-video]");
    expect(none).toHaveLength(1);
    expect(none[0].closest("[data-match-box]")?.getAttribute("data-match-box")).toBe("Q1");
    expect(c.querySelector("[data-no-recording]")).toBeNull();
  });

  it("captions name the match once, or the event's stream", () => {
    expect(videoCaption({ videoId: "ruupjlPEQns", t: 0, kind: "match", match: "M1" })).toBe("M1: official match video");
    expect(videoCaption({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream" })).toBe("The event's recording");
    expect(videoCaption({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream", live: true })).toBe("The event's live stream");
  });
});
