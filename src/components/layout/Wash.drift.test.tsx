// @vitest-environment jsdom
// The wash's glows drift (index.css `.wash-glow`): each colour is a layer of its own, so each can move on its own,
// and the motion lives in CSS (transform and opacity, still for reduced motion), never in an inline style.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { Wash } from "./Wash";

describe("wash drift", () => {
  it("draws the three glows as their own layers, left, middle and right colours", () => {
    const { container } = render(<Wash includeParticleWave={false} />);
    const glows = [...container.querySelectorAll<HTMLElement>("[data-wash] .wash-glow")];
    expect(glows.map((g) => g.getAttribute("data-wash-glow"))).toEqual(["0", "1", "2"]);
    expect(glows.map((g) => g.style.backgroundImage.match(/--wash-[abc]/)?.[0])).toEqual(["--wash-a", "--wash-b", "--wash-c"]);
    for (const g of glows) expect(g.style.animation).toBe("");
    // No blur over the moving layers (it would be redrawn every frame).
    expect(container.querySelector("[data-wash] [class*='blur']")).toBeNull();
  });

  it("moves with transform and opacity only, gently, and stays still for reduced motion", () => {
    const css = readFileSync("src/index.css", "utf8");
    const frames = [...css.matchAll(/@keyframes wash-drift-[abc] \{(.*)\}/g)].map((m) => m[1]);
    expect(frames).toHaveLength(3);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(new Set(props)).toEqual(new Set(["transform", "opacity"]));
      for (const [, n] of f.matchAll(/translate3d\(([-\d.]+)%/g)) expect(Math.abs(Number(n))).toBeLessThanOrEqual(4);
      for (const [, n] of f.matchAll(/scale\(([\d.]+)\)/g)) expect(Number(n)).toBeLessThanOrEqual(1.08);
      for (const [, n] of f.matchAll(/opacity: ([\d.]+)/g)) expect(Number(n)).toBeGreaterThanOrEqual(0.75);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.wash-glow \{ animation: none;/);
  });
});
