// Control Scout Lite's colours are the app's (src/index.css), theme by theme, and its text reads at WCAG AA (4.5:1)
// on every surface it sits on, in all five themes (System is Light or Dark).
import { describe, expect, it } from "vitest";
import { contrast, parseColor, toHex } from "../lib/contrast";
import { value, type Theme } from "../lib/themeTokens.testkit";
import { THEME_TOKENS, TOKEN_SOURCE, cookieValue, textSizeFromCookie, themeFromCookie, type Token } from "./themeTokens";

const THEMES: Theme[] = ["light", "dim", "dark", "midnight"];
const hex = (s: string) => toHex(parseColor(s)!) + (parseColor(s)![3] < 1 ? Math.round(parseColor(s)![3] * 255).toString(16).padStart(2, "0") : "");

describe("Lite's theme tokens", () => {
  for (const theme of THEMES) {
    it(`equal src/index.css's in ${theme}`, () => {
      for (const [token, prop] of Object.entries(TOKEN_SOURCE)) {
        expect(hex(THEME_TOKENS[theme][token as Token]), `${token} (${prop})`).toBe(hex(toCss(value(theme, prop))));
      }
    });
    it(`text reaches 4.5:1 on Lite's surfaces in ${theme}`, () => {
      const t = THEME_TOKENS[theme];
      const c = (k: Token) => parseColor(t[k])!;
      const pairs: [Token, Token][] = [];
      for (const fg of ["fg", "mutedFg", "accText", "red", "blue", "ok"] as Token[]) for (const bg of ["bg", "card", "muted"] as Token[]) pairs.push([fg, bg]);
      pairs.push(["accInk", "acc"]); // the gold button's label
      for (const [fg, bg] of pairs) {
        const r = contrast(c(fg), c(bg));
        expect(r, `${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("the cookies Lite reads", () => {
  it("reads a cookie header, and anything unknown is the default", () => {
    expect(cookieValue("a=1; cs-theme=dim; b=2", "cs-theme")).toBe("dim");
    expect(cookieValue(undefined, "cs-theme")).toBe("");
    expect(cookieValue("xcs-theme=dim", "cs-theme")).toBe("");
    expect(themeFromCookie("midnight")).toBe("midnight");
    expect(themeFromCookie("system")).toBe("system");
    expect(themeFromCookie("<b>")).toBe("dark");
    expect(textSizeFromCookie("xl")).toBe("xl");
    expect(textSizeFromCookie("m")).toBeNull();
  });
});

function toCss([r, g, b, a]: [number, number, number, number]) {
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}
