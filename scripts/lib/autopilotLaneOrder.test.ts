// A lane's run (`if (LANE) {` in scripts/clip-autopilot.ts) calls readSeason before the rest of the file has run, so
// every top-level const readSeason reads must be declared above that block. 2026-11-21: READER_LANES sat below it and
// every lane job on lexie died at once ("Cannot access 'READER_LANES' before initialization").
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../clip-autopilot.ts", import.meta.url), "utf8");
const lines = src.split(/\r?\n/);

describe("clip-autopilot.ts: a lane's run", () => {
  it("has every top-level const readSeason reads declared before the lane block", () => {
    const laneLine = lines.findIndex((l) => l.startsWith("if (LANE) {"));
    expect(laneLine).toBeGreaterThan(0);
    // Top-level consts: "const X =" or "const X: T =" and "const X = …, Y = …" (the names before each "=").
    const declared = new Map<string, number>();
    lines.forEach((l, i) => {
      if (!l.startsWith("const ")) return;
      for (const m of l.slice(6).matchAll(/(?:^|,\s*)([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/g)) if (!declared.has(m[1])) declared.set(m[1], i);
    });
    const start = src.indexOf("async function readSeason(");
    expect(start).toBeGreaterThan(0);
    // Its code only: comments and strings name words ("to", "file") that aren't the consts of those names.
    const body = src.slice(start, src.indexOf("\n}\n", start))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    const late = [...declared].filter(([name, at]) => at > laneLine && new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body)).map(([n]) => n);
    expect(late).toEqual([]);
  });
});
