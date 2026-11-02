// Theme + density from the personal settings (dark graphite is the default).
import { useEffect, useState } from "react";
import { usePersonal } from "../lib/personal";
import type { ThemeChoice } from "../shared/personal";

const prefersLight = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;

/** The palette a choice paints (System: Light or Dark, from the device). Dim and Midnight are dark themes. */
export type Palette = Exclude<ThemeChoice, "system">;
/** The browser's bar colour per palette: each one's page background (src/index.css). */
export const THEME_COLOR: Record<Palette, string> = { light: "#ffffff", dim: "#1e1f23", dark: "#0a0a0b", midnight: "#000000" };

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
  const { palette } = useTheme();
  const { state } = usePersonal();
  useEffect(() => {
    const root = document.documentElement.classList;
    for (const p of ["light", "dim", "midnight"] as const) root.toggle(p, palette === p);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[palette]);
  }, [palette]);
  useEffect(() => { document.documentElement.classList.toggle("compact", state.settings.density === "compact"); }, [state.settings.density]);
  useEffect(() => { document.documentElement.classList.toggle("ambient-off", state.settings.ambient === false); }, [state.settings.ambient]);
  return null;
}
