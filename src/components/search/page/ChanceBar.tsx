// A chance as the search results guide draws it (§8 "Prediction", §10 tokens): the number, then a bar on a 0–100% scale
// split at it, filled from 0 in the team's hue (team A, the number in it too) against a neutral track, both ends
// printed. Under it, the call's predicted score with its range, and the card's one primary action.
import { Link } from "react-router-dom";
import type { StatBlock } from "../../../shared/searchStat";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../cn";
import { oddsPct } from "../../../shared/format";
import { TAP, TEAM_BAR, TEAM_TEXT } from "./answerCells";

export function ChanceBar({ b }: { b: Extract<StatBlock, { kind: "chance" }> }) {
  const p = Math.min(1, Math.max(0, b.p)), pc = Math.round(100 * p);
  // Printed as Predict prints odds: a chance under 1.5% is "1%", over 98.5% "99%" (never a false 0 or 100); a settled 0 or 1 as is.
  const shown = oddsPct(p, p === 0 || p === 1);
  return (
    <section data-block="chance">
      <p className="text-sm"><span className={cn("font-display text-3xl font-semibold tabular-nums", TEAM_TEXT)} data-chance-value data-kpi>{shown}</span> <span className="text-muted-foreground">{b.label}</span></p>
      <div className="mt-2 flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
        <span aria-hidden>0</span>
        <div role="img" aria-label={`${b.who}: ${shown} on a 0 to 100% scale`} className="h-[14px] flex-1 overflow-hidden rounded-sm bg-[var(--color-chance-track)]">
          <div className={cn("h-full", TEAM_BAR)} style={{ width: `${pc}%` }} data-chance-fill data-bar data-value={pc} data-scale={100} />
        </div>
        <span aria-hidden>100%</span>
      </div>
      {b.note && <p className="mt-2 text-sm tabular-nums">{b.note}</p>}
      {b.action && <Link to={b.action.href} className={cn(buttonVariants(), "mt-3", TAP)} data-primary-cta>{b.action.label}</Link>}
    </section>
  );
}
