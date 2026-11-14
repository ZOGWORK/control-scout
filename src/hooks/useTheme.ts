// Theme + density from the personal settings (dark graphite is the default).
import { useEffect, useRef, useState } from "react";
import { usePersonal } from "../lib/personal";
import type { ThemeChoice } from "../shared/personal";
import { useFlag } from "../lib/flags";
import { takeLitePick, writeThemeCookie } from "../lib/liteCookies";

const prefersLight = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;

/** The palette a choice paints (System: Light or Dark, from the device). Dim and Midnight are dark themes. */
export type Palette = Exclude<ThemeChoice, "system">;
/** The browser's bar colour per palette: each one's page background (src/index.css). */
export const THEME_COLOR: Record<Palette, string> = { light: "#ffffff", dim: "#1e1f23", dark: "#0a0a0b", midnight: "#000000" };
/** The same with the owner's dog theme on (dogTheme): each palette's yellow-tinted page (src/index.css, html.dog). */
export const DOG_THEME_COLOR: Record<Palette, string> = { light: "#fff8dc", dim: "#2a2513", dark: "#17130a", midnight: "#0b0903" };

export function useTheme() {
  const { state } = usePersonal();
  const theme = state.settings.theme;
  const [systemLight, setSystemLight] = useState(prefersLight);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const fn = () => setSystemLight(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const palette: Palette = theme === "system" ? (systemLight ? "light" : "dark") : theme;
  /** Light or dark, for anything that only knows the two (the toaster, color-scheme). */
  const resolved: "dark" | "light" = palette === "light" ? "light" : "dark";
  return { theme, palette, resolved };
}

/** Applies theme + density classes to <html> (mounted once at the root). */
export function ThemeSync() {
  const { palette, theme } = useTheme();
  const { state, update } = usePersonal();
  const dog = useFlag("dogTheme");
  useEffect(() => {
    const root = document.documentElement.classList;
    for (const p of ["light", "dim", "midnight"] as const) root.toggle(p, palette === p);
    root.toggle("dog", dog);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", (dog ? DOG_THEME_COLOR : THEME_COLOR)[palette]);
  }, [palette, dog]);
  // A theme picked on Lite's Settings page since the app last ran (only its cookie changed there): taken once, as this
  // device's choice, before the app's older one is written back over it (src/lib/liteCookies.ts).
  const [fromLite] = useState(() => takeLitePick("theme"));
  const waiting = useRef(fromLite != null && fromLite !== theme);
  useEffect(() => {
    if (waiting.current && fromLite) update("settings", (s) => ({ ...s, theme: fromLite }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the app starts
  // Control Scout Lite draws on the server with no script: it reads the choice from a cookie (src/lib/liteCookies.ts).
  useEffect(() => {
    if (waiting.current) { if (theme !== fromLite) return; waiting.current = false; }
    writeThemeCookie(theme);
  }, [theme, fromLite]);
  useEffect(() => { document.documentElement.classList.toggle("compact", state.settings.density === "compact"); }, [state.settings.density]);
  useEffect(() => { document.documentElement.classList.toggle("ambient-off", state.settings.ambient === false); }, [state.settings.ambient]);
  return null;
}
