// Theme + density from the personal settings (dark graphite is the default).
import { useEffect, useState } from "react";
import { usePersonal } from "../lib/personal";

const prefersLight = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;

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
  const resolved: "dark" | "light" = theme === "light" || (theme === "system" && systemLight) ? "light" : "dark";
  return { theme, resolved };
}

/** Applies theme + density classes to <html> (mounted once at the root). */
export function ThemeSync() {
  const { resolved } = useTheme();
  const { state } = usePersonal();
  useEffect(() => {
    document.documentElement.classList.toggle("light", resolved === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#ffffff" : "#0a0a0b");
  }, [resolved]);
  useEffect(() => { document.documentElement.classList.toggle("compact", state.settings.density === "compact"); }, [state.settings.density]);
  useEffect(() => { document.documentElement.classList.toggle("ambient-off", state.settings.ambient === false); }, [state.settings.ambient]);
  return null;
}
