// The redesigned scout form for one team, one phase at a time (docs/mockups/scout-redesign.html,
// steps 2–3): Auto / TeleOp / Endgame / After tabs, only for phases the template has fields in,
// big tap targets (BigFieldInput), "Undo last tap", and the match timer (useMatchTimer) that moves the
// tab along with the match. "After" is the template's overall phase plus the notes box.
// Answers, notes and the phase are the caller's; so is the timer when it passes one (the scout screen
// keeps one per match, so switching teams keeps the clock), else the form keeps its own.
import { useId, useState } from "react";
import { Button } from "../../ui/button";
import { Label, Textarea } from "../../ui/basic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { cn } from "../../cn";
import { MATCH_PHASES, phaseLabel, phasesFor, type FieldPhase, type ScoutField, type ScoutTemplate } from "../../../shared/scoutTemplate";
import { NOTES_MAX, type ScoutValue } from "../../../lib/scouting";
import { BigFieldInput, type FieldTone } from "./BigFieldInput";
import { clock, fieldClock, useMatchTimer, type MatchTimer } from "./useMatchTimer";

/** The phase that holds the notes box: After for a match template, the pit phase for a pit one. */
export const notesPhase = (t: ScoutTemplate): FieldPhase => (t.kind === "pit" ? "pit" : "overall");

/** The phases the form shows, in match order: those with fields, and always the one with the notes. */
export function formPhases(t: ScoutTemplate): FieldPhase[] {
  const notes = notesPhase(t);
  return phasesFor(t.kind).filter((p) => p === notes || t.fields.some((f) => f.phase === p));
}

/**
 * The tab to show for `phase`: itself when the form has it, else the nearest one before it in the match
 * (a template with no endgame fields stays on TeleOp when the timer reaches the endgame), else the first.
 */
export function shownPhase(phases: FieldPhase[], phase: FieldPhase): FieldPhase {
  if (phases.includes(phase)) return phase;
  const at = MATCH_PHASES.indexOf(phase);
  for (let i = at - 1; i >= 0; i--) if (phases.includes(MATCH_PHASES[i])) return MATCH_PHASES[i];
  return phases[0];
}

/** A tab's name: the overall phase reads "After" (after the match). */
export const formPhaseLabel = (p: FieldPhase) => (p === "overall" ? "After" : phaseLabel(p));

/** The default tone: a yes/no whose id or label is about breaking down reads as bad news when on. */
export const breakdownTone = (f: ScoutField): FieldTone => (/broke|breakdown|disabled|died|dead\b/i.test(`${f.id} ${f.label}`) ? "bad" : "default");

/** The last tap: the field, its value before, and the answers record that tap produced. */
type Last = { id: string; prev: ScoutValue | undefined; record: Record<string, ScoutValue> };

function withValue(value: Record<string, ScoutValue>, id: string, v: ScoutValue | undefined) {
  const next = { ...value };
  if (v === undefined) delete next[id];
  else next[id] = v;
  return next;
}

export interface PhaseFormProps {
  template: ScoutTemplate;
  /** The answers. Pass back the record onChange gave you (not a copy), or "Undo last tap" stays off. */
  value: Record<string, ScoutValue>;
  onChange: (next: Record<string, ScoutValue>) => void;
  notes: string;
  onNotes: (notes: string) => void;
  /** The notes box's label, e.g. "Notes on 12345". */
  notesLabel?: string;
  phase: FieldPhase;
  onPhase: (phase: FieldPhase) => void;
  disabled?: boolean;
  /** The fields can be read, not changed (an edit whose own template version isn't loaded); notes and the timer still work. */
  lockFields?: boolean;
  /** How a yes/no reads when on (breakdownTone by default). */
  toneOf?: (f: ScoutField) => FieldTone;
  /** The match's timer, from useMatchTimer(setPhase) in the caller; leave out to keep one inside the form. */
  timer?: MatchTimer;
}

export function PhaseForm({ template, value, onChange, notes, onNotes, notesLabel = "Notes", phase, onPhase, disabled, lockFields = false, toneOf = breakdownTone, timer }: PhaseFormProps) {
  const uid = useId();
  const phases = formPhases(template);
  const shown = shownPhase(phases, phase);
  const fields = template.fields.filter((f) => f.phase === shown);
  const own = useMatchTimer(timer ? undefined : onPhase);
  const t = timer ?? own;

  // Undo: the field's value before the last tap, only while `value` is still the very record that tap
  // produced. Another team's answers (or anything changed from outside) are a different record, so undo
  // can never write one set's history into another, even where both hold the same value.
  const [last, setLast] = useState<Last | null>(null);
  const canUndo = !!last && last.record === value;
  const set = (f: ScoutField, v: ScoutValue | undefined) => {
    const next = withValue(value, f.id, v);
    // Typing in a text field isn't a tap: it keeps the last tap undoable on the record it makes.
    if (f.type !== "text") setLast({ id: f.id, prev: value[f.id], record: next });
    else if (last && canUndo) setLast({ ...last, record: next });
    onChange(next);
  };
  const undo = () => {
    if (!last || !canUndo) return;
    onChange(withValue(value, last.id, last.prev));
    setLast(null);
  };

  const live = t.running && t.phase ? shownPhase(phases, t.phase) : null;
  // Off, the timer waits on the first tab (Auto, or whatever comes first in a template without auto fields).
  const showTimer = template.kind === "match" && (t.startedAt != null || shown === phases[0]);
  const fc = fieldClock(t.elapsed);

  const body = (
    <>
        {showTimer && (
          <div data-cue={t.cue ?? undefined} className={cn("flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-1.5 motion-safe:transition-colors motion-safe:duration-300",
            t.cue ? "border-accent/60 bg-accent/10" : "border-border bg-card")}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">{t.cue ? `${phaseLabel(t.cue)} now` : "Match timer"}</div>
              <div className="font-mono text-base font-bold tabular-nums" role="timer" aria-live="off">
                {t.startedAt == null ? "Off" : fc.period === "Ended" ? "Ended" : `${fc.period} ${clock(fc.left)}`}
              </div>
            </div>
            {t.startedAt == null
              ? <Button type="button" size="sm" disabled={disabled} onClick={t.start} className="h-[44px] px-4 text-sm">Match started</Button>
              : t.running
                ? <Button type="button" size="sm" variant="secondary" onClick={t.stop} className="h-[44px] px-4 text-sm">Stop</Button>
                : <Button type="button" size="sm" variant="secondary" onClick={t.reset} className="h-[44px] px-4 text-sm">Reset</Button>}
          </div>
        )}
        <span className="sr-only" aria-live="polite">{t.cue ? `${phaseLabel(t.cue)} started` : ""}</span>
        {fields.map((f) => <BigFieldInput key={f.id} f={f} value={value[f.id]} onChange={(v) => set(f, v)} tone={toneOf(f)} disabled={disabled || lockFields} idPrefix={`${uid}-f`} />)}
        {shown === notesPhase(template) && (
          <div className="mt-1 space-y-1.5">
            <Label htmlFor={`${uid}-notes`}>{notesLabel}</Label>
            <Textarea id={`${uid}-notes`} value={notes} maxLength={NOTES_MAX} disabled={disabled} onChange={(e) => onNotes(e.target.value)}
              placeholder="What stood out? Strategy, reliability, driver habits…" />
          </div>
        )}
        <Button type="button" variant="link" onClick={undo} disabled={disabled || lockFields || !canUndo}
          className="h-[44px] justify-self-start px-0 text-muted-foreground underline hover:text-foreground">
          Undo last tap
        </Button>
    </>
  );

  // One phase: no tabs. Else the app's own tab strip (src/components/ui/tabs.tsx), which brings the roles and arrow keys.
  if (phases.length < 2) return <div className="grid gap-2">{body}</div>;
  return (
    <Tabs value={shown} onValueChange={(p) => onPhase(p as FieldPhase)} className="gap-3">
      <TabsList aria-label="Match phase" className="grid w-full sm:w-full" style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}>
        {phases.map((p) => (
          <TabsTrigger key={p} value={p} className="min-h-[44px] sm:flex-1">
            {formPhaseLabel(p)}
            {live === p && <><span className="size-1.5 rounded-full bg-current" aria-hidden /><span className="sr-only">(now)</span></>}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={shown} className="grid gap-2">{body}</TabsContent>
    </Tabs>
  );
}
