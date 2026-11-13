// @vitest-environment jsdom
// An event's highlight videos: labelled as highlights, played in the app's video dialog even when the page has its
// recording player (a highlight is never the event's recording or a match's video), and a plain link to YouTube
// with no dialog or on a modifier click.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import { HighlightVideos } from "./HighlightVideos";
import { VideoDialog } from "./VideoDialog";
import { WatchLive } from "./WatchLive";

const reel = { videoId: "criv3nMj_Kg", title: "Romania Championship 2026 highlights" };
const rec = "pvmxbH8YW-k";
const d = { event: { season: 2025, code: "ROCMP", name: "Romania Championship", status: "finished" }, matches: [] } as unknown as EventDetail;

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe("Highlight videos", () => {
  it("are labelled as highlights and play in the dialog, not the page's recording player", () => {
    render(<MemoryRouter><WatchLive d={d} stream={{ videoId: rec, streamUrl: `https://www.youtube-nocookie.com/embed/${rec}` }} /><HighlightVideos videos={[reel]} /><VideoDialog /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Highlight videos" })).toBeTruthy();
    const link = screen.getByRole("link", { name: `Play highlight video: ${reel.title}` });
    expect(link.textContent).toMatch(/Highlights/);
    expect(fireEvent.click(link)).toBe(false); // handled in the app
    const frames = [...document.querySelectorAll("iframe")];
    expect(frames).toHaveLength(1);
    expect(frames[0].closest("[data-video-dialog]")).toBeTruthy();
    expect(frames[0].getAttribute("src")).toContain(reel.videoId);
    expect(document.querySelector("[data-watch-live] iframe")).toBeNull(); // the recording stays as it was
    expect(screen.getByRole("dialog").textContent).toMatch(/highlight video/i);
    expect(screen.queryByText(/official match video/)).toBeNull();
  });

  it("is a plain YouTube link with no dialog, or on a modifier click", () => {
    render(<HighlightVideos videos={[reel]} />);
    const link = screen.getByRole("link", { name: `Play highlight video: ${reel.title}` });
    expect(link.getAttribute("href")).toBe(`https://www.youtube.com/watch?v=${reel.videoId}`);
    expect(fireEvent.click(link)).toBe(true);
    cleanup();
    render(<><HighlightVideos videos={[reel]} /><VideoDialog /></>);
    expect(fireEvent.click(screen.getByRole("link"), { ctrlKey: true })).toBe(true);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows nothing without videos", () => {
    const { container } = render(<HighlightVideos videos={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
