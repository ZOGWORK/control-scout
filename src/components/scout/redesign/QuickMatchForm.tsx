// Quick mode, all 4 teams in one match (docs/mockups/scout-redesign.html step 4, "All 4 teams, quick"): one
// compact row per team, red then blue, with the few things that matter: the main scoring counter, the endgame
// choice, and yes/no taps for leaving the start zone, defense and breaking down. The fields are picked from the
// template (quickFields), never by id, and the answers are the same draft as the full form's, so a scout can
// open the full form for one team (onOpenFull) and carry on where quick mode left off.
// Surfaces and colours are the app's own: Card's hairline card, TeamTabs' alliance colours and status dot,
// BigFieldInput's accent pick and success/danger yes/no. Tap targets are px (the phone base is 14px).
import type { KeyboardEvent } from "react";
import { ChevronRight, Minus } from "lucide-react";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../cn";
import type { ScoutField, ScoutTemplate } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";
import type { TeamState } from "../../../lib/matchDraft";
import { counterRange } from "./BigFieldInput";
import { breakdownTone } from "./PhaseForm";
import { StatusDot } from "./TeamTabs";

/** What a quick yes/no is about; each kind is shown at most once. */
export type QuickToggleKind = "leave" | "defense" | "broke";

export interface QuickFields {
  /** The main scoring counter: the TeleOp counter with the highest max (ties: the first). */
  counter: ScoutField | null;
  /** The endgame choice, if the template has one (the first). */
  choice: ScoutField | null;
  /** Up to 3 yes/no fields, in this order: left the start zone in auto, played defense, broke down. */
  toggles: { kind: QuickToggleKind; field: ScoutField; short: string }[];
}

const LEAVE = /leave|left|start(ing)? zone|launch line|mobility|taxi/i;
const DEFENSE = /defen[cds]/i;
const SHORT: Record<QuickToggleKind, string> = { leave: "Leave", defense: "Defense", broke: "Broke" };

const text = (f: ScoutField) => `${f.id} ${f.label}`;

/** The fields quick mode shows for a template. */
export function quickFields(template: ScoutTemplate): QuickFields {
  const fs = template.fields;
  let counter: ScoutField | null = null;
  for (const f of fs) if (f.type === "counter" && f.phase === "teleop" && (!counter || counterRange(f, undefined).hi > counterRange(counter, undefined).hi)) counter = f;
  const choice = fs.find((f) => f.type === "choice" && f.phase === "endgame" && (f.options?.length ?? 0) > 0) ?? null;
  const yesNo = fs.filter((f) => f.type === "toggle");
  const used = new Set<string>();
  const pick = (kind: QuickToggleKind, test: (f: ScoutField) => boolean) => {
    const field = yesNo.find((f) => !used.has(f.id) && test(f));
    if (!field) return [];
    used.add(field.id);
    return [{ kind, field, short: SHORT[kind] }];
  };
  const toggles = [
    ...pick("leave", (f) => f.phase === "auto" && LEAVE.test(text(f))),
    ...pick("defense", (f) => DEFENSE.test(text(f))),
    ...pick("broke", (f) => breakdownTone(f) === "bad"),
  ];
  return { counter, choice, toggles };
}

const tap = "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50";
const pill = "min-h-[40px] min-w-0 rounded-lg border px-1 text-xs font-semibold break-words";

function withValue(value: Record<string, ScoutValue>, id: string, v: ScoutValue | undefined) {
  const next = { ...value };
  if (v === undefined) delete next[id];
  else next[id] = v;
  return next;
}

export interface QuickMatchFormProps {
  /** useMatchDraft's teams, in the order watched (teamsWatched: red then blue). */
  teams: TeamState[];
  /** Overrides each team's own template (TeamState.template, or an edit's useEntryTemplateState) for the fields shown. */
  template?: ScoutTemplate;
  /** A team's whole answers record after one tap; a cleared choice is a deleted key (PhaseForm's convention). */
  onChange: (team: number, data: Record<string, ScoutValue>) => void;
  /** Open the full form for one team. */
  onOpenFull: (team: number) => void;
  disabled?: boolean;
  className?: string;
}

export function QuickMatchForm({ teams, template, onChange, onOpenFull, disabled, className }: QuickMatchFormProps) {
  return (
    <div className={cn("grid gap-2", className)}>
      {teams.map((t) => <QuickRow key={t.watched.team} t={t} q={quickFields(template ?? t.template)} onChange={onChange} onOpenFull={onOpenFull} disabled={disabled} />)}
    </div>
  );
}

const STATUS_TEXT = { empty: "nothing yet", started: "started", done: "saved" } as const;

function QuickRow({ t, q, onChange, onOpenFull, disabled }: { t: TeamState; q: QuickFields; onChange: QuickMatchFormProps["onChange"]; onOpenFull: (team: number) => void; disabled?: boolean }) {
  const { team, side, station } = t.watched, red = side === "red";
  const set = (id: string, v: ScoutValue | undefined) => onChange(team, withValue(t.data, id, v));
  const c = q.counter, range = c ? counterRange(c, t.data[c.id]) : null;
  const opts = q.choice?.options ?? [];
  const pills = opts.length + q.toggles.length;
  // One line while every pill keeps ~45px on a 320px phone; more and the choice gets its own line, and a
  // long choice (a workspace's can have 12) wraps into even rows of at most 5.
  const wrap = pills > 6 || opts.length > 5;
  const choiceCols = Math.ceil(opts.length / Math.ceil(opts.length / 5));
  const picked = q.choice ? opts.indexOf(t.data[q.choice.id] as string) : -1, stop = picked < 0 ? 0 : picked;
  const onRadioKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!q.choice || disabled) return;
    const from = Number((e.target as HTMLElement).dataset.index ?? stop), n = opts.length;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (from + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (from - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    set(q.choice.id, opts[to]);
    e.currentTarget.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus();
  };
  return (
    <section aria-label={`${team}, ${red ? "red" : "blue"} ${station}, ${STATUS_TEXT[t.status]}`} data-team={team}
      className="rounded-xl border border-border bg-card p-2 text-card-foreground">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_44px_44px] items-center gap-1.5">
        <div className={cn("min-w-0 border-l-[3px] pl-2", red ? "border-red-alliance" : "border-blue-alliance")}>
          <div className="flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums"><StatusDot status={t.status} className="size-2" />{team}</div>
          <div className={cn("text-xs", red ? "text-red-alliance-text" : "text-blue-alliance-text")}>{red ? "Red" : "Blue"} {station}</div>
        </div>
        {c && range ? (
          <>
            <button type="button" aria-label={`${team} ${c.label}: ${range.n}. Add one`} disabled={disabled || range.n >= range.hi}
              onClick={() => set(c.id, Math.min(range.hi, range.n + 1))}
              className={cn(tap, "flex h-[44px] min-w-0 items-center justify-between gap-2 rounded-lg border border-input px-3 text-left hover:bg-text-base/[0.04] active:border-accent/60 active:bg-accent/10")}>
              <span className="truncate text-xs font-semibold">{c.label}</span>
              <span className="font-mono text-xl font-bold tabular-nums" aria-hidden>{range.n}</span>
            </button>
            <button type="button" aria-label={`${team} ${c.label} minus one`} disabled={disabled || range.n <= range.lo}
              onClick={() => set(c.id, Math.max(range.lo, range.n - 1))}
              className={cn(buttonVariants({ variant: "secondary" }), "h-[44px] w-[44px] rounded-lg px-0")}>
              <Minus className="size-4" />
            </button>
          </>
        ) : <span className="col-span-2 text-xs text-muted-foreground">No scoring counter in this template.</span>}
        <button type="button" aria-label={`Full form for ${team}`} title="Full form" onClick={() => onOpenFull(team)}
          className={cn(buttonVariants({ variant: "ghost" }), "h-[44px] w-[44px] flex-col gap-0 rounded-lg px-0 text-[10px] leading-tight")}>
          <ChevronRight className="size-4" /><span aria-hidden>Full</span>
        </button>
      </div>
      {c && range && <span className="sr-only" aria-live="polite">{`${team} ${c.label}: ${range.n}`}</span>}
      {pills > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {q.choice && opts.length > 0 && (
            <div role="radiogroup" aria-label={`${team} ${q.choice.label}`} onKeyDown={onRadioKey} className="grid gap-1.5"
              style={{ flex: `${opts.length} 1 0%`, minWidth: wrap ? "100%" : 0, gridTemplateColumns: `repeat(${choiceCols}, minmax(0, 1fr))` }}>
              {opts.map((o, i) => {
                const on = t.data[q.choice!.id] === o;
                return (
                  <button key={o} type="button" role="radio" aria-checked={on} disabled={disabled} tabIndex={i === stop ? 0 : -1} data-index={i}
                    onClick={() => set(q.choice!.id, on ? undefined : o)}
                    className={cn(tap, pill, on ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{o}</button>
                );
              })}
            </div>
          )}
          {q.toggles.length > 0 && (
            <div className="grid gap-1.5" style={{ flex: `${q.toggles.length} 1 0%`, minWidth: wrap ? "100%" : 0, gridTemplateColumns: `repeat(${q.toggles.length}, minmax(0, 1fr))` }}>
              {q.toggles.map(({ kind, field, short }) => {
                const on = t.data[field.id] === true, bad = kind === "broke";
                return (
                  <button key={field.id} type="button" aria-pressed={on} aria-label={`${team} ${field.label}`} title={field.label} disabled={disabled}
                    onClick={() => set(field.id, !on)}
                    className={cn(tap, pill, !on ? "border-border text-muted-foreground hover:text-foreground" : bad ? "border-danger/50 bg-danger/10 text-danger-text" : "border-success/50 bg-success/10 text-success-text")}>{short}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
