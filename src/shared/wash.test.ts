// The wash settings (src/shared/wash.ts): only hex colours get through, numbers are clamped to their ranges, and the
// CSS made from them is the same for the first paint and the console's preview.
import { describe, expect, it } from "vitest";
import { DEFAULT_WASH, WASH_SPREAD, WASH_STRENGTH, cleanHex, isDefaultWash, parseWash, washCss, washVars } from "./wash";

const ok = (x: unknown) => {
  const p = parseWash(x);
  if (!("wash" in p)) throw new Error(p.problem);
  return p.wash;
};

describe("parseWash", () => {
  it("keeps a good wash, colours in lower-case #rrggbb", () => {
    expect(ok({ a: "#AABBCC", b: "123", c: "#f0a", strength: 1.2, spread: 0.8 })).toEqual({ a: "#aabbcc", b: "#112233", c: "#ff00aa", strength: 1.2, spread: 0.8 });
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
    expect(washVars({ ...DEFAULT_WASH, strength: 0.5 })).toEqual({ "--wash-a": "#5a76ad", "--wash-b": "#5f5785", "--wash-c": "#91689c", "--wash-strength": "0.5", "--wash-spread": "1" });
  });

  it("above 1, the opacity stays full and the colours get brighter, capped at white", () => {
    const v = washVars({ a: "#404040", b: "#c0c0c0", c: "#5a76ad", strength: 1.5, spread: 1.2 });
    expect(v["--wash-strength"]).toBe("1");
    expect(v["--wash-a"]).toBe("#606060");
    expect(v["--wash-b"]).toBe("#ffffff");
    expect(v["--wash-spread"]).toBe("1.2");
  });

  it("the rule outranks index.css's html[data-v8] and touches only the v8 look", () => {
    expect(washCss(DEFAULT_WASH)).toBe("html[data-v8]:root{--wash-a:#5a76ad;--wash-b:#5f5785;--wash-c:#91689c;--wash-strength:1;--wash-spread:1}");
  });

  it("cleanHex and isDefaultWash", () => {
    expect(cleanHex(" 5A76AD ")).toBe("#5a76ad");
    expect(cleanHex("#5a76ad80")).toBeNull();
    expect(isDefaultWash({ ...DEFAULT_WASH })).toBe(true);
    expect(isDefaultWash({ ...DEFAULT_WASH, spread: 1.1 })).toBe(false);
  });
});
