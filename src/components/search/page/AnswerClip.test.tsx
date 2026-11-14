// @vitest-environment jsdom
// "View clip" under People also ask: a card or stat answer's one match, to watch. It names the headline's match, plays
// that match's own clip exactly as the answer's video has it (FIRST's video from its start, or the match's second in the
// event's recording) in the app's video dialog, stops the card's player first, and is never drawn for anything else:
// no video, an event's stream, another match than the headline's, or a search with no card.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchAnswer, SearchVideo } from "../../../shared/api";
import type { StatAnswer } from "../../../shared/searchStat";
import { onVideoDialog, type MatchPlay } from "../../../lib/streamSeek";
import { AnswerClip, AnswerVideoProvider, clipLabel } from "./AnswerVideo";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);

const M14 = "/events/2025/AUCMP?match=playoff:14:1";
const stat: StatAnswer = {
  family: "superlative", intent: "highest-auto", title: "Highest Auto score in 2025–26", scope: [],
  headline: { value: "74 points", label: "Auto in M14 at Australia Championship", href: M14 },
  blocks: [], definition: "", source: "",
};
const recording: SearchVideo = { main: { videoId: "-gdrLqNvnuw", t: 29059, kind: "recording", match: "M14" }, mainRow: M14 };
const official: SearchVideo = { main: { videoId: "JBqOIcqnd6M", t: 0, kind: "match", match: "Q137" }, mainRow: "/events/2025/FTCCMP1FRAN?match=qual:0:137" };
const answer = (video?: SearchVideo, s: StatAnswer | undefined = stat): Pick<SearchAnswer, "stat" | "card" | "video"> => ({ stat: s, video });

describe("clipLabel: whether an answer gets View clip, and what it names", () => {
  it("a stat answer whose video is its headline's match: the headline", () => {
    expect(clipLabel(answer(recording))).toBe("Auto in M14 at Australia Championship");
    const q137 = { ...stat, headline: { value: "97 points", label: "Auto in Q137 at Worlds · Franklin Division", href: official.mainRow! } };
    expect(clipLabel(answer(official, q137))).toBe("Auto in Q137 at Worlds · Franklin Division");
  });

  it("none for no video, the headline's match with no clip, or an event's stream from its start", () => {
    expect(clipLabel(answer(undefined))).toBeNull();
    expect(clipLabel(answer({ watch: { videoId: "-gdrLqNvnuw", t: 0, kind: "stream", match: "M14" } }))).toBeNull();
    expect(clipLabel(answer({ main: { videoId: "-gdrLqNvnuw", t: 0, kind: "stream" } }))).toBeNull();
  });

  it("never another match than the headline's (a highlights page's tile, a listed match)", () => {
    expect(clipLabel(answer({ ...recording, mainRow: "/events/2025/AUCMP?match=qual:0:3" }))).toBeNull();
    expect(clipLabel(answer(recording, { ...stat, headline: undefined }))).toBeNull();
  });

  it("none for a page of match videos (highlights): each tile already plays its own, the top one included", () => {
    const highlights: StatAnswer = { ...stat, intent: "scope-highlights", blocks: [{ kind: "videos", title: "Every match", tiles: [] }] };
    expect(clipLabel(answer(recording, highlights))).toBeNull();
  });

  it("a card about one match: the card's title; a search with no card or stat: none (its results already play it)", () => {
    const card = { kind: "facts", title: "Q42 at APOC", lines: [] } as unknown as SearchAnswer["card"];
    expect(clipLabel({ card, video: recording })).toBe("Q42 at APOC");
    expect(clipLabel({ video: recording })).toBeNull();
    expect(clipLabel(null)).toBeNull();
  });
});

const draw = (v: SearchVideo | undefined, withCard = false) => render(
  <MemoryRouter><AnswerVideoProvider video={v}>{withCard && <StatAnswerCard stat={stat} />}<AnswerClip about={clipLabel(answer(v)) ?? undefined} /></AnswerVideoProvider></MemoryRouter>,
).container;

describe("AnswerClip: the View clip button", () => {
  it("plays the match's own clip, from the match's second in the recording, in the app's video dialog", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    try {
      const c = draw(recording);
      const box = c.querySelector("[data-answer-clip]")!;
      expect(box.getAttribute("data-answer-clip")).toBe("recording");
      expect(box.textContent).toContain("Watch this match");
      expect(box.querySelector("[data-video-caption]")?.textContent).toBe("M14 in the event's recording, from 8:04:19");
      const button = box.querySelector<HTMLButtonElement>("button")!;
      expect(button.textContent).toBe("View clip");
      expect(button.getAttribute("aria-label")).toBe("View clip: Auto in M14 at Australia Championship");
      fireEvent.click(button);
      // The same second the answer's own video has: the whole match from its start, no cut of its Auto.
      expect(plays).toEqual([{ videoId: "-gdrLqNvnuw", t: 29059, label: "Auto in M14 at Australia Championship" }]);
    } finally { off(); }
  });

  it("FIRST's own match video plays from its start", () => {
    const plays: MatchPlay[] = [];
    const off = onVideoDialog((p) => plays.push(p));
    try {
      const c = draw(official);
      expect(c.querySelector("[data-answer-clip]")?.getAttribute("data-answer-clip")).toBe("match");
      fireEvent.click(c.querySelector("[data-answer-clip] button")!);
      expect(plays).toEqual([{ videoId: "JBqOIcqnd6M", t: 0, label: "Q137" }]);
    } finally { off(); }
  });

  it("stops the card's player first: never two videos at once", () => {
    const off = onVideoDialog(() => {});
    try {
      const c = draw(recording, true);
      fireEvent.click(c.querySelector("[data-video-facade]")!);
      expect(c.querySelector("iframe")).not.toBeNull();
      fireEvent.click(c.querySelector("[data-answer-clip] button")!);
      expect(c.querySelector("iframe")).toBeNull();
    } finally { off(); }
  });

  it("nothing at all with no clip of a match: no box, no button, no words about it", () => {
    for (const v of [undefined, { watch: { videoId: "x", t: 0, kind: "stream" as const, match: "M14" } }, { main: { videoId: "x", t: 0, kind: "stream" as const } }]) {
      const c = draw(v);
      expect(c.querySelector("[data-answer-clip]")).toBeNull();
      expect(c.textContent).toBe("");
    }
  });
});
