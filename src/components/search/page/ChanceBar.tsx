// A chance as the search results guide draws it (§8 "Prediction", §10 tokens): the number, then a bar on a 0–100% scale
// split at it, filled from 0 in the team's hue (--color-chance, Okabe–Ito blue) against a neutral track, both ends
// printed. Under it, the call's predicted score with its range, and the card's one primary action.
import { Link } from "react-router-dom";
import type { StatBlock } from "../../../shared/searchStat";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../cn";

export function ChanceBar({ b }: { b: Extract<StatBlock, { kind: "chance" }> }) {
  const pc = Math.round(100 * Math.min(1, Math.max(0, b.p)));
  return (
    <section data-block="chance">
      <p className="text-sm"><span className="text-base font-bold tabular-nums" data-chance-value>{pc}%</span> <span className="text-muted-foreground">{b.label}</span></p>
      <div className="mt-2 flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
        <span aria-hidden>0</span>
        <div role="img" aria-label={`${b.who}: ${pc}% on a 0 to 100% scale`} className="h-[14px] flex-1 overflow-hidden rounded-sm bg-[var(--color-chance-track)]">
          <div className="h-full bg-[var(--color-chance)]" style={{ width: `${pc}%` }} data-chance-fill />
        </div>
        <span aria-hidden>100%</span>
      </div>
      {b.note && <p className="mt-2 text-sm tabular-nums">{b.note}</p>}
      {b.action && <Link to={b.action.href} className={cn(buttonVariants(), "mt-3")}>{b.action.label}</Link>}
    </section>
  );
}
