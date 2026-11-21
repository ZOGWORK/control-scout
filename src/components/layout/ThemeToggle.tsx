// The top bar's light/dark switch, beside the notification bell (src/components/layout/Shell.tsx). It flips between
// Light and the dark theme last used (Dim or Dark: Settings.darkTheme), so a Dim user comes back to Dim, never the
// default. Settings still picks any theme, System included.
import { Moon, Sun } from "lucide-react";
import { toggledTheme, useTheme } from "../../hooks/useTheme";
import { usePersonal } from "../../lib/personal";

export function ThemeToggle() {
  const { palette } = useTheme();
  const { update } = usePersonal();
  const light = palette === "light";
  const label = light ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button type="button" data-theme-toggle aria-label={label} title={label} onClick={() => update("settings", (s) => toggledTheme(s, palette))}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60">
      {light ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
    </button>
  );
}
