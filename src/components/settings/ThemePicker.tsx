// Settings → Appearance → Theme: the built-in themes as cards, each with a small preview drawn in that theme's
// own colours (whatever theme is showing now), its name and one line on what it's for. The only place the theme
// is chosen: nothing else in the app asks or offers a switch. Choosing one applies at once (ThemeSync).
import { RadioGroup as RadioP } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "../cn";
import { THEMES, type ThemeChoice } from "../../shared/personal";
import { useIsV8 } from "../../lib/v8";

type Swatch = { bg: string; card: string; fg: string; mut: string; line: string; acc: string; wash?: string };

/** Each palette's page, card, text, muted text and line colours, copied from src/index.css (:root is Dark), for
 *  the classic look (/legacy): its gold accent. */
export const SWATCH: Record<"light" | "dim" | "dark", Swatch> = {
  light: { bg: "#ffffff", card: "#f4f4f5", fg: "#09090b", mut: "#a1a1aa", line: "#e4e4e7", acc: "#eab308" },
  dim: { bg: "#1e1f23", card: "#232428", fg: "#e4e4e7", mut: "#6b6c75", line: "#ffffff1a", acc: "#ffc700" },
  dark: { bg: "#0a0a0b", card: "#111113", fg: "#f4f4f5", mut: "#52525b", line: "#ffffff14", acc: "#ffc700" },
};

/** The same in v8 (src/index.css's `html[data-v8]` blocks): its own page and card colours, the slate-blue accent
 *  (the deeper one on Light, which reads on white) and a strip of the wash that tops every page. */
export const V8_SWATCH: Record<"light" | "dim" | "dark", Swatch> = {
  light: { bg: "#fafafa", card: "#ffffff", fg: "#18181b", mut: "#a1a1aa", line: "#00000017", acc: "#3f5a96", wash: "linear-gradient(90deg,#c3d1ee,#d3cbe9,#e4cde6)" },
  dim: { bg: "#1e1f23", card: "#232428", fg: "#e4e4e7", mut: "#6b6c75", line: "#ffffff14", acc: "#a3b6e0", wash: "linear-gradient(90deg,#4f6696,#544d74,#7d5b87)" },
  dark: { bg: "#0a0a0b", card: "#0e0e10", fg: "#f4f4f5", mut: "#52525b", line: "#ffffff0f", acc: "#a3b6e0", wash: "linear-gradient(90deg,#5a76ad,#5f5785,#91689c)" },
};

const INFO: Record<ThemeChoice, { name: string; blurb: string }> = {
  light: { name: "Light", blurb: "Bright pages, for daylight and bright venues." },
  dim: { name: "Dim", blurb: "Soft dark grey, gentler than Dark." },
  dark: { name: "Dark", blurb: "Near black, the default." },
  system: { name: "System", blurb: "Light or Dark, following your device." },
};

function Preview({ p }: { p: Swatch }) {
  return (
    <span className="relative flex h-full flex-1 flex-col gap-1 p-2" style={{ background: p.bg }}>
      {p.wash && <span className="absolute inset-x-0 top-0 h-4 opacity-70" style={{ background: p.wash, maskImage: "linear-gradient(#000,transparent)" }} />}
      <span className="relative flex flex-1 flex-col gap-1 rounded-[5px] p-1.5" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }}>
        <span className="h-1.5 w-3/5 rounded-full" style={{ background: p.fg }} />
        <span className="h-1 w-4/5 rounded-full" style={{ background: p.mut }} />
        <span className="mt-auto h-1.5 w-1/3 rounded-full" style={{ background: p.acc }} />
      </span>
    </span>
  );
}

export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  const sw = useIsV8() ? V8_SWATCH : SWATCH;
  return (
    <RadioP.Root
      value={value}
      onValueChange={(v) => { if ((THEMES as readonly string[]).includes(v)) onChange(v as ThemeChoice); }}
      aria-label="Theme"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
    >
      {THEMES.map((t) => {
        const on = t === value;
        return (
          <RadioP.Item
            key={t}
            value={t}
            aria-describedby={`theme-${t}-blurb`}
            className={cn(
              "group flex flex-col overflow-hidden rounded-lg border bg-card text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              on ? "border-accent ring-1 ring-accent" : "border-line hover:border-text-muted/50",
            )}
          >
            <span className="flex h-16 w-full overflow-hidden border-b border-line" aria-hidden="true">
              {t === "system" ? <><Preview p={sw.light} /><Preview p={sw.dark} /></> : <Preview p={sw[t]} />}
            </span>
            <span className="flex flex-1 flex-col gap-0.5 p-2.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {INFO[t].name}
                {/* The chosen card is marked by a check as well as the accent border (never colour alone). */}
                {on && <Check className="size-3.5 text-accent-text" aria-hidden="true" />}
              </span>
              <span id={`theme-${t}-blurb`} className="text-xs leading-snug text-muted-foreground">{INFO[t].blurb}</span>
            </span>
          </RadioP.Item>
        );
      })}
    </RadioP.Root>
  );
}
