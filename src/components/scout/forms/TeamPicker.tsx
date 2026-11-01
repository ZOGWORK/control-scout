// The team an entry is about: picked from the event's teams by number or name (a combobox), and confirmed by name
// once chosen, never a bare number box. A team that isn't on the event's list can still be typed (a late add, a
// list that isn't posted yet): its name is looked up and shown, with a note that it isn't listed here.
import { useId, useMemo, useRef, useState, type Ref } from "react";
import { CheckCircle2, Search, X } from "lucide-react";
import type { ScoutEventTeam } from "../../../lib/scoutEvent";
import { useTeamName } from "../../TeamInput";
import { FieldError, Input, Label } from "../../ui/basic";
import { cn } from "../../cn";

const LIMIT = 8;

/** The event's teams that match what's typed: a number by its start, a name by any word's start. */
export function matchTeams(teams: readonly ScoutEventTeam[], text: string, limit = LIMIT): ScoutEventTeam[] {
  const q = text.trim().toLowerCase();
  if (!q) return teams.slice(0, limit);
  const words = (n: string | null) => (n ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return teams.filter((t) => String(t.team).startsWith(q) || words(t.name).some((w) => w.startsWith(q)) || (t.name ?? "").toLowerCase().includes(q)).slice(0, limit);
}

export function TeamPicker({ teams, value, onChange, error, inputRef, disabled, label = "Team" }: {
  /** The event's teams (empty: none known, so only typing a number works). */
  teams: readonly ScoutEventTeam[];
  /** The picked team's number as text ("" when none). */
  value: string;
  onChange: (team: string) => void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId(), listId = useId(), errId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const own = useRef<HTMLInputElement>(null);
  const picked = /^\d+$/.test(value) ? Number(value) : null;
  const listed = picked != null ? teams.find((t) => t.team === picked) : undefined;
  // A team off the list (or no list at all) is confirmed by its looked-up name.
  const looked = useTeamName(picked != null && !listed ? picked : null);
  const options = useMemo(() => matchTeams(teams, text), [teams, text]);
  const typedNumber = /^\d{1,6}$/.test(text.trim()) ? text.trim() : null;
  // What the arrow keys move through: the matching teams, then "Use team N" for a typed number not on the list.
  const useTyped = typedNumber && !options.some((t) => String(t.team) === typedNumber) ? typedNumber : null;
  const choices = [...options.map((t) => String(t.team)), ...(useTyped ? [useTyped] : [])];

  const pick = (team: string) => { onChange(team); setText(""); setOpen(false); };

  if (picked != null) {
    const name = listed?.name ?? (looked || null);
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <div role="group" aria-label={`${label}: ${picked}${name ? ` ${name}` : ""}`} aria-describedby={error ? errId : undefined}
          className={cn("flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2", error ? "border-danger/60 bg-danger/[0.06]" : "border-accent/40 bg-accent/[0.06]")}>
          <CheckCircle2 aria-hidden className={cn("size-5 shrink-0", error ? "text-danger" : "text-accent")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate"><span className="font-mono text-base font-bold">{picked}</span>{name && <span className="ml-2 font-medium">{name}</span>}</span>
            {!listed && <span className="block text-xs text-muted-foreground">{looked === null ? "No FTC team has this number" : teams.length ? "Not on this event's team list" : looked === undefined ? "Checking the name…" : "Team found"}</span>}
          </span>
          {!disabled && (
            <button type="button" onClick={() => { onChange(""); requestAnimationFrame(() => own.current?.focus()); }} aria-label={`Change team (${picked})`}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground"><X className="size-4" /></button>
          )}
        </div>
        <FieldError id={errId}>{error}</FieldError>
      </div>
    );
  }

  return (
    <div className="relative grid gap-1.5" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id={id} ref={(el) => { own.current = el; if (typeof inputRef === "function") inputRef(el); else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el; }}
          value={text} disabled={disabled} autoComplete="off" placeholder={teams.length ? "Team number or name" : "Team number"}
          inputMode={teams.length ? "text" : "numeric"} role="combobox" aria-expanded={open && choices.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && choices[active] ? `${listId}-${active}` : undefined} aria-invalid={!!error || undefined} aria-describedby={error ? errId : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(choices.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              if (open && choices[active]) pick(choices[active]);
              else if (typedNumber) pick(typedNumber);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="h-12 pl-9 text-base" />
      </div>
      {open && (options.length > 0 || typedNumber) && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <ul id={listId} role="listbox" aria-label="Teams at this event" className="max-h-72 overflow-y-auto py-1">
            {options.map((t, k) => (
              <li key={t.team} id={`${listId}-${k}`} role="option" aria-selected={k === active}
                onMouseDown={(ev) => { ev.preventDefault(); pick(String(t.team)); }} onMouseEnter={() => setActive(k)}
                className={cn("flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2", k === active && "bg-accent/10")}>
                <span className="font-mono font-semibold">{t.team}</span><span className="truncate text-sm text-muted-foreground">{t.name}</span>
              </li>
            ))}
            {useTyped && (
              <li id={`${listId}-${options.length}`} role="option" aria-selected={active === options.length} onMouseDown={(ev) => { ev.preventDefault(); pick(useTyped); }}
                onMouseEnter={() => setActive(options.length)}
                className={cn("flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm", active === options.length && "bg-accent/10")}>
                Use team <span className="font-mono font-semibold">{useTyped}</span>{teams.length ? <span className="text-muted-foreground">(not on the list)</span> : null}
              </li>
            )}
          </ul>
        </div>
      )}
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}
