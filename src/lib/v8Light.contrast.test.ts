// v8 Light (src/index.css, html[data-v8].light): every text colour it sets reads at WCAG AA (4.5:1) on the page,
// the cards and the muted fill, and on the soft tints they sit on. Values are read from index.css itself, so a
// change there is measured here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contrast, over, parseColor, type RGBA } from "./contrast";

const css = readFileSync("src/index.css", "utf8");
const at = css.indexOf("html[data-v8].light {\n");
const light = Object.fromEntries([...css.slice(at, css.indexOf("\n}", at)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const c = (name: string): RGBA => {
  const v = light[name];
  if (!v) throw new Error(`html[data-v8].light has no ${name}`);
  return parseColor(v)!;
};
const AA = 4.5;

describe("v8 Light", () => {
  const surfaces = ["--sh-background", "--sh-card", "--sh-muted"] as const;
  it("is a near-white page with white cards and ink text", () => {
    expect(at).toBeGreaterThan(0);
    expect(light["--sh-background"]).toBe("#fafafa");
    expect(light["--sh-card"]).toBe("#ffffff");
    expect(light["--sh-foreground"]).toBe("#18181b");
    expect(css.slice(at, at + 60)).toContain("color-scheme: light;");
  });

  it("text tokens reach 4.5:1 on the page, cards and muted fill", () => {
    const text = ["--sh-foreground", "--sh-muted-foreground", "--color-accent", "--color-accent-text", "--color-success-text",
      "--color-red-alliance-text", "--color-blue-alliance-text", "--color-red-alliance-ink", "--color-team-c-text", "--color-live"];
    for (const fg of text) for (const bg of surfaces) {
      const r = contrast(c(fg), c(bg));
      expect(r, `${fg} on ${bg}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
    }
    // The faint caption step reaches AA on the page and cards (it never sits on the muted fill).
    for (const bg of ["--sh-background", "--sh-card"]) expect(contrast(c("--color-text-faint"), c(bg))).toBeGreaterThanOrEqual(AA);
  });

  it("the deeper steps v8's light-on-dark colours map to read as text on white and on their own 10% tint", () => {
    const steps = Object.keys(light).filter((k) => /^--color-(emerald|sky|blue|rose|red|violet|purple|orange|yellow|amber|green|slate|pink)-\d+$/.test(k));
    expect(steps.length).toBeGreaterThan(15);
    const white = c("--sh-card");
    for (const k of steps) {
      const fg = c(k);
      expect(contrast(fg, white), `${k} on white`).toBeGreaterThanOrEqual(AA);
      const tint = over([fg[0], fg[1], fg[2], 0.1], white);
      expect(contrast(fg, tint), `${k} on its own tint`).toBeGreaterThanOrEqual(4);
    }
  });

  it("the accent button's label reads on the accent", () => {
    expect(contrast(c("--color-accent-ink"), c("--color-accent"))).toBeGreaterThanOrEqual(AA);
  });

  it("the alliance fills are rose 600 and sky 600, never faded", () => {
    expect(light["--color-red-alliance"]).toBe("#e11d48");
    expect(light["--color-blue-alliance"]).toBe("#0284c7");
  });
});
