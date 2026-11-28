// @vitest-environment jsdom
// The watch page's reports follow its player when the page makes it again (a note's moment, say).
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YT_ORIGIN } from "./ytBridge";

const sent = vi.hoisted(() => [] as { key: string; watchedS: number; completed?: boolean }[]);
vi.mock("./videoHistory", () => ({ reportWatch: vi.fn(async (w: { key: string; watchedS: number }) => { sent.push(w); }) }));
const { useWatchReports } = await import("./useWatchReports");

function Player({ t }: { t: number }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useWatchReports(frame, { key: "c:abcdefghijk", kind: "creator", t: 0, duration: 100 }, false, `abcdefghijk:${t}`);
  return <iframe key={t} ref={frame} title="v" />;
}
const say = (f: HTMLIFrameElement, currentTime: number) => act(() => {
  window.dispatchEvent(new MessageEvent("message", { origin: YT_ORIGIN, source: f.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { currentTime, duration: 100, playerState: 1 } }) }));
});

afterEach(() => { cleanup(); sent.length = 0; });

describe("useWatchReports", () => {
  it("listens to the new player after the page loads the video again, without saying 5 s twice", () => {
    const r = render(<Player t={0} />);
    say(r.container.querySelector("iframe")!, 6);
    expect(sent.map((w) => w.watchedS)).toEqual([6]);
    r.rerender(<Player t={40} />);
    const f = r.container.querySelector("iframe")!;
    say(f, 46);
    expect(sent.map((w) => w.watchedS)).toEqual([6]);
    say(f, 55);
    expect(sent.map((w) => w.watchedS)).toEqual([6, 55]);
    say(f, 100);
    expect(sent.at(-1)).toMatchObject({ completed: true });
  });
});
