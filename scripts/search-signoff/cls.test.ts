import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clsCeiling, clsOf, type ClsBudget } from "./cls.js";

const s = (startTime: number, value: number, hadRecentInput = false) => ({ startTime, value, hadRecentInput });

describe("clsOf", () => {
  it("sums one burst of shifts", () => expect(clsOf([s(100, 0.05), s(600, 0.04), s(1200, 0.03)])).toBeCloseTo(0.12));
  it("keeps the worst burst, a gap of 1 s starting a new one", () => expect(clsOf([s(0, 0.05), s(500, 0.05), s(3000, 0.08)])).toBeCloseTo(0.1));
  it("ends a burst after 5 s", () => expect(clsOf([0, 900, 1800, 2700, 3600, 4500, 5400].map((t) => s(t, 0.02)))).toBeCloseTo(0.12));
  it("leaves out shifts a tap caused", () => expect(clsOf([s(0, 0.3, true), s(100, 0.02)])).toBeCloseTo(0.02));
  it("is 0 with no shifts", () => expect(clsOf([])).toBe(0));
});

describe("clsCeiling", () => {
  const budget: ClsBudget = { pages: [{ q: "4215", ceiling: { "390": 0.3 } }, { q: "top teams in NJ" }] };
  it("a page's own ceiling for its view", () => expect(clsCeiling(budget, "4215", "390", 0.1)).toBe(0.3));
  it("a view's own default, under a page's own ceiling", () => {
    const b: ClsBudget = { views: { "390": { ceiling: 0.3, why: "U1" } }, pages: [{ q: "4215", ceiling: { "390": 0.32 } }, { q: "x" }] };
    expect(clsCeiling(b, "x", "390", 0.1)).toBe(0.3);
    expect(clsCeiling(b, "4215", "390", 0.1)).toBe(0.32);
    expect(clsCeiling(b, "x", "desktop", 0.1)).toBe(0.1);
  });
  it("the default for its other views and other pages", () => {
    expect(clsCeiling(budget, "4215", "desktop", 0.1)).toBe(0.1);
    expect(clsCeiling(budget, "top teams in NJ", "390", 0.1)).toBe(0.1);
    expect(clsCeiling(null, "x", "390", 0.1)).toBe(0.1);
  });
  it("the committed list: every page once, every ceiling over the 0.1 default and said why", () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, "cls.json"), "utf8")) as ClsBudget;
    const qs = file.pages.map((p) => p.q);
    expect(new Set(qs).size).toBe(qs.length);
    for (const p of file.pages) for (const [view, c] of Object.entries(p.ceiling ?? {})) {
      expect(["desktop", "390"]).toContain(view);
      expect(c).toBeGreaterThan(0.1);
      expect(p.why, p.q).toBeTruthy();
    }
    for (const [view, v] of Object.entries(file.views ?? {})) {
      expect(["desktop", "390"]).toContain(view);
      expect(v.why, view).toBeTruthy();
    }
  });
});
