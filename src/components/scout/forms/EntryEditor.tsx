// One entry, new or opened to change: a pit entry, a match typed in by hand (no schedule, a practice match), or
// any entry opened from Entries. Its event is never typed: a new entry is at the picked event (the page's
// session), an opened one keeps its own. The team is picked from the event's teams and confirmed by name. Team
// and event are required; errors show inline. Fields fit their data (BigFieldInput: steppers, numbers with
// units, chips, yes/no that asks what on yes) on two columns when there's room; the notes keep their guidance.
// Save sits in a bar stuck to the bottom with where saving stands (SaveState): every Save keeps the entry on
// this device first and syncs when it can (offline-first, as the whole Scout page).
// `aside` is the column beside the fields on a wide screen (the pit queue, the team's snapshot, photos).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Save, TriangleAlert } from "lucide-react";
import { isScoutQueued, newScoutId, NOTES_MAX, personalCopy, saveScoutEntry, scoutDraftBase, ScoutStorageError, type ScoutEntry, type ScoutSpace, type ScoutValue } from "../../../lib/scouting";
import { resolveTemplate, useEntryTemplateState } from "../../../lib/scoutTemplates";
import { detailKey, MATCH_PHASES, type WorkspaceTemplate } from "../../../shared/scoutTemplate";
import { normalizeMatchLabel } from "../../../shared/scoutMatch";
import type { ScoutEventTeam } from "../../../lib/scoutEvent";
import { lookupTeamName } from "../../TeamInput";
import { teamError } from "../../../lib/teamCheck";
import { BigFieldInput } from "../redesign/BigFieldInput";
import { breakdownTone, formPhaseLabel } from "../redesign/PhaseForm";
import { EntryPhotos } from "../EntryPhotos";
import { CommonsShare } from "../CommonsShare";
import { LoadingBlock } from "../../states";
import { Button } from "../../ui/button";
import { FieldError, Input, Label, Textarea } from "../../ui/basic";
import { toast } from "../../ui/sonner";
import { cn } from "../../cn";
import { TeamPicker } from "./TeamPicker";
import { SaveState, type SaveSync } from "./SaveState";

/** The notes box's guidance: the one place the form says what's worth writing down. */
export const NOTES_PLACEHOLDER: Record<"match" | "pit", string> = {
  match: "What stood out? Strategy, reliability, driver habits, penalties…",
  pit: "What stood out? Mechanisms, auto paths, reliability worries, what they'd want from a partner…",
};

export interface EntryEditorProps {
  kind: "match" | "pit";
  season: number;
  /** The entry opened to change (null: a new one). */
  initial: ScoutEntry | null;
  /** A new entry's team to start with. */
  team?: number;
  /** A new match entry's match to start with. */
  matchLabel?: string;
  space: ScoutSpace;
  spaceName: string | null;
  /** The workspace's current template (null: Personal, or not known yet: the built-in defaults). */
  workspaceTemplate: WorkspaceTemplate | null;
  /** The workspace's template hasn't come yet (none on this device): a new entry waits for it. */
  templatePending: boolean;
  /**
   * A read-only space. An entry opened there shows with every field disabled and no Save; a new entry, or one
   * already open when the space went read-only, keeps what was typed and saves to Personal instead.
   */
  readOnly?: boolean;
  /** The picked event: where a new entry is (null: none picked, so it can't be saved yet). */
  event: { code: string; name?: string | null } | null;
  /** The event's teams, for the team picker. */
  teams: readonly ScoutEventTeam[];
  sync: SaveSync;
  /** This form saved at least once this visit (the bar says Saved, not how saving works). */
  savedHere?: boolean;
  /** After a save: the entry and its team. */
  onSaved: (e: { uuid: string; team: number; kind: "match" | "pit" }) => void;
  onClose: () => void;
  /** Pick the event (a new entry with none picked). */
  onPickEvent?: () => void;
  /** The next team in line (pit): the Save button says it moves there. */
  nextLabel?: string | null;
  /** Above the fields: the queue position ("Pit 8 of 18"). */
  header?: ReactNode;
  /** Beside the fields on a wide screen. */
  aside?: ReactNode;
}

export function EntryEditor(p: EntryEditorProps) {
  const { season, initial, space, spaceName, workspaceTemplate, templatePending, readOnly = false } = p;
  const startedWritable = useRef(!readOnly);
  const viewOnly = readOnly && !!initial && !startedWritable.current;
  const toPersonal = readOnly && !viewOnly;
  const kind = initial?.kind ?? p.kind;
  const uid = useId();
  const [teamText, setTeamText] = useState(initial ? String(initial.team) : p.team ? String(p.team) : "");
  const [matchLabel, setMatchLabel] = useState(initial?.matchLabel ?? p.matchLabel ?? "");
  const [data, setData] = useState<Record<string, ScoutValue>>(initial?.data ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // An opened entry keeps its own event; a new one is at the picked event.
  const eventCode = initial ? initial.eventCode : p.event?.code ?? null;
  // An edit keeps the template it was made with; a new entry uses the space's current one.
  const entryTemplate = useEntryTemplateState(initial ?? { season, kind, templateId: undefined, templateVersion: undefined });
  const latestTemplate = useMemo(() => (initial ? entryTemplate.template : resolveTemplate(space == null ? null : workspaceTemplate, season, kind)),
    [initial, kind, entryTemplate.template, space, workspaceTemplate, season]);
  // Once a field has an answer, a new entry keeps the template it was being filled in with: one that arrives
  // late never swaps the questions, or drops answers, mid-entry (per space, season and kind).
  const scope = `${space ?? ""}:${season}:${kind}`;
  const [pinned, setPinned] = useState<{ scope: string; template: typeof latestTemplate } | null>(null);
  const template = !initial && pinned?.scope === scope ? pinned.template : latestTemplate;
  const answer = (id: string, v: ScoutValue | undefined) => {
    if (!initial && pinned?.scope !== scope) setPinned({ scope, template });
    setData((d) => { const n = { ...d }; if (v === undefined) delete n[id]; else n[id] = v; return n; });
  };
  // A new entry moved to another space or season starts its answers afresh.
  const where = `${space ?? ""}:${season}`;
  const shownWhere = useRef(where);
  useEffect(() => {
    if (shownWhere.current === where) return;
    shownWhere.current = where;
    if (!initial) { setData({}); setPinned(null); }
  }, [where, initial]);
  const fieldsLocked = !!initial && !entryTemplate.exact;
  const fieldsPending = !initial && templatePending;
  const [teamErr, setTeamErr] = useState<string | null>(null);
  const [eventErr, setEventErr] = useState<string | null>(null);
  const [matchErr, setMatchErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const teamRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ teamText, matchLabel, data, notes, space, template, fieldsLocked });
  latest.current = { teamText, matchLabel, data, notes, space, template, fieldsLocked };
  // The server version this edit started from (Task 16): a newer one arriving while open is one this save never saw.
  const draftBase = useRef(initial ? scoutDraftBase(initial) : undefined);
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);

  const save = async () => {
    setSaveErr(null);
    const team = teamText;
    // Team and event first, inline, before anything is checked over the network.
    if (!team) { setTeamErr("Pick the team first."); teamRef.current?.focus(); return; }
    if (!eventCode && !initial) { setEventErr("Pick the event you're at first."); return; }
    if (kind === "match" && !normalizeMatchLabel(matchLabel)) { setMatchErr("Which match? For example Q12."); return; }
    // A team on the event's list is known; any other is checked (a typo, a team that doesn't exist).
    let err: string | null = null;
    if (!p.teams.some((t) => String(t.team) === team)) {
      setChecking(true);
      err = await teamError(team, lookupTeamName);
      if (!open.current) return;
      setChecking(false);
    }
    if (latest.current.teamText !== team) return; // changed while checking: the next Save checks the new one
    if (latest.current.space !== space) return; // switched spaces while checking
    if (err) { setTeamErr(err); return; }
    const { matchLabel: label, data: all, notes, template, fieldsLocked } = latest.current;
    // A new entry keeps only the template's fields (and their details); an edit keeps everything it had.
    const ids = new Set(template.fields.flatMap((f) => (f.type === "toggleDetail" ? [f.id, detailKey(f.id)] : [f.id])));
    const out = initial ? { ...all } : Object.fromEntries(Object.entries(all).filter(([k]) => ids.has(k)));
    // A detail belongs to a yes: with the yes taken back, its detail goes too.
    for (const f of template.fields) if (f.type === "toggleDetail" && out[f.id] !== true) delete out[detailKey(f.id)];
    // A counter shows its lowest value until it's touched: that shown value is the answer.
    if (!fieldsLocked) for (const f of template.fields) if (f.type === "counter" && (f.min ?? 0) > 0 && out[f.id] === undefined) out[f.id] = f.min!;
    // Workspace entries record the template they were made with (an edit keeps its own); Personal uses the built-ins.
    const made = space == null || toPersonal ? {}
      : initial ? (initial.templateId ? { templateId: initial.templateId, templateVersion: initial.templateVersion ?? 0 } : {})
      : { templateId: template.id, templateVersion: template.version ?? 0 };
    // Kept in Personal (the workspace went read-only): its own answers go into the notes, which must fit them.
    const copy = toPersonal ? personalCopy(out, notes, template.fields, resolveTemplate(null, season, kind).fields, spaceName) : null;
    if (copy?.overflow) { setSaveErr(`The workspace's answers are written into the notes in Personal: shorten the notes by ${copy.overflow} characters so they fit.`); saveRef.current?.focus(); return; }
    const kept = copy ? { data: copy.data, notes: copy.notes } : { data: out, notes };
    const uuid = (toPersonal ? null : initial?.uuid) ?? newScoutId();
    try {
      saveScoutEntry({ uuid, season, team: Number(team), eventCode: eventCode ? eventCode.toUpperCase() : null, matchLabel: kind === "match" ? normalizeMatchLabel(label) : null, kind, ...kept, workspaceId: toPersonal ? null : space, ...made },
        initial && !toPersonal ? { base: draftBase.current ?? null } : {});
      if (toPersonal) toast.success("Kept in Personal: the workspace is read-only");
      p.onSaved({ uuid, team: Number(team), kind });
    } catch (e) {
      setSaveErr(e instanceof ScoutStorageError ? e.message : "Couldn't save this entry on this device. Try again.");
      saveRef.current?.focus();
    }
  };

  const phases = kind === "pit" ? (["pit"] as const) : MATCH_PHASES;
  const unsaved = !!initial && (teamText !== String(initial.team) || notes !== initial.notes || JSON.stringify(data) !== JSON.stringify(initial.data));
  const fieldsBody = fieldsPending ? <LoadingBlock rows={2} label="Loading the workspace's fields" /> : fieldsLocked ? (
    <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      This entry was made with an earlier version of the workspace's fields, which this device hasn't loaded yet. Its answers are kept as they are; you can still change the notes.
    </p>
  ) : (
    <div className="grid gap-5">
      {phases.map((ph) => {
        const fields = template.fields.filter((f) => f.phase === ph);
        if (!fields.length) return null;
        return (
          <fieldset key={ph} className="m-0 min-w-0 border-0 p-0">
            {kind === "match" && <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{formPhaseLabel(ph)}</legend>}
            <div className="grid gap-2 md:grid-cols-2">
              {fields.map((f) => {
                const dk = detailKey(f.id), d = data[dk];
                return <BigFieldInput key={f.id} f={f} value={data[f.id]} onChange={(v) => answer(f.id, v)} tone={breakdownTone(f)} idPrefix={`${uid}-f`}
                  detail={typeof d === "string" ? d : ""} onDetail={(text) => answer(dk, text || undefined)} />;
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );

  const saveLabel = toPersonal ? "Save to Personal" : "Save";
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!viewOnly) void save(); }} noValidate aria-label={initial ? `${kind === "pit" ? "Pit" : "Match"} entry ${initial.team}` : kind === "pit" ? "Pit entry" : "Match entry"}
      className={cn("grid items-start gap-6", p.aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
      <div className="grid min-w-0 gap-5">
        {p.header}
        <fieldset disabled={viewOnly} className="m-0 grid min-w-0 gap-5 border-0 p-0">
          <div className={cn("grid gap-4", kind === "match" && "sm:grid-cols-[minmax(0,1fr)_10rem]")}>
            <TeamPicker teams={p.teams} value={teamText} onChange={(v) => { setTeamText(v); setTeamErr(null); }} error={teamErr} inputRef={teamRef} disabled={viewOnly} />
            {kind === "match" && (
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-match`}>Match</Label>
                <Input id={`${uid}-match`} value={matchLabel} onChange={(e) => { setMatchLabel(e.target.value); setMatchErr(null); }} placeholder="Q12" autoComplete="off"
                  aria-invalid={!!matchErr || undefined} aria-describedby={matchErr ? `${uid}-match-err` : undefined} className="h-12 font-mono uppercase" />
                <FieldError id={`${uid}-match-err`}>{matchErr}</FieldError>
              </div>
            )}
          </div>
          {/* The event is inherited, never typed: the picked one for a new entry, the entry's own when opened. */}
          <p className="-mt-2 text-sm text-muted-foreground">
            {eventCode ? <>At <span className="font-medium text-foreground">{(!initial && p.event?.name) || eventCode}</span>{!initial && p.event?.name ? <span className="font-mono"> · {eventCode}</span> : null}</>
              : initial ? "No event: an older entry, kept as it was." : (
                <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-danger-text">
                  <TriangleAlert className="size-4" aria-hidden />{eventErr ?? "No event picked yet."}
                  {p.onPickEvent && <Button type="button" size="sm" variant="outline" onClick={p.onPickEvent}>Pick the event</Button>}
                </span>
              )}
          </p>
          {fieldsBody}
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-notes`}>Notes</Label>
            <Textarea id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={NOTES_MAX} placeholder={NOTES_PLACEHOLDER[kind]} className="min-h-24" />
          </div>
        </fieldset>
        {initial && <EntryPhotos entry={initial} editable={!readOnly} />}
        {initial && !isScoutQueued(initial) && <CommonsShare e={initial} readOnly={readOnly} unsaved={unsaved} />}
        {toPersonal && (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            This workspace is read-only now, so this entry can't be saved to it. Save keeps what you typed in Personal{initial ? ", as a new entry of your own" : ""}.
          </p>
        )}
        {viewOnly && <p className="text-sm text-muted-foreground">This workspace is read-only, so this entry can be read but not changed.</p>}
        {/* Always in reach: stuck to the bottom of the screen (above a phone's tab bar) while the form scrolls. */}
        <div data-sticky-actions className="sticky z-30 -mx-4 border-t border-line bg-secondary px-4 py-2.5 max-md:bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:bottom-3 md:mx-0 md:rounded-xl md:border md:shadow-lg">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* A phone: where saving stands on its own line, then Cancel and a wide Save under the thumb. */}
            <div className="min-w-0 flex-1 basis-40 max-sm:basis-full">
              {!viewOnly && <SaveState sync={p.sync} savedHere={!!p.savedHere} />}
              {spaceName && !toPersonal && !viewOnly && <p className="truncate text-xs text-muted-foreground">To <span className="font-medium text-foreground">{spaceName}</span>, shared with the workspace</p>}
            </div>
            <Button type="button" variant={viewOnly ? "outline" : "ghost"} onClick={p.onClose} className="max-sm:h-11">{viewOnly ? "Close" : "Cancel"}</Button>
            {!viewOnly && (
              <Button ref={saveRef} type="submit" disabled={checking || fieldsPending} aria-describedby={saveErr ? `${uid}-save-err` : undefined} className="max-sm:h-11 max-sm:flex-1">
                <Save />{saveLabel}{p.nextLabel && !toPersonal ? <span className="font-medium opacity-80">· next {p.nextLabel} <ArrowRight className="inline" /></span> : null}
              </Button>
            )}
          </div>
          <FieldError id={`${uid}-save-err`} className="mt-1">{saveErr}</FieldError>
        </div>
      </div>
      {p.aside && <aside aria-label="Beside the form" className="grid min-w-0 gap-4 lg:sticky lg:top-20">{p.aside}</aside>}
    </form>
  );
}
