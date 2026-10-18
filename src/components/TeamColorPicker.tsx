// A team's colour, chosen on the shortlist (personal, synced): a dot that opens the palette.
// Compare draws chosen colours too (useTeamColors). Teams without one keep the usual colours.
import { useCallback } from "react";
import { Check, Palette } from "lucide-react";
import { usePersonal } from "../lib/personal";
import { TEAM_COLORS, teamColorOf, type TeamColor } from "../shared/teamColors";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
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
      <PopoverContent align="start" className="w-auto p-2">
        <p className="px-1 pb-2 text-xs font-medium text-text-muted">{team}'s colour</p>
        <div role="radiogroup" aria-label={`${team}'s colour`} className="grid grid-cols-4 gap-1.5">
          {TEAM_COLORS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={c?.id === x.id} aria-label={x.label} title={x.label} onClick={() => setColor(team, x.id)}
              className="flex size-9 items-center justify-center rounded-lg outline-none hover:bg-text-base/[0.06] focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className="flex size-6 items-center justify-center rounded-full" style={{ background: x.css }}>{c?.id === x.id && <Check className="size-3.5 text-black/80" aria-hidden />}</span>
            </button>
          ))}
        </div>
        {c && <button type="button" onClick={() => setColor(team, null)} className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-text-base/[0.06] hover:text-text-base">No colour</button>}
      </PopoverContent>
    </Popover>
  );
}
