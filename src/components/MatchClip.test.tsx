// @vitest-environment jsdom
// A match's Watch: on the event page it plays the page's recording from the match's second (again from the
// start of the match on a second tap); with no player on the page, the app's video dialog plays it. A match's own
// video (FIRST's) plays the same way. With neither mounted, or on a modifier click, it's a plain link to YouTube.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail, MatchClip } from "../shared/api";
import { ClipLink, linkStart, MatchVideoLink } from "./MatchClip";
import { VideoDialog } from "./VideoDialog";
import { onStreamSeek, onVideoDialog, playMatchVideo } from "../lib/streamSeek";
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
  it("with the video open and the player answering, Watch moves it within the video (same player, seekTo then play)", () => {
    render(<MemoryRouter><WatchLive d={d} stream={stream} /><ClipLink clip={clip}>Watch</ClipLink></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Play:/ }));
    const frame = document.querySelector("iframe")!;
    const sent: unknown[] = [];
    Object.defineProperty(frame, "contentWindow", { configurable: true, value: { postMessage: (m: string) => sent.push(JSON.parse(m)) } });
    // The player answers: from here on it takes commands.
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: "https://www.youtube-nocookie.com", source: frame.contentWindow as unknown as Window, data: JSON.stringify({ event: "infoDelivery", info: { currentTime: 12, playerState: 1 } }) })); });
    sent.length = 0;
    expect(fireEvent.click(screen.getByRole("link", { name: /Watch this match/ }))).toBe(false);
    expect(document.querySelector("iframe")).toBe(frame); // no reload
    expect(sent).toEqual([
      { event: "command", func: "seekTo", args: [100, true], id: 1, channel: "widget" },
      { event: "command", func: "playVideo", args: [], id: 1, channel: "widget" },
    ]);
  });
  it("a match's own video plays in the page's player, with the way back to the recording", () => {
    const m = { key: "qual:0:1", label: "Q1", played: false, red: { teams: [] }, blue: { teams: [] }, prediction: null, video: "https://www.youtube.com/watch?v=Ve9_fshsUec" };
    render(<MemoryRouter><WatchLive d={{ ...d, matches: [m] } as unknown as EventDetail} stream={stream} /><MatchVideoLink url={m.video} label="Q1" matchKey={m.key} /></MemoryRouter>);
    expect(fireEvent.click(screen.getByRole("link", { name: "Official video of Q1" }))).toBe(false);
    expect(new URL(document.querySelector("iframe")!.getAttribute("src")!).pathname).toBe("/embed/Ve9_fshsUec");
    expect(screen.getByText("Q1: official match video")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the recording" }));
    expect(new URL(document.querySelector("iframe")!.getAttribute("src")!).pathname).toBe(`/embed/${clip.videoId}`);
    expect(screen.queryByText("Q1: official match video")).toBeNull();
  });
});

describe("an event broadcast a day at a time", () => {
  const SUN = "G4HPbJNLeLE";
  const sunClip: MatchClip = { videoId: SUN, t: 1780, url: `https://www.youtube.com/watch?v=${SUN}&t=1780s` };
  const days = { ...stream, days: [{ videoId: clip.videoId, label: "Saturday" }, { videoId: SUN, label: "Sunday" }] };
  const path = () => new URL(document.querySelector("iframe")!.getAttribute("src")!).pathname;
  it("a match's Watch plays its own day's video, never as an official match video; the day buttons switch", () => {
    render(<MemoryRouter><WatchLive d={d} stream={days} /><ClipLink clip={sunClip} label="Q60">Watch</ClipLink></MemoryRouter>);
    const sat = screen.getByRole("button", { name: "Saturday" }), sun = screen.getByRole("button", { name: "Sunday" });
    expect(sat.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("link", { name: /Watch Q60 in the recording/ }));
    expect(path()).toBe(`/embed/${SUN}`);
    expect(document.querySelector("iframe")!.getAttribute("src")).toContain("start=1780");
    expect(screen.queryByText(/official match video/)).toBeNull();
    expect(sun.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sat);
    expect(path()).toBe(`/embed/${clip.videoId}`);
    expect(document.querySelector("iframe")!.getAttribute("src")).not.toContain("start=");
  });
  it("one video: no day buttons", () => {
    render(<MemoryRouter><WatchLive d={d} stream={stream} /></MemoryRouter>);
    expect(document.querySelector("[data-stream-days]")).toBeNull();
  });
});

describe("playMatchVideo", () => {
  it("goes to the page's player first, then the dialog, else nowhere", () => {
    expect(playMatchVideo({ videoId: "abcdefghijk", t: 5, label: "Q1" })).toBe(false);
    const dialog = vi.fn(), player = vi.fn();
    const offDialog = onVideoDialog(dialog);
    const offPlayer = onStreamSeek(player);
    expect(playMatchVideo({ videoId: "abcdefghijk", t: 5, label: "Q1" })).toBe(true);
    expect(player).toHaveBeenCalledWith({ videoId: "abcdefghijk", t: 5, label: "Q1" });
    offPlayer();
    playMatchVideo({ videoId: "abcdefghijk", t: 0, label: "Q2" });
    expect(dialog).toHaveBeenCalledWith({ videoId: "abcdefghijk", t: 0, label: "Q2" });
    offDialog();
  });
});

describe("match video links", () => {
  it("an official video plays in the app's dialog when the page has no player", () => {
    render(<><VideoDialog /><MatchVideoLink url="https://www.youtube.com/watch?v=Ve9_fshsUec" label="Q1" matchKey="q1" /></>);
    const link = screen.getByRole("link", { name: "Official video of Q1" });
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=Ve9_fshsUec");
    act(() => { fireEvent.click(link); });
    const frame = document.querySelector("[data-video-dialog] iframe") as HTMLIFrameElement;
    expect(frame.src).toBe("https://www.youtube-nocookie.com/embed/Ve9_fshsUec?autoplay=1&rel=0");
  });

  it("a recording's Watch plays from the match's second", () => {
    render(<><VideoDialog /><ClipLink clip={{ videoId: "96RZLC94jE4", t: 2863, url: "https://www.youtube.com/watch?v=96RZLC94jE4&t=2863s" }} label="Q5">Watch</ClipLink></>);
    act(() => { fireEvent.click(screen.getByRole("link", { name: /Watch Q5 in the recording/ })); });
    expect((document.querySelector("[data-video-dialog] iframe") as HTMLIFrameElement).src).toContain("/embed/96RZLC94jE4?autoplay=1&rel=0&start=2863");
  });

  it("a modifier click is left to the link, and a click never opens the row it sits in", () => {
    const play = vi.fn(), row = vi.fn();
    const off = onStreamSeek(play);
    render(<div onClick={row}><MatchVideoLink url="https://youtu.be/Ve9_fshsUec" label="Q1" /></div>);
    const link = screen.getByRole("link", { name: "Official video of Q1" });
    fireEvent.click(link, { ctrlKey: true });
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(play).toHaveBeenCalledWith({ videoId: "Ve9_fshsUec", t: 0, label: "Q1", matchKey: undefined });
    expect(row).not.toHaveBeenCalled();
    off();
  });

  it("a video link that isn't YouTube stays a plain link out", () => {
    const play = vi.fn();
    const off = onStreamSeek(play);
    render(<MatchVideoLink url="https://vimeo.com/12345" label="Q1" />);
    fireEvent.click(screen.getByRole("link", { name: "Official video of Q1" }));
    expect(play).not.toHaveBeenCalled();
    off();
  });
});

describe("a match's own video, with the call over it", () => {
  it("shows the result only once it stops a match's length past where its link starts", () => {
    localStorage.removeItem("cs-video-predictions");
    const m = { key: "qual:0:1", label: "Q1", played: true, red: { teams: [{ number: 1, onField: true }], score: { total: 30 } }, blue: { teams: [{ number: 2, onField: true }], score: { total: 20 } }, prediction: { pRed: 0.6 }, video: "https://www.youtube.com/watch?v=Ve9_fshsUec&t=3600" };
    render(<MemoryRouter><WatchLive d={{ ...d, matches: [m] } as unknown as EventDetail} stream={stream} /><MatchVideoLink url={m.video} label="Q1" matchKey={m.key} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Official video of Q1" }));
    const frame = document.querySelector("iframe")!;
    const report = (t: number, playerState: number) => act(() => { window.dispatchEvent(new MessageEvent("message", { origin: "https://www.youtube-nocookie.com", source: frame.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { currentTime: t, playerState } }) })); });
    const phase = () => document.querySelector("[data-video-predictions]")?.getAttribute("data-video-predictions");
    report(3610, 2); // paused 10 s in: the match isn't over
    expect(phase()).toBe("playing");
    report(3600 + 170, 0); // ended past the match's length
    expect(phase()).toBe("after");
  });
});

describe("a video link's own start", () => {
  it("reads t= and start= in seconds or h/m/s, else 0", () => {
    expect(["https://www.youtube.com/watch?v=Ve9_fshsUec&t=90s", "https://youtu.be/Ve9_fshsUec?t=1m30s", "https://www.youtube.com/watch?v=Ve9_fshsUec&start=90",
      "https://www.youtube.com/watch?v=Ve9_fshsUec#t=90", "https://www.youtube.com/watch?v=Ve9_fshsUec&t=1h", "https://www.youtube.com/watch?v=Ve9_fshsUec", "https://www.youtube.com/watch?v=Ve9_fshsUec&t=abc", "not a link"].map(linkStart))
      .toEqual([90, 90, 90, 90, 3600, 0, 0, 0]);
  });
  it("a timestamped official video plays from there", () => {
    const play = vi.fn();
    const off = onStreamSeek(play);
    render(<MatchVideoLink url="https://youtu.be/Ve9_fshsUec?t=45" label="Q1" />);
    fireEvent.click(screen.getByRole("link", { name: "Official video of Q1" }));
    expect(play).toHaveBeenCalledWith({ videoId: "Ve9_fshsUec", t: 45, label: "Q1", matchKey: undefined });
    off();
  });
});
