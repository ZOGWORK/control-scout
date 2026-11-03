// /search on a phone (FTC One Search, Part B 3b): teams picked with VS Compare dock in a bar right above the tab bar
// ("Compare (2) →", straight to /compare), and a Compare result opens its head-to-head in a panel from the bottom
// without leaving the results. The picks are this page's own (they go when you leave it); the full comparison is
// /compare's.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { useStickyActionsMarker } from "../../StickyActions";
import { useConsent } from "../../../lib/consent";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/overlay";
import { cn } from "../../cn";

/** Pick a team (a third replaces the first: two sides at most), or unpick it. */
export function togglePick(picks: readonly number[], team: number): number[] {
  if (picks.includes(team)) return picks.filter((t) => t !== team);
  return [...picks, team].slice(-2);
}

/** Where the picks compare: both sides, in the season the results are about when they're about one. */
export const pickHref = (picks: readonly number[], season?: number | null) => `/compare?teams=${picks.join(",")}${season != null ? `&season=${season}` : ""}`;

/** The picks, above the tab bar: each team (tap × to drop it), then Compare →. One pick still goes on to /compare,
 *  where the other team is added (a search that found one team can still end in a comparison). */
export function CompareBar({ picks, names, season, onDrop }: { picks: number[]; names: Map<number, string>; season?: number | null; onDrop: (team: number) => void }) {
  // The first-visit privacy banner (ConsentBanner) sits in this same strip: the bar waits until that's answered.
  const { decided } = useConsent();
  const shown = decided && picks.length > 0;
  useStickyActionsMarker(shown);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => { setBody(document.body); }, []);
  if (!body || !shown) return null;
  return createPortal(
    <div role="region" aria-label="Teams to compare" data-compare-bar
      className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-line bg-secondary px-3 py-2 md:hidden">
      <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {picks.map((t) => (
          <li key={t} className="flex shrink-0 items-center rounded-full border border-border bg-card pl-3 text-sm">
            <span className="max-w-[7.5rem] truncate"><b className="tabular-nums">{t}</b>{names.get(t) ? ` ${names.get(t)}` : ""}</span>
            <button type="button" onClick={() => onDrop(t)} aria-label={`Remove ${t} from the comparison`} className="grid size-11 place-items-center rounded-full text-muted-foreground"><X className="size-4" aria-hidden /></button>
          </li>
        ))}
      </ul>
      <Link to={pickHref(picks, season)} data-compare-go className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">Compare ({picks.length})<ArrowRight className="size-4" aria-hidden /></Link>
    </div>,
    body,
  );
}

/** A Compare result's head-to-head, from the bottom of the screen; closing it leaves the results as they were. */
export function CompareSheet({ open, onClose, returnTo, title, children }: { open: boolean; onClose: () => void; returnTo?: HTMLElement; title: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className={cn("gap-3 p-4")} returnFocus={() => returnTo} data-compare-sheet>
        <SheetHeader className="pr-8">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>A preview: the full comparison is a tap away.</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
