// @vitest-environment jsdom
// A match's Watch: on the event page it plays the page's recording from the match's second (again from the
// start of the match on a second tap), and with no player on the page it's a plain link to YouTube there.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // From the match's second, with YouTube's message channel on for this page only (lib/ytBridge.ts).
    const src = new URL(first.getAttribute("src")!);
    expect(`${src.origin}${src.pathname}`).toBe(stream.streamUrl);
    expect(Object.fromEntries(src.searchParams)).toEqual({ autoplay: "1", rel: "0", start: "100", enablejsapi: "1", origin: window.location.origin });
    fireEvent.click(link);
    const again = document.querySelector("iframe")!;
    expect(again).not.toBe(first); // the player isn't listening (no YouTube here), so a new one: back to the match's start
    expect(again.getAttribute("src")).toContain("start=100");
  });

  it("Close video stops it: back to the picture, nothing playing", () => {
    render(<MemoryRouter><WatchLive d={d} stream={stream} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Close video" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Play:/ }));
    expect(document.querySelector("iframe")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /^Play:/ })).toBeTruthy();
  });

  it("with no player on the page, it's YouTube's link at that second", () => {
    render(<ClipLink clip={clip}>Watch</ClipLink>);
    const link = screen.getByRole("link", { name: /Watch this match/ });
    expect(link.getAttribute("href")).toBe(clip.url);
    expect(fireEvent.click(link)).toBe(true); // followed
  });
  it("the model's call shows over a recording at the match on screen, and the switch hides it (remembered)", () => {
    localStorage.removeItem("cs-video-predictions");
    const played = {
      key: "qual:0:1", label: "Q1", played: true, clip,
      red: { teams: [{ number: 7842, onField: true }, { number: 35722, onField: true }], score: { total: 24 } },
      blue: { teams: [{ number: 24378, onField: true }, { number: 19459, onField: true }], score: { total: 28 } },
      prediction: { pRed: 0.61 },
    };
    const dd = { ...d, matches: [played] } as unknown as EventDetail;
    render(<MemoryRouter><WatchLive d={dd} stream={stream} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Play:/ }));
    const frame = document.querySelector("iframe")!;
    // The player reports it's 30 s into Q1 (100 s is the clip's start, lead-in included).
    const report = (t: number) => act(() => { window.dispatchEvent(new MessageEvent("message", { origin: "https://www.youtube-nocookie.com", source: frame.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { currentTime: t, playerState: 1 } }) })); });
    report(150);
    const card = () => document.querySelector("[data-video-predictions]");
    expect(card()?.getAttribute("data-video-predictions")).toBe("playing");
    expect(card()?.textContent).toContain("Q1");
    expect(card()?.textContent).toContain("7842 · 35722");
    expect(card()?.textContent).toContain("Model: Red 61%");
    // After the match: its result and how the call went.
    report(100 + 20 + 158 + 5);
    expect(card()?.textContent).toContain("24–28");
    expect(card()?.textContent).toContain("Upset");
    // Off: gone, and remembered.
    const sw = screen.getByRole("switch", { name: /Predictions on video/ });
    fireEvent.click(sw);
    expect(card()).toBeNull();
    expect(localStorage.getItem("cs-video-predictions")).toBe("0");
  });
});
