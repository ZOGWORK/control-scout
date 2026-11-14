// The settings Control Scout Lite reads on the server (docs/lite.md): Lite pages run no script, so they can't see
// localStorage. The theme and text size are mirrored into cookies whenever they change, and once when the app
// starts (so people who chose them before this existed get them too).
//
// Lite's own Settings page changes those cookies too (server/lite/routes.ts /lite/theme, /lite/size) and notes which
// (cs-lite-picked). The app then takes that value once when it starts, instead of writing its older choice over it:
// one setting, whichever page it was changed on.
import { LITE_PICKED_COOKIE, TEXT_SIZE_COOKIE, THEME_COOKIE, THEME_COOKIES, TEXT_SIZE_COOKIES, cookieValue, pickedOnLite, type LitePick, type ThemeCookie } from "../shared/themeTokens";

const YEAR = 31536000;

function write(name: string, value: string | null): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  try {
    document.cookie = value == null
      ? `${name}=; path=/; max-age=0; samesite=lax${secure}`
      : `${name}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; samesite=lax${secure}`;
  } catch { /* cookies blocked: Lite falls back to the default theme and size */ }
}

/** The theme choice as Settings holds it (System included: Lite follows the device for that one). */
export const writeThemeCookie = (theme: ThemeCookie) => write(THEME_COOKIE, theme);
/** The text size ("m", the default, clears the cookie). */
export const writeTextSizeCookie = (size: "s" | "m" | "l" | "xl") => write(TEXT_SIZE_COOKIE, size === "m" ? null : size);

const readCookie = (name: string) => {
  try { return typeof document === "undefined" ? "" : cookieValue(document.cookie, name); } catch { return ""; }
};

/**
 * A choice made on Lite's Settings page since the app last ran, taken once: the theme ("light" … "system") or the
 * text size ("s" | "m" | "l" | "xl"), or null when Lite changed nothing. The note is cleared for that setting, so
 * the app's own changes go to the cookie as usual from then on.
 */
export function takeLitePick(which: "theme"): ThemeCookie | null;
export function takeLitePick(which: "size"): "s" | "m" | "l" | "xl" | null;
export function takeLitePick(which: LitePick): string | null {
  const picks = pickedOnLite(readCookie(LITE_PICKED_COOKIE));
  if (!picks.includes(which)) return null;
  const rest = picks.filter((p) => p !== which);
  write(LITE_PICKED_COOKIE, rest.length ? rest.join(".") : null);
  if (which === "theme") {
    const v = readCookie(THEME_COOKIE);
    return (THEME_COOKIES as readonly string[]).includes(v) ? v : null;
  }
  const v = readCookie(TEXT_SIZE_COOKIE);
  return (TEXT_SIZE_COOKIES as readonly string[]).includes(v) ? v : "m";
}
