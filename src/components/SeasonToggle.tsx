// Season switcher (Control Point's SeasonToggle pattern): newest first, game name on hover.
// The predicted seasons (2023+) are segments; the history-only ones (2019–2022)
// sit in one "Earlier" menu at the end of the same track, so eight seasons still
// fit on a phone. `predictOnly` (predict, scout, shortlist, my team) leaves them out.
import { Select, SelectContent, SelectItem, SelectTrigger, ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { useMeta } from "../lib/meta";
import { seasonLabel } from "../lib/format";
import { cn } from "./cn";

export function SeasonToggle({ seasons, value, onChange, predictOnly }: { seasons?: number[]; value: number; onChange: (s: number) => void; predictOnly?: boolean }) {
  const meta = useMeta();
  // Before meta loads, treat 2023+ as predictable (the server's rule).
  const predictable = (s: number) => meta?.seasons.find((x) => x.season === s)?.predictable ?? s >= 2023;
  const all = (meta?.seasons.map((s) => s.season) ?? [value]).filter((s) => !predictOnly || predictable(s));
  const list = (seasons?.length ? all.filter((s) => seasons.includes(s)) : all);
  if (!list.includes(value) && (!predictOnly || predictable(value))) list.unshift(value);
  const game = (s: number) => meta?.seasons.find((x) => x.season === s)?.game ?? "";
  const recent = list.filter(predictable), older = list.filter((s) => !predictable(s));
  const olderOn = older.includes(value);
  return (
    <div className="inline-flex max-w-full items-center gap-0.5 rounded-lg bg-muted p-0.5">
      <ToggleGroup type="single" aria-label="Season" className="min-w-0 overflow-x-auto bg-transparent p-0" value={olderOn ? "" : String(value)} onValueChange={(v) => { if (v) onChange(Number(v)); }}>
        {recent.map((s) => (
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
      {older.length > 0 && (
        <Select value={olderOn ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
          <SelectTrigger
            size="sm" aria-label={olderOn ? `Season ${seasonLabel(value)} ${game(value)}` : "Earlier seasons"}
            className={cn("h-7 w-auto shrink-0 gap-1 rounded-md border-0 px-2.5 font-medium max-sm:h-10 [&>span]:overflow-visible",
              olderOn ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <span>{olderOn ? seasonLabel(value) : "Earlier"}</span>
          </SelectTrigger>
          <SelectContent align="end" className="w-auto min-w-[12rem]">
            {older.map((s) => <SelectItem key={s} value={String(s)}>{seasonLabel(s)} <span className="text-muted-foreground">· {game(s)}</span></SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
