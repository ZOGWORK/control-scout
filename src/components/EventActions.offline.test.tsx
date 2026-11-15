// @vitest-environment jsdom
// The event page with no connection: the livestream button says it needs one instead of opening a tab that can't
// load, and an event with video says once that its videos need a connection, rather than its Watch buttons going quiet.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EventDetail, MatchView } from "../shared/api";
import { DEMO_KEY } from "../lib/connection";
import { LivestreamButton, OfflineVideoNote, hasEventVideo } from "./EventActions";

const match = (o: Partial<MatchView> = {}): MatchView => ({ key: "qual:0:1", label: "Q1", played: true, video: null, ...o } as MatchView);
const ev = (o: Partial<EventDetail["event"]> = {}, matches: MatchView[] = [match()]) => ({ event: { season: 2026, code: "OFF1", livestream: null, ...o } as EventDetail["event"], matches });
const clip = { videoId: "abcdefghijk", t: 60, url: "https://youtu.be/abcdefghijk?t=60" } as MatchView["clip"];

afterEach(() => { cleanup(); localStorage.removeItem(DEMO_KEY); });

describe("LivestreamButton offline", () => {
  it("opens the stream online", () => {
    render(<LivestreamButton watch={{ url: "https://youtube.com/live/x", stream: false, finished: false }} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://youtube.com/live/x");
  });

  it("is a disabled button saying it needs a connection, from saved data or with no internet", () => {
    render(<LivestreamButton watch={{ url: "https://youtube.com/live/x", stream: false, finished: false }} offline />);
    expect(screen.queryByRole("link")).toBeNull();
    const b = screen.getByRole("button");
    expect(b.textContent).toContain("Livestream needs a connection");
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.className).toContain("max-sm:h-[44px]");
    cleanup();
    localStorage.setItem(DEMO_KEY, "offline");
    render(<LivestreamButton watch={{ url: null, stream: true, finished: true }} />);
    expect(screen.getByRole("button").textContent).toContain("Livestream needs a connection");
  });

  it("still renders nothing with nothing to watch", () => {
    const { container } = render(<LivestreamButton watch={{ url: null, stream: false, finished: false }} offline />);
    expect(container.innerHTML).toBe("");
  });
});

describe("OfflineVideoNote", () => {
  it("knows an event with video", () => {
    expect(hasEventVideo(ev())).toBe(false);
    expect(hasEventVideo(ev({ livestream: "https://youtube.com/live/x" }))).toBe(true);
    expect(hasEventVideo(ev({}, [match({ clip })]))).toBe(true);
    expect(hasEventVideo(ev({}, [match({ video: "https://youtu.be/x" })]))).toBe(true);
  });

  it("says video needs a connection offline, only for an event with video", () => {
    render(<OfflineVideoNote d={ev({ livestream: "https://youtube.com/live/x" })} offline />);
    expect(screen.getByText(/Video needs a connection/).textContent).toContain("Scores, stats and calls here work offline");
    cleanup();
    render(<OfflineVideoNote d={ev()} offline />);
    expect(document.querySelector("[data-offline-video-note]")).toBeNull();
  });

  it("says nothing online", () => {
    render(<OfflineVideoNote d={ev({}, [match({ clip })])} />);
    expect(document.querySelector("[data-offline-video-note]")).toBeNull();
  });
});
