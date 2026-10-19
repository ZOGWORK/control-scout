// @vitest-environment jsdom
// The ambient layer's fade (no mask-image, see index.css): the pointer light's strength follows the
// grid's fade, full in the upper middle and gone towards the bottom and the lower corners.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { Ambient, ambientFade } from "./Ambient";

describe("ambientFade", () => {
  it("is full in the upper middle and none past the ellipse", () => {
    expect(ambientFade(500, 0, 1000, 800)).toBe(1);
    expect(ambientFade(500, 200, 1000, 800)).toBe(1);
    expect(ambientFade(500, 800, 1000, 800)).toBeLessThan(0.1);
    expect(ambientFade(0, 800, 1000, 800)).toBe(0);
  });
  it("falls off steadily towards the bottom", () => {
    const ys = [300, 400, 500, 600, 700];
    const f = ys.map((y) => ambientFade(500, y, 1000, 800));
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThan(f[i - 1]);
  });
  it("shows fully in a box with no size yet", () => {
    expect(ambientFade(10, 10, 0, 0)).toBe(1);
  });
});

describe("Ambient", () => {
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; }); // runs at once: nothing left pending
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function Page() {
    const ref = useRef<HTMLElement>(null);
    return <><Ambient target={ref} /><main ref={ref} /></>;
  }

  it("places the light relative to the layer (which stays on screen), at the strength the fade gives there", () => {
    const { container } = render(<Page />);
    const layer = container.querySelector(".ambient")!, glow = container.querySelector<HTMLElement>(".ambient-glow")!;
    layer.getBoundingClientRect = () => ({ left: 248, top: 48, width: 1000, height: 800 }) as DOMRect;
    const move = (x: number, y: number) => act(() => {
      const e = new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(e, "pointerType", { value: "mouse" });
      container.querySelector("main")!.dispatchEvent(e);
    });
    move(748, 148);
    expect(glow.style.transform).toBe("translate3d(500px, 100px, 0)");
    expect(glow.style.getPropertyValue("--amb-fade")).toBe("1");
    expect(glow.dataset.on).toBe("1");
    move(748, 848);
    expect(Number(glow.style.getPropertyValue("--amb-fade"))).toBeLessThan(0.1);
  });
});
