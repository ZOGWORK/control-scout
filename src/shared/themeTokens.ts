// The app's five themes as colour values, for pages drawn without the app's stylesheet: Control Scout Lite
// (server/lite/render.ts). Each value is the one src/index.css gives the named custom property in that theme;
// themeTokens.test.ts reads index.css and fails if any of them drifts.
//
// The cookies the client keeps for the server (docs/lite.md): cs-theme and cs-text-size, written whenever the
// setting changes and once when the app starts (src/lib/liteCookies.ts).

export type Palette = "dark" | "light" | "dim" | "midnight";
export type ThemeCookie = Palette | "system";
export const THEME_COOKIES: readonly ThemeCookie[] = ["light", "dim", "dark", "midnight", "system"];
export type TextSizeCookie = "s" | "l" | "xl";
export const TEXT_SIZE_COOKIES: readonly TextSizeCookie[] = ["s", "l", "xl"];

export const THEME_COOKIE = "cs-theme";
export const TEXT_SIZE_COOKIE = "cs-text-size";
export const LITE_COOKIE = "cs-lite";

/** Lite's token → the index.css custom property it copies. */
export const TOKEN_SOURCE = {
  bg: "--sh-background",
  fg: "--sh-foreground",
  card: "--sh-card",
  muted: "--sh-muted",
  mutedFg: "--sh-muted-foreground",
  line: "--sh-border",
  acc: "--color-accent",
  accText: "--color-accent-text",
  accInk: "--color-accent-ink",
  red: "--color-red-alliance-text",
  blue: "--color-blue-alliance-text",
  ok: "--color-success-text",
} as const;
export type Token = keyof typeof TOKEN_SOURCE;

const DARK: Record<Token, string> = {
  bg: "#0a0a0b", fg: "#f4f4f5", card: "#111113", muted: "#18181b", mutedFg: "#a1a1aa", line: "#ffffff14",
  acc: "#ffc700", accText: "#ffc700", accInk: "#231a00", red: "#f43f5e", blue: "#38bdf8", ok: "#34d399",
};

export const THEME_TOKENS: Record<Palette, Record<Token, string>> = {
  dark: DARK,
  light: {
    bg: "#ffffff", fg: "#09090b", card: "#ffffff", muted: "#f4f4f5", mutedFg: "#52525b", line: "#e4e4e7",
    acc: "#eab308", accText: "#875200", accInk: "#231a00", red: "#be123c", blue: "#0369a1", ok: "#047857",
  },
  dim: { ...DARK, bg: "#1e1f23", fg: "#e4e4e7", card: "#232428", muted: "#2d2e33", mutedFg: "#b4b4bd", line: "#ffffff1a", red: "#fb7185" },
  midnight: { ...DARK, bg: "#000000", fg: "#f4f4f5", card: "#08080a", muted: "#121215", mutedFg: "#a1a1aa", line: "#ffffff12" },
};

/** A cookie header's value for `name` ("" when absent). */
export function cookieValue(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

export const themeFromCookie = (v: string): ThemeCookie => ((THEME_COOKIES as readonly string[]).includes(v) ? (v as ThemeCookie) : "dark");
export const textSizeFromCookie = (v: string): TextSizeCookie | null => ((TEXT_SIZE_COOKIES as readonly string[]).includes(v) ? (v as TextSizeCookie) : null);
