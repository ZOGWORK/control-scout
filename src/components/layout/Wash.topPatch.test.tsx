// @vitest-environment jsdom
// The phone's top edge (Wash.tsx TopPatch): no band at the top of the page, no strip of wash pinned over the content
// once it scrolls, and the page running under the clock when installed on an iPhone.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { COVER_PX, TOP_PATCH, TOP_PATCH_IMAGE, TopPatch, topCover } from "./Wash";

const scrollTo = async (y: number) => {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  await act(async () => { window.dispatchEvent(new Event("scroll")); await new Promise((r) => requestAnimationFrame(() => r(null))); });
};

describe("top patch", () => {
  afterEach(() => { Object.defineProperty(window, "scrollY", { value: 0, configurable: true }); });

  it("turns into the page's colour over the first COVER_PX of scroll", () => {
    expect(topCover(0)).toBe("0%");
    expect(topCover(-40)).toBe("0%"); // a rubber-band pull past the top
    expect(topCover(COVER_PX / 2)).toBe("50%");
    expect(topCover(COVER_PX)).toBe("100%");
    expect(topCover(COVER_PX * 5)).toBe("100%");
  });

  it("draws the wash's top edge the same colour as the patch, so the patch shows no band at rest", () => {
    const { container } = render(<TopPatch />);
    const fade = container.querySelector<HTMLElement>("[data-top-fade]")!;
    const patch = container.querySelector<HTMLElement>("[data-top-patch]")!;
    expect(fade.style.backgroundColor).toBe(TOP_PATCH);
    expect(fade.style.backgroundImage).toBe(TOP_PATCH_IMAGE);
    // Solid under the patch's 6px, then eased out into the glows.
    expect(fade.style.maskImage).toMatch(/^linear-gradient\((to bottom,\s*)?(#000|rgb\(0, 0, 0\)) 6px,.*transparent 48px\)$/);
    expect(patch.className).toContain("h-[6px]");
    expect(fade.className).toContain("h-[48px]"); // px, as its mask: a rem height cut the fade short on phones
    // The patch is the same colours, mixed toward the page by --top-cover (0% at the top: exactly the edge).
    expect(patch.style.backgroundColor).toContain("var(--top-cover,0%)");
    expect(patch.style.backgroundColor).toContain(TOP_PATCH);
    expect(patch.style.getPropertyValue("--top-cover")).toBe("0%");
  });

  it("follows the scroll, so no strip of wash stays pinned over the content", async () => {
    const { container } = render(<TopPatch />);
    const patch = container.querySelector<HTMLElement>("[data-top-patch]")!;
    await scrollTo(COVER_PX / 4);
    expect(patch.style.getPropertyValue("--top-cover")).toBe("25%");
    await scrollTo(COVER_PX * 3);
    expect(patch.style.getPropertyValue("--top-cover")).toBe("100%");
    await scrollTo(0);
    expect(patch.style.getPropertyValue("--top-cover")).toBe("0%");
  });

  it("installed on an iPhone, runs the page under the clock and pads the top bar below it", () => {
    expect(readFileSync("index.html", "utf8")).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
    const css = readFileSync("src/index.css", "utf8");
    const standalone = css.slice(css.indexOf("@media (display-mode: standalone)"));
    expect(standalone).toMatch(/\[data-top-fade\] \{ display: none; \}/);
    // Sized by the inset alone: an installed desktop app (standalone, no inset) draws no strip over its top bar.
    const height = standalone.match(/\[data-top-patch\] \{[^}]*?height: ([^;]+);/)?.[1];
    expect(height).toBe("calc(env(safe-area-inset-top) * 1.25)");
    expect(readFileSync("src/components/layout/Shell.tsx", "utf8")).toMatch(/v8:h-\[calc\(3\.5rem\+env\(safe-area-inset-top\)\)\]/);
  });

  it("leaves the wash as the only colour at the top in v8 (no canvas glow starting under the bar)", () => {
    expect(readFileSync("src/index.css", "utf8")).toMatch(/html\[data-v8\] \.m-canvas \{ background-image: none; \}/);
  });
});
