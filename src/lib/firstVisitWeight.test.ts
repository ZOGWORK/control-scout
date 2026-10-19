// Guards for what a first visit downloads (the home page on a slow phone):
// - components use motion's lightweight `m` elements; the animation features load later (src/lib/motionFeatures.ts),
//   and main.tsx's <LazyMotion strict> would throw on a full `motion.` element anyway, but only in the browser;
// - each font file is a different font: Inter and Space Grotesk are variable, one file per family covers every weight.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
}

describe("first-visit weight", () => {
  it("never imports motion's full `motion` element", () => {
    const offenders = sources(join(root, "src")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*["']motion\/react["']/.test(s) || /<motion\.[a-z]/.test(s);
    });
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("ships each font once", () => {
    const dir = join(root, "public", "fonts");
    const byHash = new Map<string, string[]>();
    for (const f of readdirSync(dir)) {
      const h = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
      byHash.set(h, [...(byHash.get(h) ?? []), f]);
    }
    expect([...byHash.values()].filter((names) => names.length > 1)).toEqual([]);
  });

  it("declares one @font-face per variable family, covering its weights", () => {
    const css = readFileSync(join(root, "src", "index.css"), "utf8");
    const faces = (family: string) => css.match(new RegExp(`@font-face \\{ font-family: "${family}";[^}]*\\}`, "g")) ?? [];
    expect(faces("Inter")).toHaveLength(1);
    expect(faces("Inter")[0]).toContain("font-weight: 400 800");
    expect(faces("Space Grotesk")).toHaveLength(1);
    expect(faces("Space Grotesk")[0]).toContain("font-weight: 500 700");
  });
});
