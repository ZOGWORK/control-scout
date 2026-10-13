// Season switcher (Control Point's SeasonToggle pattern): newest first, game name on hover.
import { ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { useMeta } from "../lib/meta";
import { seasonLabel } from "../lib/format";

export function SeasonToggle({ seasons, value, onChange }: { seasons?: number[]; value: number; onChange: (s: number) => void }) {
  const meta = useMeta();
  const all = meta?.seasons.map((s) => s.season) ?? [value];
  const list = (seasons?.length ? all.filter((s) => seasons.includes(s)) : all);
  if (!list.includes(value)) list.unshift(value);
  const game = (s: number) => meta?.seasons.find((x) => x.season === s)?.game ?? "";
  return (
    <ToggleGroup type="single" aria-label="Season" className="max-w-full overflow-x-auto" value={String(value)} onValueChange={(v) => { if (v) onChange(Number(v)); }}>
      {list.map((s) => (
        // The tooltip sits on the season button itself, so keyboard focus shows
        // the game name too. Selection is styled from aria-checked (see
        // ui/controls), which the tooltip's data-state can't overwrite.
        <Tooltip key={s}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={String(s)} className="shrink-0 max-sm:px-2.5" aria-label={`${seasonLabel(s)} ${game(s)}`}>{seasonLabel(s)}</ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{game(s)}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
