// @vitest-environment jsdom
// The atlas globe without a pointer: it takes keyboard focus and the arrow keys turn it; the flat map
// isn't a tab stop (nothing to turn). The rotation step itself is a pure function. The spin's frames are
// transitions, so a page change is never starved behind them.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AtlasMap, { KEY_TURN_DEG, turnByKey } from "./AtlasMap";

const spy = vi.hoisted(() => ({ transitions: 0 }));
vi.mock("react", async (load) => {
  const react = await load<typeof import("react")>();
  return { ...react, startTransition: (fn: () => void) => { spy.transitions++; react.startTransition(fn); } };
});

describe("turnByKey", () => {
  it("turns left/right by a step (Shift: three), wrapping longitude", () => {
    expect(turnByKey([0, 10], "ArrowRight")).toEqual([KEY_TURN_DEG, 10]);
    expect(turnByKey([0, 10], "ArrowLeft", true)).toEqual([-3 * KEY_TURN_DEG, 10]);
    expect(turnByKey([175, 0], "ArrowRight")).toEqual([-170, 0]);
  });
  it("tilts up/down within ±80°", () => {
    expect(turnByKey([5, 0], "ArrowUp")).toEqual([5, KEY_TURN_DEG]);
    expect(turnByKey([5, 75], "ArrowUp")).toEqual([5, 80]);
    expect(turnByKey([5, -75], "ArrowDown")).toEqual([5, -80]);
  });
  it("ignores other keys", () => {
    expect(turnByKey([0, 0], "Enter")).toBeNull();
    expect(turnByKey([0, 0], " ")).toBeNull();
  });
});

describe("AtlasMap keyboard", () => {
  beforeEach(() => {
    // An empty world (no countries) is enough to draw the sphere and graticule.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ type: "Topology", arcs: [], objects: { countries: { type: "GeometryCollection", geometries: [] } } }) })));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const draw = async (mode: "globe" | "flat") => {
    render(<AtlasMap mode={mode} countries={[]} selected={null} onSelect={() => {}} onLoaded={() => {}} onError={() => {}} />);
    return screen.findByRole("img");
  };

  it("the globe is a tab stop, says how to turn it, and arrow keys turn it", async () => {
    const globe = await draw("globe");
    expect(globe.getAttribute("tabindex")).toBe("0");
    expect(globe.getAttribute("aria-label")).toMatch(/Arrow keys turn it/);
    const graticule = () => globe.querySelectorAll("path")[1].getAttribute("d");
    const before = graticule();
    act(() => { globe.focus(); });
    fireEvent.keyDown(globe, { key: "ArrowRight" });
    expect(graticule()).not.toBe(before);
    // Any other key is left alone (Tab still moves on).
    const ev = fireEvent.keyDown(globe, { key: "Tab" });
    expect(ev).toBe(true);
  });

  it("the flat map is not a tab stop", async () => {
    const map = await draw("flat");
    expect(map.hasAttribute("tabindex")).toBe(false);
    expect(map.getAttribute("aria-label")).not.toMatch(/Arrow keys/);
    expect(map.getAttribute("aria-label")).toMatch(/list below/);
  });
});

describe("AtlasMap spin", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ type: "Topology", arcs: [], objects: { countries: { type: "GeometryCollection", geometries: [] } } }) })));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    spy.transitions = 0;
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  // An update from requestAnimationFrame is urgent by default, above a page change (React Router navigates in a
  // transition). Redrawing the globe takes about a frame on a slow device, so urgent frames kept the page change
  // waiting for good: the URL changed and Home stayed. As transitions, they never hold it up.
  it("turns the globe in transitions, never as urgent updates", async () => {
    render(<AtlasMap mode="globe" spinning countries={[]} selected={null} onSelect={() => {}} onLoaded={() => {}} onError={() => {}} />);
    const globe = await screen.findByRole("img");
    const graticule = () => globe.querySelectorAll("path")[1].getAttribute("d");
    const before = graticule();
    let now = performance.now();
    for (let i = 0; i < 3; i++) {
      now += 40; // past the ~30 frames a second step
      const due = frames.splice(0);
      expect(due.length).toBeGreaterThan(0);
      await act(async () => { for (const f of due) f(now); });
    }
    expect(spy.transitions).toBeGreaterThanOrEqual(3);
    expect(graticule()).not.toBe(before); // and it still turns
  });
});
