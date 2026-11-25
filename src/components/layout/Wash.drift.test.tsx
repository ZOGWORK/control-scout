// @vitest-environment jsdom
// The wash's glows drift (index.css `.wash-glow`): each colour is a layer of its own, so each can move on its own,
// and the motion lives in CSS (transform and opacity, still for reduced motion), never in an inline style.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { Wash, WASH_RISE_MS, riseDelay } from "./Wash";

describe("wash drift", () => {
  it("draws the three glows as their own layers, left, middle and right colours", () => {
    const { container } = render(<Wash includeParticleWave={false} />);
    const glows = [...container.querySelectorAll<HTMLElement>("[data-wash] .wash-glow")];
    // Painted right, middle, left (later siblings paint on top): the left glow on top where they overlap, as the one
    // background list (first image on top) drew them before.
    expect(glows.map((g) => g.getAttribute("data-wash-glow"))).toEqual(["2", "1", "0"]);
    expect(glows.map((g) => g.style.backgroundImage.match(/--wash-[abc]/)?.[0])).toEqual(["--wash-c", "--wash-b", "--wash-a"]);
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
      const moves = [...f.matchAll(/translate3d\(([-\d.]+)%?, ([-\d.]+)%?, 0\)/g)];
      expect(moves.length).toBeGreaterThan(0);
      for (const [, x, y] of moves) for (const n of [x, y]) expect(Math.abs(Number(n))).toBeLessThanOrEqual(7);
      for (const [, n] of f.matchAll(/scale\(([\d.]+)\)/g)) expect(Number(n)).toBeLessThanOrEqual(1.12);
      for (const [, n] of f.matchAll(/opacity: ([\d.]+)/g)) expect(Number(n)).toBeGreaterThanOrEqual(0.65);
    }
    // The still rule must reach every glow: a per-glow rule (`.wash-glow[data-wash-glow="1"]`) outranks a bare
    // `.wash-glow`, so the reduced-motion rule names the attributed glows too.
    const still = /@media \(prefers-reduced-motion: reduce\) \{ ([^{]*\.wash-glow[^{]*) \{ animation: none;/.exec(css);
    expect(still).not.toBeNull();
    const selectors = still![1].split(",").map((x) => x.trim());
    expect(selectors).toContain(".wash-glow");
    expect(selectors).toContain(".wash-glow[data-wash-glow]");
  });

  it("rises in once on the shell's wash, carrying on from the first paint's rise, and only there", () => {
    expect(riseDelay(100, 40)).toBe("-60ms");
    expect(riseDelay(10, 40)).toBe("0ms");
    expect(riseDelay(40 + WASH_RISE_MS, 40)).toBeNull();
    const plain = render(<Wash includeParticleWave={false} />).container;
    expect(plain.querySelector(".wash-rise")).toBeNull();
    const shell = render(<Wash includeParticleWave={false} rise />).container;
    const rising = shell.querySelector<HTMLElement>("[data-wash] .wash-rise");
    // jsdom's clock has run less than the rise by the time it draws, so the wash still rises.
    if (performance.now() < WASH_RISE_MS) {
      expect(rising).not.toBeNull();
      expect(rising!.style.animationDelay).toMatch(/^-?\d+ms$/);
    }
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/@keyframes wash-rise \{ from \{ opacity: 0; transform: [^}]*\} to \{ opacity: 1; transform: none; \} \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^\n]*\.wash-rise \{ animation: none; \}/);
    // The first paint rises with the same keyframes, so the app taking over carries on from it.
    const boot = readFileSync("server/bootShell.ts", "utf8");
    expect(boot).toContain("animation:wash-rise 1400ms");
    expect(boot).toContain("@keyframes wash-rise{from{opacity:0;transform:translate3d(0,-4vh,0) scaleY(0.8)}to{opacity:1;transform:none}}");
    expect(css).toContain("@keyframes wash-rise { from { opacity: 0; transform: translate3d(0, -4vh, 0) scaleY(0.8); } to { opacity: 1; transform: none; } }");
  });
});
