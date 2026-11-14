// The settings Control Scout Lite reads on the server (docs/lite.md): Lite pages run no script, so they can't see
// localStorage. The theme and text size are mirrored into cookies whenever they change, and once when the app
// starts (so people who chose them before this existed get them too).
import { TEXT_SIZE_COOKIE, THEME_COOKIE, type ThemeCookie } from "../shared/themeTokens";

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
