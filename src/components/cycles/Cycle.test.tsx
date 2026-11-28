// @vitest-environment jsdom
// A clip's player controls, against a player that answers as YouTube's does (lib/ytBridge.ts messages).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleItem } from "../../shared/cycles";
import { YT_ORIGIN } from "../../lib/ytBridge";

vi.mock("../videos/WatchLibrary", () => ({ useItemState: () => null }));
vi.mock("../../lib/videoHistory", () => ({ reportWatch: vi.fn(async () => {}) }));
const { Cycle } = await import("./Cycle");

const item = (o: Partial<CycleItem> = {}): CycleItem => ({
  key: "c:abcdefghijk", videoId: "abcdefghijk", title: "Anti-Jam Intake Biasing by 16010 Astra Machina",
  creator: { id: "yt:UCuJUknE5JjilAfNnmbvr22Q", name: "FUN Robotics Network" }, series: null,
  teams: [{ number: 16010, name: "Astra Machina" }], published: "2026-11-01T00:00:00Z", duration: 45,
  reason: "From FUN Robotics Network", engagement: { likes: 0, reactions: {}, shares: 0 }, ...o,
});

function mount(it: CycleItem = item()) {
  const r = render(<MemoryRouter><Cycle item={it} index={0} active near muted={false} signedIn={false} ready onMute={() => {}} onSignIn={() => {}} /></MemoryRouter>);
  const frame = r.container.querySelector<HTMLIFrameElement>("[data-cycle-player]")!;
  const sent: string[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((m: unknown) => { const c = JSON.parse(String(m)); if (c.event === "command") sent.push(c.func); });
  const say = (playerState: number, currentTime: number) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: YT_ORIGIN, source: frame.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { playerState, currentTime, duration: 45 } }) }));
  });
  const tap = () => { fireEvent.pointerUp(r.container.querySelector("[data-cycle-tap]")!); act(() => { vi.advanceTimersByTime(300); }); };
  const label = () => r.container.querySelector("[data-cycle-tap]")!.getAttribute("aria-label");
  const state = () => r.container.querySelector<HTMLElement>("[data-cycle-state]")!.dataset.cycleState;
  return { ...r, sent, say, tap, label, state };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("a clip's play and pause", () => {
  it("playing shows Pause (to a pointer that hovers); a tap pauses and shows Play; a tap plays it again", () => {
    const c = mount();
    c.say(1, 3);
    expect([c.label(), c.state()]).toEqual(["Pause", "playing"]);
    c.tap();
    expect(c.sent.at(-1)).toBe("pauseVideo");
    expect([c.label(), c.state()]).toEqual(["Play", "paused"]);
    c.say(2, 3.2);
    expect(c.label()).toBe("Play");
    c.tap();
    expect(c.sent.at(-1)).toBe("playVideo");
    // Resumed before the player says so: already Pause, and the fading Play shows what the tap did.
    expect([c.label(), c.state()]).toEqual(["Pause", "playing"]);
    expect(c.container.querySelector("[data-cycle-flash]")).not.toBeNull();
    c.say(1, 3.4);
    expect(c.label()).toBe("Pause");
    // And again: every tap after the first still works.
    c.tap();
    expect([c.sent.at(-1), c.label()]).toEqual(["pauseVideo", "Play"]);
    c.tap();
    expect([c.sent.at(-1), c.label()]).toEqual(["playVideo", "Pause"]);
  });

  it("an autoplay the browser held back shows Play, and a tap starts it", () => {
    const c = mount();
    c.say(-1, 0);
    expect([c.label(), c.state()]).toEqual(["Play", "paused"]);
    c.tap();
    expect(c.sent.at(-1)).toBe("playVideo");
    c.say(1, 0.2);
    expect(c.label()).toBe("Pause");
  });

  it("goes round again at the end from the start, without a playlist (whose own buttons would cover a paused clip)", () => {
    const c = mount();
    expect(c.container.querySelector("[data-cycle-player]")!.getAttribute("src")).not.toMatch(/playlist=|loop=/);
    c.say(1, 44);
    c.say(0, 45);
    expect(c.sent.slice(-2)).toEqual(["seekTo", "playVideo"]);
  });

  it("a click with no pointer (Enter, Space, a screen reader) pauses and plays; a pointer's click is the tap's alone", () => {
    const c = mount();
    c.say(1, 3);
    const tapBox = c.container.querySelector("[data-cycle-tap]")!;
    fireEvent.click(tapBox, { detail: 0 });
    expect([c.sent.at(-1), c.label()]).toEqual(["pauseVideo", "Play"]);
    fireEvent.click(tapBox, { detail: 0 });
    expect([c.sent.at(-1), c.label()]).toEqual(["playVideo", "Pause"]);
    const before = c.sent.length;
    fireEvent.click(tapBox, { detail: 1 });
    expect(c.sent.length).toBe(before);
  });

  it("sound on or off is a command to the loaded player, never a new address (which would start it over)", () => {
    const props = { item: item(), index: 0, active: true, near: true, signedIn: false, ready: true, onMute: () => {}, onSignIn: () => {} };
    const r = render(<MemoryRouter><Cycle {...props} muted /></MemoryRouter>);
    const src = r.container.querySelector("[data-cycle-player]")!.getAttribute("src");
    expect(src).toMatch(/mute=1/);
    r.rerender(<MemoryRouter><Cycle {...props} muted={false} /></MemoryRouter>);
    expect(r.container.querySelector("[data-cycle-player]")!.getAttribute("src")).toBe(src);
  });

  it("a sound switch pressed while the player loads is said again once it answers", () => {
    const props = { item: item(), index: 0, active: true, near: true, signedIn: false, ready: true, onMute: () => {}, onSignIn: () => {} };
    const r = render(<MemoryRouter><Cycle {...props} muted /></MemoryRouter>);
    const frame = r.container.querySelector<HTMLIFrameElement>("[data-cycle-player]")!;
    const sent: string[] = [];
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((m: unknown) => { const c = JSON.parse(String(m)); if (c.event === "command") sent.push(c.func); });
    // Sound on before the player is ready: the address still says muted.
    r.rerender(<MemoryRouter><Cycle {...props} muted={false} /></MemoryRouter>);
    sent.length = 0;
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: YT_ORIGIN, source: frame.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { playerState: 1, currentTime: 0.1, duration: 45 } }) })); });
    expect(sent).toContain("unMute");
    // Only on its first answer.
    sent.length = 0;
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: YT_ORIGIN, source: frame.contentWindow, data: JSON.stringify({ event: "infoDelivery", info: { playerState: 1, currentTime: 0.6, duration: 45 } }) })); });
    expect(sent).not.toContain("unMute");
  });
});

describe("a clip's words", () => {
  it("leaves out a reason that only repeats the creator's name; keeps one that says more", () => {
    expect(mount().container.querySelector("[data-cycle-reason]")).toBeNull();
    cleanup();
    expect(mount(item({ reason: "Features 16010" })).container.querySelector("[data-cycle-reason]")?.textContent).toBe("Features 16010");
  });
});
