// The wash settings (src/shared/wash.ts): only hex colours get through, numbers are clamped to their ranges, and the
// CSS made from them is the same for the first paint and the console's preview.
import { describe, expect, it } from "vitest";
import { DEFAULT_WASH, WASH_PRESETS, WASH_SPREAD, WASH_STRENGTH, cleanHex, isDefaultWash, parseWash, presetOf, washCss, washVars } from "./wash";

const ok = (x: unknown) => {
  const p = parseWash(x);
  if (!("wash" in p)) throw new Error(p.problem);
  return p.wash;
};

describe("parseWash", () => {
  it("keeps a good wash, colours in lower-case #rrggbb", () => {
    expect(ok({ a: "#AABBCC", b: "123", c: "#f0a", strength: 1.2, spread: 0.8 })).toEqual({ a: "#aabbcc", b: "#112233", c: "#ff00aa", ga: "#be6937", gb: "#795fa7", gc: "#556496", strength: 1.2, spread: 0.8 });
    expect(ok(DEFAULT_WASH)).toEqual(DEFAULT_WASH);
  });

  it("refuses anything that isn't a hex colour, so nothing else can reach the page's <style>", () => {
    for (const bad of ["red", "#12345", "#1234567", "#ggg", "", "#fff;}body{display:none", "url(x)", 123, null, undefined]) {
      const p = parseWash({ ...DEFAULT_WASH, b: bad });
      expect("problem" in p && p.problem, String(bad)).toMatch(/middle colour must be a hex colour/);
    }
  });

  it("clamps the numbers to their ranges and refuses ones that aren't numbers", () => {
    expect(ok({ ...DEFAULT_WASH, strength: 9, spread: -2 })).toMatchObject({ strength: WASH_STRENGTH.max, spread: WASH_SPREAD.min });
    expect(ok({ ...DEFAULT_WASH, strength: 0, spread: 99 })).toMatchObject({ strength: WASH_STRENGTH.min, spread: WASH_SPREAD.max });
    expect(ok({ ...DEFAULT_WASH, strength: 1.23456 }).strength).toBe(1.23);
    for (const bad of ["1", NaN, Infinity, null, undefined, {}]) {
      expect("problem" in parseWash({ ...DEFAULT_WASH, strength: bad }), String(bad)).toBe(true);
      expect("problem" in parseWash({ ...DEFAULT_WASH, spread: bad }), String(bad)).toBe(true);
    }
    expect("problem" in parseWash(null)).toBe(true);
    expect("problem" in parseWash("#fff")).toBe(true);
  });
});

describe("washVars and washCss", () => {
  it("up to 1, brightness is the opacity and the colours stay as chosen", () => {
    expect(washVars({ ...DEFAULT_WASH, strength: 0.5 })).toEqual({ "--wash-a": "#5a76ad", "--wash-b": "#5f5785", "--wash-c": "#91689c", "--glow-a": "#be6937", "--glow-b": "#795fa7", "--glow-c": "#556496", "--wash-strength": "0.5", "--wash-spread": "1" });
  });

  it("above 1, the opacity stays full and the colours get brighter, capped at white", () => {
    const v = washVars({ a: "#404040", b: "#c0c0c0", c: "#5a76ad", ga: "#be6937", gb: "#795fa7", gc: "#556496", strength: 1.5, spread: 1.2 });
    expect(v["--wash-strength"]).toBe("1");
    expect(v["--wash-a"]).toBe("#606060");
    expect(v["--wash-b"]).toBe("#ffffff");
    expect(v["--wash-spread"]).toBe("1.2");
  });

  it("the rule outranks index.css's html[data-v8] and touches only the v8 look", () => {
    expect(washCss(DEFAULT_WASH)).toBe("html[data-v8]:root{--wash-a:#5a76ad;--wash-b:#5f5785;--wash-c:#91689c;--glow-a:#be6937;--glow-b:#795fa7;--glow-c:#556496;--wash-strength:1;--wash-spread:1}");
  });

  it("a wash saved before the glow could be chosen keeps the default glow; a bad glow colour is refused", () => {
    expect(ok({ a: "#112233", b: "#445566", c: "#778899", strength: 1, spread: 1 })).toMatchObject({ ga: "#be6937", gb: "#795fa7", gc: "#556496" });
    const p = parseWash({ ...DEFAULT_WASH, gb: "red" });
    expect("problem" in p && p.problem).toMatch(/glow's middle colour must be a hex colour/);
  });

  it("six presets, all different and all valid, Dusk the default; presetOf finds them", () => {
    expect(WASH_PRESETS.map((p) => p.name)).toEqual(["Dusk", "Aurora", "Sunset", "Ocean", "Ember", "Nebula"]);
    expect(WASH_PRESETS[0].wash).toEqual(DEFAULT_WASH);
    for (const p of WASH_PRESETS) expect(ok(p.wash)).toEqual(p.wash);
    expect(new Set(WASH_PRESETS.map((p) => JSON.stringify(p.wash))).size).toBe(6);
    expect(presetOf({ ...WASH_PRESETS[3].wash })?.id).toBe("ocean");
    expect(presetOf({ ...DEFAULT_WASH, a: "#000000" })).toBeNull();
  });

  it("cleanHex and isDefaultWash", () => {
    expect(cleanHex(" 5A76AD ")).toBe("#5a76ad");
    expect(cleanHex("#5a76ad80")).toBeNull();
    expect(isDefaultWash({ ...DEFAULT_WASH })).toBe(true);
    expect(isDefaultWash({ ...DEFAULT_WASH, spread: 1.1 })).toBe(false);
  });
});
