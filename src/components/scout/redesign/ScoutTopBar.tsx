// The Scout page's header (docs/mockups/scout-redesign.html, step 2), in the app's own PageHeader: the title,
// the scouting session as one button ("USNJQ1 · Red alliance", opens the event and teams), the page's sync chip
// beside it, and the space switcher under it. It scrolls with the page, under the app's own phone header and menu.
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { watchingLabel, type Watching } from "../../../shared/scoutMatch";
import { PageHeader } from "../../page";
import { Button } from "../../ui/button";
import { cn } from "../../cn";

/** The dot's colour: the alliance being watched, both halves for all four, neutral with no session yet. */
export function sessionDotClass(w: Watching | null): string {
  if (!w) return "bg-muted-foreground/60";
  if (w.kind === "all") return "bg-[linear-gradient(90deg,var(--color-red-alliance)_50%,var(--color-blue-alliance)_50%)]";
  const side = w.kind === "alliance" ? w.side : w.slot.startsWith("red") ? "red" : "blue";
  return side === "red" ? "bg-red-alliance" : "bg-blue-alliance";
}

export function ScoutTopBar({ eventCode, watching, onChangeSession, actions, children }: {
  /** The session's event (null: no session yet, the button asks for one). */
  eventCode: string | null;
  watching: Watching | null;
  /** Opens the scouting session setup (event and teams). */
  onChangeSession: () => void;
  /** Beside the session: the page's sync chip. */
  actions?: ReactNode;
  /** Under the title: the page's space switcher, notices. */
  children?: ReactNode;
}) {
  const session = eventCode && watching ? { eventCode, label: watchingLabel(watching) } : null;
  return (
    <PageHeader title="Scout"
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onChangeSession} className="max-w-full max-sm:h-11"
            aria-label={session ? `Scouting ${session.eventCode}, ${session.label}. Change event or teams` : "Pick an event and teams to scout"}>
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", sessionDotClass(session ? watching : null))} />
            {session ? <span className="min-w-0 truncate"><span className="font-mono">{session.eventCode}</span> · {session.label}</span>
              : <span className="min-w-0 truncate">Pick an event</span>}
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </Button>
          {actions}
        </div>
      }>
      {children}
    </PageHeader>
  );
}
