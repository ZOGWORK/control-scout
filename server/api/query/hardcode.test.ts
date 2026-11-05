// No team, event or place is written into the search pipeline's code (docs/search-pipeline.md, "No hardcoding"): every
// name comes from the data, every phrase from the lexicon. The brief's own check, run on every change.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname);
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []; });
// The teams, events and places the brief named.
const NAMED = /\b(?:4215|6980|7149|23268|17713|24033)\b|parkway|turnpike/i;

describe("the pipeline's code", () => {
  it("names no team, event or place", () => {
    const hits = files(DIR).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => NAMED.test(l)));
    expect(hits.map(([f, n, l]) => `${f.slice(DIR.length + 1)}:${n}: ${l.trim()}`)).toEqual([]);
  });
});
