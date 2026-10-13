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
        // The tooltip wraps the label, not the item: Tooltip's own data-state
        // ("closed") would otherwise overwrite the item's data-state="on" and
        // the selected season would never look selected.
        <ToggleGroupItem key={s} value={String(s)} className="shrink-0 max-sm:px-2.5" aria-label={`${seasonLabel(s)} ${game(s)}`}>
          <Tooltip>
            <TooltipTrigger asChild><span>{seasonLabel(s)}</span></TooltipTrigger>
            <TooltipContent>{game(s)}</TooltipContent>
          </Tooltip>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
