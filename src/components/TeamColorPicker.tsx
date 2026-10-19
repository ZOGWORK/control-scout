// A team's colour, chosen on the shortlist (personal, synced): a dot that opens the palette.
// Compare draws chosen colours too (useTeamColors). Teams without one keep the usual colours.
import { useCallback } from "react";
import { Check, Palette } from "lucide-react";
import { usePersonal } from "../lib/personal";
import { TEAM_COLORS, teamColorOf, type TeamColor } from "../shared/teamColors";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { cn } from "./cn";

/** The scout's team colours: read one, set one (null clears it). */
export function useTeamColors(): { colorOf: (team: number) => TeamColor | null; setColor: (team: number, id: string | null) => void } {
  const { state, update } = usePersonal();
  const colors = state.teamColors ?? {};
  const colorOf = useCallback((team: number) => teamColorOf(colors, team), [colors]);
  const setColor = useCallback((team: number, id: string | null) => update("teamColors", (c) => {
    const next = { ...(c ?? {}) };
    if (id) next[String(team)] = id; else delete next[String(team)];
    return next;
  }), [update]);
  return { colorOf, setColor };
}

/** Arrow keys move between the swatches as the grid lays them out: ←→ by one, ↑↓ by a row of four (wrapping).
 *  Runs in the capture phase and prevents the default, so Radix's own (one-dimensional) arrow handling stands aside. */
const COLS = 4;
function moveInGrid(e: React.KeyboardEvent<HTMLDivElement>) {
  const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? COLS : e.key === "ArrowUp" ? -COLS : 0;
  if (!step) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  items[(i + step + items.length) % items.length]?.focus();
}

export function TeamColorPicker({ team, className }: { team: number; className?: string }) {
  const { colorOf, setColor } = useTeamColors();
  const c = colorOf(team);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={c ? `${team}'s colour: ${c.label}. Change it` : `Give ${team} a colour`} title={c ? c.label : "Pick a colour"}
          className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-9", className)}>
          {c ? <span className="size-3.5 rounded-full ring-2 ring-background" style={{ background: c.css }} />
            : <span className="flex size-4 items-center justify-center rounded-full border border-dashed border-text-muted/60 text-text-muted"><Palette className="size-2.5" aria-hidden /></span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" aria-label={`${team}'s colour`}>
        <p className="px-1 pb-2 text-xs font-medium text-text-muted">{team}'s colour</p>
        {/* A radio group: one Tab stop, arrow keys move between colours (Radix ToggleGroup). */}
        <ToggleGroup type="single" value={c?.id ?? ""} onValueChange={(v) => setColor(team, v || null)} aria-label={`${team}'s colour`}
          onKeyDownCapture={moveInGrid} className="grid grid-cols-4 gap-1.5 bg-transparent p-0">
          {TEAM_COLORS.map((x) => (
            <ToggleGroupItem key={x.id} value={x.id} aria-label={x.label} title={x.label}
              className="flex size-9 items-center justify-center rounded-lg px-0 outline-none hover:bg-text-base/[0.06] focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-transparent aria-checked:shadow-none">
              <span className="flex size-6 items-center justify-center rounded-full" style={{ background: x.css }}>{c?.id === x.id && <Check className="size-3.5 text-black/80" aria-hidden />}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* Clearing removes this button: focus moves to the palette (its first colour) rather than the page. */}
        {c && <button type="button" onClick={(e) => { const box = e.currentTarget.parentElement; setColor(team, null); requestAnimationFrame(() => box?.querySelector<HTMLElement>("[role=radio]")?.focus()); }} className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-text-base/[0.06] hover:text-text-base">No colour</button>}
      </PopoverContent>
    </Popover>
  );
}
