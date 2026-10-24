// @vitest-environment jsdom
// A match's Watch: on the event page it plays the page's recording from the match's second (again from the
// start of the match on a second tap), and with no player on the page it's a plain link to YouTube there.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail, MatchClip } from "../shared/api";
import { ClipLink } from "./MatchClip";
import { WatchLive } from "./WatchLive";

const clip: MatchClip = { videoId: "WQUBVjbh-hM", t: 100, url: "https://www.youtube.com/watch?v=WQUBVjbh-hM&t=100s" };
const d = { event: { season: 2025, code: "X", name: "Test Event", status: "finished" }, matches: [{ key: "qual:0:1", clip }] } as unknown as EventDetail;
const stream = { videoId: clip.videoId, streamUrl: `https://www.youtube-nocookie.com/embed/${clip.videoId}` };

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe("Watch", () => {
  it("plays the page's recording from the match's second, and again from there on a second tap", () => {
    render(<MemoryRouter><WatchLive d={d} stream={stream} /><ClipLink clip={clip}>Watch</ClipLink></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Watch the recording" })).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull(); // the facade until a click
    const link = screen.getByRole("link", { name: /Watch this match in the recording, from 1:40/ });
    expect(fireEvent.click(link)).toBe(false); // handled here: no trip to YouTube
    const first = document.querySelector("iframe")!;
    expect(first.getAttribute("src")).toBe(`${stream.streamUrl}?autoplay=1&rel=0&start=100`);
    fireEvent.click(link);
    const again = document.querySelector("iframe")!;
    expect(again).not.toBe(first); // a new player: back to the match's start
    expect(again.getAttribute("src")).toContain("start=100");
  });

  it("with no player on the page, it's YouTube's link at that second", () => {
    render(<ClipLink clip={clip}>Watch</ClipLink>);
    const link = screen.getByRole("link", { name: /Watch this match/ });
    expect(link.getAttribute("href")).toBe(clip.url);
    expect(fireEvent.click(link)).toBe(true); // followed
  });
});
