// A team number with no team page (an off-season placeholder, src/shared/teamPages.ts), shown as plain text in
// match records. Why it isn't a link opens on a tap too (a title needs a mouse).
import { TapTooltip } from "../ui/overlay";
import { NO_PAGE_TITLE } from "../../shared/teamPages";
import { cn } from "../cn";

export function NoPageTeam({ team, className }: { team: number; className?: string }) {
  return (
    <TapTooltip className="max-w-64" trigger={
      <button type="button" aria-label={`${team}: ${NO_PAGE_TITLE}`} className={cn("cursor-help underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}>{team}</button>
    }>
      {NO_PAGE_TITLE}
    </TapTooltip>
  );
}
