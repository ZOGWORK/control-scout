// @vitest-environment jsdom
// The phone's top edge (Wash.tsx TopPatch): no band at the top of the page, no strip of wash pinned over the content
// once it scrolls, and the page running under the clock when installed on an iPhone.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { COVER_PX, TOP_EDGE_IMAGE, TOP_PATCH, TopPatch, topCover } from "./Wash";

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
    const edge = container.querySelector<HTMLElement>("[data-top-edge]")!;
    const patch = container.querySelector<HTMLElement>("[data-top-patch]")!;
    expect(fade.style.backgroundColor).toBe(TOP_PATCH);
    // The patch and the solid edge are one solid colour, no image: a gradient along the very top makes Safari draw its
    // black band and blur (#2350).
    expect(fade.style.backgroundImage).toBe("");
    expect(patch.style.backgroundImage).toBe("");
    // The solid edge is only the patch's 6px (plus the clock's strip), gone by 20px: never a tall band of one colour.
    expect(fade.style.maskImage).toMatch(/^linear-gradient\(to bottom,\s*(#000|rgb\(0, 0, 0\)) calc\(var\(--top-inset, ?0px\) \+ 6px\),.*transparent calc\(var\(--top-inset, ?0px\) \+ 20px\)\)$/);
    expect(fade.style.height).toBe("calc(var(--top-inset,0px) + 20px)");
    // Under it, the wash's three colours left to right, eased into the glows by 48px (px, as its mask: a rem height cut
    // the fade short on phones).
    expect(edge.style.backgroundImage).toBe(TOP_EDGE_IMAGE);
    for (const v of ["--wash-a", "--wash-b", "--wash-c"]) expect(TOP_EDGE_IMAGE).toContain(v);
    expect(edge.style.maskImage).toMatch(/transparent calc\(var\(--top-inset, ?0px\) \+ 48px\)\)$/);
    expect(edge.style.height).toBe("calc(var(--top-inset,0px) + 48px)");
    // The solid edge paints over the three colours.
    expect(edge.compareDocumentPosition(fade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(patch.className).toContain("h-[6px]");
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
    // The wash's solid edge covers the clock's strip, and the patch stays solid (never see-through or a gradient).
    expect(standalone).toMatch(/--top-inset: env\(safe-area-inset-top\);/);
    expect(standalone).not.toMatch(/\[data-top-fade\] \{ display: none; \}/);
    const rule = standalone.match(/\[data-top-patch\] \{([^}]*)\}/)?.[1] ?? "";
    // Sized by the inset alone: an installed desktop app (standalone, no inset) draws no strip over its top bar.
    expect(rule).toMatch(/height: env\(safe-area-inset-top\);/);
    expect(rule).not.toMatch(/transparent|background-image|pointer-events/);
    expect(readFileSync("src/components/layout/Shell.tsx", "utf8")).toMatch(/v8:h-\[calc\(3\.5rem\+env\(safe-area-inset-top\)\)\]/);
  });

  it("leaves the wash as the only colour at the top in v8 (no canvas glow starting under the bar)", () => {
    expect(readFileSync("src/index.css", "utf8")).toMatch(/html\[data-v8\] \.m-canvas \{ background-image: none; \}/);
  });
});
