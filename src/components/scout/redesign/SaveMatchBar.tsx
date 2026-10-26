// One Save for the whole match (docs/mockups/scout-redesign.html step 2–3): "Save Q14 · 2 teams → Q15", stuck to
// the bottom above the phone's tab bar. A team with nothing entered is asked about first (save it anyway, or
// skip it); after a save the toast says what was kept and the screen moves on to the next match.
import { useEffect, useId, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../ui/button";
import { FieldError } from "../../ui/basic";
import { toast } from "../../ui/sonner";
import { cn } from "../../cn";
import { savedMessage, type MatchSaveResult } from "../../../lib/matchDraft";

const list = (teams: number[]) => teams.length <= 2 ? teams.join(" and ") : `${teams.slice(0, -1).join(", ")} and ${teams[teams.length - 1]}`;

/** The line under Save: where things stand, or which teams have nothing yet. */
export function emptyHint(empty: number[]): string {
  if (!empty.length) return "Saved on this device first. Works with no signal.";
  return `${list(empty)} ${empty.length === 1 ? "has" : "have"} nothing yet. Save anyway or tap ${empty.length === 1 ? "its" : "their"} tab.`;
}

export function SaveMatchBar({ label, teamCount, nextLabel, nextIndex, emptyTeams, toPersonal = false, onSave, onSaved, className }: {
  /** This match's label, as the schedule spells it (Q14). */
  label: string;
  teamCount: number;
  /** The match the screen moves to after saving (null: this is the last one). */
  nextLabel: string | null;
  nextIndex: number;
  /** Teams with nothing entered yet (useMatchDraft's emptyTeams). */
  emptyTeams: number[];
  /** A read-only workspace: Save keeps it in Personal. */
  toPersonal?: boolean;
  onSave: (opts: { includeEmpty?: boolean }) => MatchSaveResult;
  onSaved: (nextIndex: number) => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const emptyKey = emptyTeams.join(",");
  // A team filled in (or another match) answers the question.
  useEffect(() => { setAsking(false); setError(null); }, [emptyKey, label]);
  const others = teamCount - emptyTeams.length;

  const run = (includeEmpty: boolean) => {
    setAsking(false);
    const r = onSave({ includeEmpty });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    toast.success(toPersonal ? `Kept in Personal: the workspace is read-only. ${savedMessage(label, r, nextLabel)}` : savedMessage(label, r, nextLabel));
    onSaved(nextIndex);
  };
  const press = () => { if (emptyTeams.length) setAsking(true); else run(false); };

  return (
    <div data-sticky-actions className={cn("sticky z-30 -mx-4 border-t border-line bg-secondary px-4 py-2 max-md:bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:bottom-0 md:mx-0 md:rounded-xl md:border", className)}>
      {asking ? (
        <div role="group" aria-label={`Teams with nothing yet in ${label}`} className="grid gap-2">
          <p role="alert" className="text-center text-sm text-warning-text">{emptyHint(emptyTeams)}</p>
          <div className="flex gap-2">
            <Button type="button" size="lg" className="flex-1 max-sm:h-12" onClick={() => run(true)}>Save anyway</Button>
            {others > 0 && <Button type="button" variant="outline" size="lg" className="flex-1 max-sm:h-12" onClick={() => run(false)}>Skip {emptyTeams.length === 1 ? emptyTeams[0] : `${emptyTeams.length} teams`}</Button>}
          </div>
        </div>
      ) : (
        <>
          <Button type="button" onClick={press} aria-describedby={error ? errId : undefined} size="lg" className="w-full max-sm:h-12">
            <Save />{toPersonal ? `Save ${label} to Personal` : `Save ${label}`}
            <span className="font-medium opacity-75">· {teamCount} {teamCount === 1 ? "team" : "teams"}{nextLabel ? ` → ${nextLabel}` : ""}</span>
          </Button>
          <p className={cn("mt-1.5 text-center text-xs", emptyTeams.length ? "text-warning-text" : "text-muted-foreground")}>
            {toPersonal ? "This workspace is read-only, so Save keeps what you typed in Personal." : emptyHint(emptyTeams)}
          </p>
        </>
      )}
      <FieldError id={errId} className="text-center text-sm">{error}</FieldError>
    </div>
  );
}
