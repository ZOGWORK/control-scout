// @vitest-environment jsdom
// Beside a finished event's recording: where the video came from, and the best auto, best TeleOp and closest match,
// each opening its match. A live event keeps its prediction rail there instead.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { detail, m } from "../lib/eventGlance.fixtures";
import { WatchLive } from "./WatchLive";

afterEach(cleanup);
const sc = (total: number, auto: number, teleop: number) => ({ total, np: total, auto, teleop, endgame: 0, pen: 0 });
const matches = [
  m(1, [11, 12], [13, 14], { red: sc(120, 40, 60), blue: sc(80, 50, 20) }),
  m(2, [15, 16], [17, 18], { red: sc(101, 10, 90), blue: sc(98, 12, 70) }),
];
const stream = { videoId: "WQUBVjbh-hM", streamUrl: "https://www.youtube-nocookie.com/embed/WQUBVjbh-hM", origin: "watcher" as const };

describe("the recording's side column", () => {
  it("says where the recording came from and shows the three best-match blocks, each opening its match", () => {
    render(<MemoryRouter><WatchLive d={detail({ status: "finished", matches })} stream={stream} /></MemoryRouter>);
    expect(document.querySelector("[data-recording-origin]")?.textContent).toBe("Found by our watcher on the organiser's YouTube channel.");
    const block = (k: string) => document.querySelector(`[data-best="${k}"]`)!;
    expect(block("auto").textContent).toContain("Best auto");
    expect(block("auto").textContent).toContain("50auto points");
    expect(block("auto").textContent).toContain("13");
    expect(block("teleop").textContent).toContain("90TeleOp points");
    expect(block("closest").textContent).toContain("by 3");
    const open = screen.getAllByRole("link", { name: "Open Q2" });
    expect(open).toHaveLength(2); // best TeleOp and closest
    expect(open[0].getAttribute("href")).toBe("/?tab=matches&match=qual%3A0%3A2");
  });

  it("no blocks without scored matches or while live (the source line stays live), no source line when it isn't known", () => {
    const { unmount } = render(<MemoryRouter><WatchLive d={detail({ status: "finished", matches: [m(1, [1, 2], [3, 4])] })} stream={{ ...stream, origin: undefined }} /></MemoryRouter>);
    expect(document.querySelector("[data-best-matches]")).toBeNull();
    expect(document.querySelector("[data-recording-origin]")).toBeNull();
    unmount();
    render(<MemoryRouter><WatchLive d={detail({ status: "live", matches })} stream={{ ...stream, origin: "first" }} /></MemoryRouter>);
    expect(document.querySelector("[data-best-matches]")).toBeNull();
    expect(document.querySelector("[data-recording-origin]")?.textContent).toMatch(/FIRST's event listing/);
  });
});
