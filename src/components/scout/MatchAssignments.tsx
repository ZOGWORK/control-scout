// Match scouting in the Assignments view: who watches which slot or alliance for which quals at an event
// ("Priya: Red 1, Q1–Q30"), so the Scout page can start each member on their own slot and show who has the
// other teams. Every member sees the list; admins add, edit and remove (server/scout/assignments.ts decides).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Radar, Trash2 } from "lucide-react";
import { ApiError } from "../../lib/api";
import { fetchAssignOptions } from "../../lib/assignments";
import { createMatchAssignment, deleteMatchAssignment, updateMatchAssignment, type MatchAssignmentsState } from "../../lib/slotAssignments";
import { useMediaQuery } from "../../lib/meta";
import {
  matchAssignmentsOverlap, matchRangeLabel, normalEventCode, qualNumber, type AssignableMember, type MatchAssignment,
} from "../../shared/assignments";
import { SLOTS, slotLabel, watchingLabel, type AllianceSide, type SlotId, type Watching } from "../../shared/scoutMatch";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { Badge, Input, Label } from "../ui/basic";
import { ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { EventPicker } from "./EventPicker";

const sideOf = (s: SlotId): AllianceSide => (s.startsWith("red") ? "red" : "blue");
const dot = (side: AllianceSide) => <span aria-hidden className={cn("size-2 shrink-0 rounded-full", side === "red" ? "bg-red-alliance" : "bg-blue-alliance")} />;

/** "Red 1 · Q1–Q30" */
export const matchAssignmentLabel = (a: Pick<MatchAssignment, "watching" | "fromMatch" | "toMatch">) => `${watchingLabel(a.watching)} · ${matchRangeLabel(a.fromMatch, a.toMatch)}`;

export function MatchAssignmentsSection({ space, season, defaultEvent, state, myAccountId, isAdmin, readOnly = false }: {
  space: string; season: number; defaultEvent: string; state: MatchAssignmentsState;
  myAccountId: number | null; isAdmin: boolean; readOnly?: boolean;
}) {
  const { list, loading, error, reload } = state;
  const admin = isAdmin && !readOnly;
  // null: closed; "new": adding; an assignment: editing it.
  const [editing, setEditing] = useState<MatchAssignment | "new" | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const byEvent = useMemo(() => {
    const m = new Map<string, MatchAssignment[]>();
    for (const a of list) m.set(a.eventCode, [...(m.get(a.eventCode) ?? []), a]);
    // In match order, then by slot, so a captain reads the event's coverage top to bottom.
    for (const rows of m.values()) rows.sort((a, b) => (qualNumber(a.fromMatch) ?? 0) - (qualNumber(b.fromMatch) ?? 0) || watchingLabel(a.watching).localeCompare(watchingLabel(b.watching)) || a.id - b.id);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list]);

  const remove = async (a: MatchAssignment) => {
    setBusy(a.id);
    try {
      await deleteMatchAssignment(space, a.id);
      state.apply({ action: "deleted", matchAssignments: [a] });
      toast(`Removed ${a.assigneeName}'s ${matchAssignmentLabel(a)}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't remove that. Try again.");
    } finally { setBusy(null); }
  };

  const first = loading && !list.length;
  return (
    <>
      <Section stackAction title="Match scouting" description={admin ? "Who watches which slot or alliance, for which quals. Their Scout screen starts there." : "Who watches which slot or alliance, for which quals."}
        action={admin ? <Button variant="outline" onClick={() => setEditing("new")}><Plus /> Add</Button> : undefined}>
        {first ? <LoadingBlock rows={2} label="Loading match scouting" />
          : error && !list.length ? <ErrorState error={error} onRetry={reload} />
            : !list.length ? (
              <EmptyState icon={Radar} title={`No match scouting set in ${season}`}
                description={admin ? "Give each member a slot or an alliance and a run of quals, like Red 1 for Q1–Q30." : "Admins split matches from here."} />
            ) : (
              <div className="space-y-5 max-sm:space-y-4">
                {byEvent.map(([event, rows]) => (
                  <section key={event} aria-label={`Match scouting at ${event}`}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><span className="font-mono">{event}</span></h3>
                    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                      {rows.map((a) => {
                        const who = a.assigneeAccountId === myAccountId ? "You" : a.assigneeName || "A member";
                        const w = a.watching;
                        return (
                          <li key={a.id} className="flex items-center gap-3 px-4 py-3" data-testid="match-assignment-row">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-5 [overflow-wrap:anywhere]">{who}</p>
                              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                {w.kind === "all" ? <>{dot("red")}{dot("blue")}</> : dot(w.kind === "slot" ? sideOf(w.slot) : w.side)}
                                <span>{watchingLabel(w)}</span>
                              </p>
                            </div>
                            <Badge variant="outline" className="shrink-0 font-mono">{matchRangeLabel(a.fromMatch, a.toMatch)}</Badge>
                            {admin && (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} disabled={busy === a.id} aria-label={`Edit ${a.assigneeName || "a member"}'s ${matchAssignmentLabel(a)}`}><Pencil /></Button>
                                <Button variant="ghost" size="icon-sm" onClick={() => remove(a)} disabled={busy === a.id} aria-label={`Remove ${a.assigneeName || "a member"}'s ${matchAssignmentLabel(a)}`}>{busy === a.id ? <Loader2 className="animate-spin" /> : <Trash2 />}</Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
      </Section>
      {admin && (
        <MatchAssignSheet open={editing != null} editing={editing === "new" ? null : editing} onOpenChange={(v) => { if (!v) setEditing(null); }}
          space={space} season={season} defaultEvent={defaultEvent} state={state} myAccountId={myAccountId} />
      )}
    </>
  );
}

const KINDS: { kind: Watching["kind"]; label: string }[] = [
  { kind: "slot", label: "One team" }, { kind: "alliance", label: "Alliance" }, { kind: "all", label: "All 4" },
];

export function MatchAssignSheet({ open, editing, onOpenChange, space, season, defaultEvent, state, myAccountId }: {
  open: boolean; editing: MatchAssignment | null; onOpenChange: (v: boolean) => void;
  space: string; season: number; defaultEvent: string; state: MatchAssignmentsState; myAccountId: number | null;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const [eventText, setEventText] = useState(defaultEvent);
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [member, setMember] = useState<number | null>(null);
  const [kind, setKind] = useState<Watching["kind"]>("slot");
  const [slot, setSlot] = useState<SlotId>("red1");
  const [side, setSide] = useState<AllianceSide>("red");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);
  const eventCode = normalEventCode(eventText);

  // Opening starts from the assignment being edited, or afresh from the workspace's default event.
  useEffect(() => {
    if (!open) return;
    const w = editing?.watching;
    setEventText(editing?.eventCode ?? defaultEvent);
    setMember(editing?.assigneeAccountId ?? null);
    setKind(w?.kind ?? "slot");
    setSlot(w?.kind === "slot" ? w.slot : "red1");
    setSide(w?.kind === "alliance" ? w.side : w?.kind === "slot" ? sideOf(w.slot) : "red");
    setFrom(editing?.fromMatch ?? ""); setTo(editing?.toMatch ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- only when it opens

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoadErr(null);
    fetchAssignOptions(space, season, "")
      .then((r) => { if (live) setMembers(r.members); })
      .catch((e) => { if (live) setLoadErr(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the members.")); });
    return () => { live = false; };
  }, [open, space, season]);

  const watching: Watching = kind === "slot" ? { kind, slot } : kind === "alliance" ? { kind, side } : { kind: "all" };
  const fromN = from.trim() ? qualNumber(from) : null, toN = to.trim() ? qualNumber(to) : null;
  const rangeErr = (from.trim() && fromN == null) || (to.trim() && toN == null) ? "Use qual numbers, like 1 or Q30."
    : fromN != null && toN != null && fromN > toN ? `Q${fromN} comes after Q${toN}.` : null;
  const fromMatch = fromN != null ? `Q${fromN}` : null, toMatch = toN != null ? `Q${toN}` : null;

  // Someone else watching the same slot in some of the same matches: a warning, never a block.
  const overlaps = useMemo(() => !eventCode || rangeErr ? [] : state.list.filter((o) => o.id !== editing?.id
    && matchAssignmentsOverlap({ season, eventCode, watching, fromMatch, toMatch }, o)), [state.list, editing, season, eventCode, rangeErr, watching.kind, slot, side, fromMatch, toMatch]); // eslint-disable-line react-hooks/exhaustive-deps -- watching is rebuilt from kind/slot/side

  const submit = async () => {
    if (!eventCode || member == null || rangeErr) return;
    setSaving(true);
    try {
      const body = { season, eventCode, watching, fromMatch, toMatch, assigneeAccountId: member };
      const r = editing ? await updateMatchAssignment(space, editing.id, body) : await createMatchAssignment(space, body);
      state.apply({ action: editing ? "updated" : "created", matchAssignments: [r.matchAssignment] });
      const who = member === myAccountId ? "you" : r.matchAssignment.assigneeName;
      toast.success(`${editing ? "Changed" : "Assigned"}: ${who}, ${matchAssignmentLabel(r.matchAssignment)}`);
      if (r.overlaps.length) toast.warning(`Same slot, same matches: ${r.overlaps.map((o) => `${o.assigneeAccountId === myAccountId ? "you" : o.assigneeName} (${matchAssignmentLabel(o)})`).join("; ")}`, { duration: 8000 });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save that. Try again.");
    } finally { setSaving(false); }
  };

  const subChoices = kind === "slot"
    ? SLOTS.map((s) => ({ value: s, label: slotLabel(s), side: sideOf(s) }))
    : (["red", "blue"] as const).map((s) => ({ value: s, label: s === "red" ? "Red" : "Blue", side: s }));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} className={cn("gap-0 p-0", phone ? "h-[90dvh]" : "")} aria-describedby={undefined}>
        <SheetHeader className="border-b border-border px-5 max-sm:px-4 pb-4 pt-5">
          <SheetTitle>{editing ? "Change match scouting" : "Assign match scouting"}</SheetTitle>
          <SheetDescription>Who watches what, for which quals. Their Scout screen starts there.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 max-sm:space-y-4 overflow-y-auto px-5 max-sm:px-4 py-4">
          <div>
            <Label htmlFor="match-assign-event">Event · {season}</Label>
            <EventPicker id="match-assign-event" season={season} code={eventText} onChange={setEventText} />
          </div>
          {loadErr ? <ErrorState error={loadErr} /> : (
            <fieldset>
              <legend className="text-sm font-medium">Who scouts</legend>
              <p className="mt-0.5 text-xs text-muted-foreground">Only members who've signed in to Scout are listed.</p>
              {members == null ? <div className="mt-2"><LoadingBlock rows={1} label="Loading members" /></div> : !members.length ? (
                <p className="mt-2 text-sm text-muted-foreground">No members have signed in to Scout yet.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Who scouts">
                  {members.map((m) => {
                    const on = member === m.accountId;
                    return (
                      <button key={m.accountId} type="button" role="radio" aria-checked={on} onClick={() => setMember(m.accountId)}
                        className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
                          on ? "border-accent bg-accent text-accent-ink" : "border-border bg-card text-foreground hover:bg-muted")}>
                        {on && <Check className="size-4" />}{m.accountId === myAccountId ? `${m.name} (you)` : m.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}
          <div className="grid gap-1.5">
            <p id="match-assign-watch" className="text-sm font-medium">What they watch</p>
            <ToggleGroup type="single" role="radiogroup" aria-labelledby="match-assign-watch" value={kind} onValueChange={(v) => { if (v) setKind(v as Watching["kind"]); }} className="flex w-full">
              {KINDS.map((k) => <ToggleGroupItem key={k.kind} value={k.kind} className="flex-1 max-sm:min-h-11">{k.label}</ToggleGroupItem>)}
            </ToggleGroup>
            {kind !== "all" && (
              <ToggleGroup type="single" role="radiogroup" aria-label={kind === "slot" ? "Which team" : "Which alliance"} value={kind === "slot" ? slot : side}
                onValueChange={(v) => {
                  if (!v) return;
                  if (kind === "slot") { setSlot(v as SlotId); setSide(sideOf(v as SlotId)); } else setSide(v as AllianceSide);
                }} className="mt-1 flex w-full">
                {subChoices.map((c) => (
                  <ToggleGroupItem key={c.value} value={c.value} className="flex-1 max-sm:min-h-11">{dot(c.side)}{c.label}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Which quals</legend>
            <p className="mt-0.5 text-xs text-muted-foreground">Leave an end empty to start at the first or run to the last.</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="match-assign-from" className="text-xs text-muted-foreground">From</Label>
                <Input id="match-assign-from" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Q1" className="h-11 font-mono" aria-invalid={!!rangeErr} />
              </div>
              <div>
                <Label htmlFor="match-assign-to" className="text-xs text-muted-foreground">To</Label>
                <Input id="match-assign-to" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Last" className="h-11 font-mono" aria-invalid={!!rangeErr} />
              </div>
            </div>
            <p className={cn("mt-2 text-sm", rangeErr ? "text-destructive" : "text-muted-foreground")} role={rangeErr ? "alert" : undefined}>
              {rangeErr ?? `${watchingLabel(watching)} · ${matchRangeLabel(fromMatch, toMatch)}`}
            </p>
          </fieldset>
        </div>
        {overlaps.length > 0 && (
          <div role="status" className="mx-5 mt-3 flex max-h-40 items-start gap-2 overflow-y-auto rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">Someone already watches this in some of these matches</p>
              <ul className="mt-1 text-muted-foreground">
                {overlaps.slice(0, 4).map((o) => <li key={o.id}>{o.assigneeAccountId === myAccountId ? "You" : o.assigneeName}: {matchAssignmentLabel(o)}</li>)}
                {overlaps.length > 4 && <li>and {overlaps.length - 4} more</li>}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">You can still save it; this is just so it's on purpose.</p>
            </div>
          </div>
        )}
        <SheetFooter className="mt-3 border-t border-border px-5 max-sm:px-4 py-4">
          <Button className="w-full sm:w-auto" onClick={submit} disabled={saving || !eventCode || member == null || !!rangeErr}>
            {saving ? <Loader2 className="animate-spin" /> : editing ? <Check /> : <Plus />}
            {editing ? "Save" : "Assign"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
