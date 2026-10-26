// The teams a scout watches in one match, one tab each (docs/mockups/scout-redesign.html step 2): coloured by
// alliance, with a dot for where each stands (nothing yet, started, saved). The tab's panel is the team's form.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../cn";
import type { WatchedTeam } from "../../../shared/scoutMatch";
import type { TeamStatus } from "../../../lib/matchDraft";

export interface TeamTab { watched: WatchedTeam; status: TeamStatus }

const STATUS_TEXT: Record<TeamStatus, string> = { empty: "nothing yet", started: "started", done: "saved" };

export function StatusDot({ status, className }: { status: TeamStatus; className?: string }) {
  return (
    <span aria-hidden data-status={status} className={cn("inline-block size-2.5 shrink-0 rounded-full border-2",
      status === "done" ? "border-success bg-success" : status === "started" ? "border-warning bg-warning" : "border-muted-foreground/60 bg-transparent", className)} />
  );
}

export function TeamTabs({ teams, active, onSelect, renderForm, className }: {
  teams: TeamTab[];
  /** The team number whose tab is open. */
  active: number;
  onSelect: (team: number) => void;
  /**
   * The open team's form (piece C's), shown in the tab panel. Match-wide state (the match timer, useMatchTimer)
   * lives in the page above the tabs and reaches each form through this closure, so switching tabs never resets it.
   */
  renderForm: (team: WatchedTeam) => ReactNode;
  className?: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const open = teams.find((t) => t.watched.team === active) ?? teams[0];
  // Arrow keys move between tabs (and open them), as a tab list does.
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? teams.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const j = (to + teams.length) % teams.length;
    onSelect(teams[j].watched.team);
    refs.current[j]?.focus();
  };
  if (!open) return null;
  return (
    <div className={className}>
      {teams.length > 1 && (
        <div role="tablist" aria-label="Teams you're scouting" className="flex gap-1.5">
          {teams.map((t, i) => {
            const on = t === open, red = t.watched.side === "red";
            return (
              <button key={t.watched.team} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${base}-tab-${t.watched.team}`}
                aria-selected={on} aria-controls={`${base}-panel`} tabIndex={on ? 0 : -1}
                aria-label={`${t.watched.team}, ${red ? "red" : "blue"} ${t.watched.station}, ${STATUS_TEXT[t.status]}`}
                onClick={() => onSelect(t.watched.team)} onKeyDown={(e) => onKey(e, i)}
                className={cn("flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border font-mono text-sm font-semibold tabular-nums transition-colors max-sm:h-12",
                  on ? (red ? "border-red-alliance bg-red-alliance/10 text-red-alliance-text" : "border-blue-alliance bg-blue-alliance/10 text-blue-alliance-text")
                    : "border-text-base/25 bg-text-base/[0.05] text-text-muted hover:bg-text-base/[0.09] hover:text-text-base")}>
                <StatusDot status={t.status} />{t.watched.team}
              </button>
            );
          })}
        </div>
      )}
      <div role={teams.length > 1 ? "tabpanel" : undefined} id={`${base}-panel`} aria-labelledby={teams.length > 1 ? `${base}-tab-${open.watched.team}` : undefined} className={teams.length > 1 ? "mt-3" : undefined}>
        {renderForm(open.watched)}
      </div>
    </div>
  );
}
