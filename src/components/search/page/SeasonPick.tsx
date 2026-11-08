// The answer's season, as a picker: on /search the season chip at the top right of an answer card opens the seasons
// the answer's subject has data for (the team's, or every season for an answer about no team), newest first, and a
// pick asks the same query about that season (/search?in=2024, sent to the server as ?season=, which asks the query
// with the picked season in place of any it names: server/api/answers/season.ts withSeason). Off /search (no
// provider) it's the plain chip.
import { createContext, useContext } from "react";
import { useMeta } from "../../../lib/meta";
import { seasonLabel } from "../../../lib/format";
import { Badge } from "../../ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../ui/controls";
import { cn } from "../../cn";
import { TAP } from "./answerCells";

/** `pending`: the picked season's answer is on its way (the last answer stays, dimmed, under the picked chip). */
export type SeasonPick = { picked: number | null; pending: boolean; pick: (season: number) => void };

export const SeasonPickContext = createContext<SeasonPick | null>(null);

/** Whether the answer's season can be picked here (on /search). */
export const useSeasonPick = () => useContext(SeasonPickContext);

/** The picked season in an address (`in`), or null: a season the app holds. */
export function pickedSeason(raw: string | null, held: readonly number[]): number | null {
  const s = Number(raw);
  return raw && Number.isInteger(s) && (held.length ? held.includes(s) : s >= 2019 && s < 2100) ? s : null;
}

/** The seasons to offer: `own` (the subject's) when known, else every season held; the shown one always among
 *  them; newest first. */
export function seasonChoices(shown: number, own: readonly number[] | null | undefined, held: readonly number[]): number[] {
  const list = new Set(own?.length ? own : held);
  list.add(shown);
  return [...list].sort((a, b) => b - a);
}

/** The season chip: a picker on /search, the plain badge elsewhere. `seasons`: the subject's seasons, when known;
 *  `waiting`: they're still loading (it opens once they're in, so it never offers a season with no data). */
export function AnswerSeason({ season, seasons, waiting, className }: { season: number; seasons?: readonly number[] | null; waiting?: boolean; className?: string }) {
  const ctx = useSeasonPick();
  const meta = useMeta();
  if (!ctx) return <Badge variant="secondary" className={className} data-answer-season>{seasonLabel(season)}</Badge>;
  // The pick shows at once; the answer's own season once it's in.
  const shown = ctx.pending && ctx.picked != null ? ctx.picked : season;
  const game = (s: number) => meta?.seasons.find((x) => x.season === s)?.game ?? "";
  const list = seasonChoices(shown, seasons, meta?.seasons.map((s) => s.season) ?? []);
  return (
    <Select value={String(shown)} onValueChange={(v) => { if (Number(v) !== shown) ctx.pick(Number(v)); }}>
      <SelectTrigger size="sm" disabled={waiting} aria-label={`Season: ${seasonLabel(shown)}. Change season`} data-answer-season data-season-picker
        className={cn("h-8 w-auto gap-1 rounded-md border-border bg-text-base/[0.06] px-2.5 text-xs font-medium tabular-nums text-foreground hover:bg-text-base/[0.1] disabled:cursor-wait disabled:opacity-100 [&>span]:overflow-visible", TAP, className)}>
        <span>{seasonLabel(shown)}</span>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-auto min-w-[12rem]">
        {list.map((s) => (
          <SelectItem key={s} value={String(s)} className={TAP} data-season-option={s}>
            <span className="tabular-nums">{seasonLabel(s)}</span>{game(s) && <span className="text-muted-foreground"> · {game(s)}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
