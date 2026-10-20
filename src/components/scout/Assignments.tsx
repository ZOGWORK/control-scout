// The Assignments view of a workspace's scout space (?view=assignments, Task 10): My assignments for
// every member (progress, Scout, Done), the whole workspace's list (so nobody scouts a team twice
// unknowingly), and for admins an Assign sheet: pick members and the event's teams, many at once.
// Who may do what is the server's call (server/scout/assignments.ts); the buttons only follow it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, CircleCheck, ClipboardCheck, ClipboardList, Loader2, RotateCcw, Search, Trash2, UserPlus } from "lucide-react";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { useMediaQuery } from "../../lib/meta";
import { ApiError } from "../../lib/api";
import {
  assignedLabel, assignmentProgress, createAssignments, deleteAssignment, fetchAssignOptions, setAssignmentStatus, useAssignmentIndex,
  type Assignment, type AssignmentsState,
} from "../../lib/assignments";
import type { ScoutEntry } from "../../lib/scouting";
import { assignmentKey, normalEventCode, type AssignableMember, type EventTeamOption } from "../../shared/assignments";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { Badge, Input, Label } from "../ui/basic";
import { Checkbox } from "../ui/controls";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { EventPicker } from "./EventPicker";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AssignmentsView({ space, workspaceName, season, defaultEvent, state, myAccountId, isAdmin: admin, localEntries, onScout, readOnly = false }: {
  space: string; workspaceName: string; season: number;
  /** The space is read-only (Task 19): the lists read, nothing can be assigned, scouted, marked or removed. */
  readOnly?: boolean;
  /** The workspace's default event (settings), for the Assign sheet. */
  defaultEvent: string;
  state: AssignmentsState;
  myAccountId: number | null;
  isAdmin: boolean;
  /** This space's entries on the device, for live progress. */
  localEntries: ScoutEntry[];
  /** Open a new entry for this team at this event. */
  onScout: (team: number, eventCode: string) => void;
}) {
  const { list, loading, error, reload } = state;
  const isAdmin = admin && !readOnly;
  const [assignOpen, setAssignOpen] = useState(false);
  const mine = useMemo(() => list.filter((a) => a.assigneeAccountId === myAccountId)
    .sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === "open" ? -1 : 1)), [list, myAccountId]);
  const byEvent = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of list) m.set(a.eventCode, [...(m.get(a.eventCode) ?? []), a]);
    // By team, so a team held by two members reads as two rows together.
    for (const rows of m.values()) rows.sort((a, b) => a.team - b.team || a.assigneeName.localeCompare(b.assigneeName));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list]);
  const act = useActions(space, state);
  const first = loading && !list.length;
  return (
    <>
      <Section stackAction title="My assignments" description={`Teams you've been asked to scout in ${season}. Tap Done when you've finished one.`}
        action={isAdmin ? <Button onClick={() => setAssignOpen(true)}><UserPlus /> Assign</Button> : undefined}>
        {first ? <LoadingBlock rows={2} label="Loading assignments" />
          : error && !list.length ? <ErrorState error={error} onRetry={reload} />
            : !mine.length ? (
              <EmptyState icon={ClipboardCheck} title="Nothing assigned to you yet"
                description={isAdmin ? "Use Assign to deal out teams, including to yourself. Assignees get a notification." : `When an admin of ${workspaceName} assigns you a team, it shows up here and in your notifications.`} />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2" aria-label="My assignments">
                {mine.map((a) => (
                  <AssignmentCard key={a.id} a={a} progress={assignmentProgress(a, localEntries, myAccountId)} busy={act.busy === a.id}
                    canDone={!readOnly && a.status === "open"} canReopen={isAdmin && a.status === "done"} canScout={!readOnly}
                    onDone={() => act.status(a, "done")} onReopen={() => act.status(a, "open")} onScout={() => onScout(a.team, a.eventCode)} />
                ))}
              </ul>
            )}
      </Section>
      <Section title="Everyone's assignments" description={isAdmin ? "Who scouts what, by event. Mark one done, reopen it, or remove it." : "Who scouts what, by event, so two people don't scout the same team without knowing."}>
        {first ? <LoadingBlock rows={3} label="Loading assignments" /> : !list.length ? (
          <EmptyState icon={ClipboardList} title={`No assignments in ${season} yet`} description={isAdmin ? "Tap Assign to pick members and the event's teams." : "Admins assign teams from here."} />
        ) : (
          <div className="space-y-5">
            {byEvent.map(([event, rows]) => (
              <section key={event} aria-label={event}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="font-mono">{event}</span>
                  <span className="font-normal normal-case tracking-normal">{plural(rows.filter((r) => r.status === "done").length, "done", "done")} of {rows.length}</span>
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {rows.map((a) => (
                    <AssignmentRow key={a.id} a={a} progress={assignmentProgress(a, localEntries, myAccountId)} mine={!readOnly && a.assigneeAccountId === myAccountId} isAdmin={isAdmin}
                      busy={act.busy === a.id} onDone={() => act.status(a, "done")} onReopen={() => act.status(a, "open")} onDelete={() => act.remove(a)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Section>
      {isAdmin && (
        <AssignSheet open={assignOpen} onOpenChange={setAssignOpen} space={space} season={season} defaultEvent={defaultEvent} state={state} myAccountId={myAccountId} />
      )}
    </>
  );
}

function useActions(space: string, state: AssignmentsState) {
  const [busy, setBusy] = useState<number | null>(null);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn't change that assignment. Try again.");
  return {
    busy,
    status: async (a: Assignment, status: "open" | "done") => {
      setBusy(a.id);
      try {
        const r = await setAssignmentStatus(space, a.id, status);
        state.apply({ action: "updated", assignments: [r.assignment] });
        toast.success(status === "done" ? `Team ${a.team} marked done` : `Team ${a.team} reopened`);
      } catch (e) { fail(e); } finally { setBusy(null); }
    },
    remove: async (a: Assignment) => {
      setBusy(a.id);
      try {
        await deleteAssignment(space, a.id);
        state.apply({ action: "deleted", assignments: [a] });
        toast(`Removed ${a.assigneeName}'s assignment for team ${a.team}`);
      } catch (e) { fail(e); } finally { setBusy(null); }
    },
  };
}

function StatusBadge({ a }: { a: Assignment }) {
  return a.status === "done"
    ? <Badge variant="success"><Check /> Done</Badge>
    : <Badge variant="beta">Open</Badge>;
}

function AssignmentCard({ a, progress, busy, canDone, canReopen, canScout, onDone, onReopen, onScout }: {
  a: Assignment; progress: number; busy: boolean; canDone: boolean; canReopen: boolean; canScout: boolean;
  onDone: () => void; onReopen: () => void; onScout: () => void;
}) {
  const now = useNow();
  return (
    <li className={cn("rounded-xl border bg-card p-4", a.status === "done" ? "border-border opacity-80" : "border-sky-500/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight">
            <Link to={`/teams/${a.team}?season=${a.season}`} className="font-mono hover:underline">{a.team}</Link>
            <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{a.eventCode}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Assigned by {a.createdByName || "an admin"} · {agoShort(a.createdAt, now)}</p>
        </div>
        <StatusBadge a={a} />
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm" aria-live="polite">
        <span className={cn("grid size-8 place-items-center rounded-full text-sm font-semibold tabular-nums", progress ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{progress}</span>
        <span className="text-muted-foreground">{progress === 1 ? "entry" : "entries"} by you for this team here</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {a.status === "open" && canScout && <Button onClick={onScout}><ClipboardList /> Scout</Button>}
        {canDone && <Button variant="outline" onClick={onDone} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CircleCheck />} Done</Button>}
        {canReopen && <Button variant="outline" onClick={onReopen} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reopen</Button>}
      </div>
    </li>
  );
}

function AssignmentRow({ a, progress, mine, isAdmin, busy, onDone, onReopen, onDelete }: {
  a: Assignment; progress: number; mine: boolean; isAdmin: boolean; busy: boolean;
  onDone: () => void; onReopen: () => void; onDelete: () => void;
}) {
  const who = mine ? "You" : a.assigneeName || "A member";
  const canDone = a.status === "open" && (mine || isAdmin), canReopen = a.status === "done" && isAdmin;
  // Who and what first, in full: two members named alike ("Alexandra Whitfield-Montgomery", "Alexandra
  // Whitfield-Morales") must never be cut down to the same prefix. Names wrap rather than truncate; on a phone
  // the actions take their own row below, on wider screens they sit at the end of the line.
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="assignment-row">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Link to={`/teams/${a.team}?season=${a.season}`} className="w-16 shrink-0 font-mono font-medium leading-5 hover:underline">{a.team}</Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 [overflow-wrap:anywhere]">{who}</p>
          {/* Entries observed for this team (progress) and who completed it are separate facts: one never stands for the other. */}
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{plural(progress, "entry", "entries")}{a.status === "done" && a.doneByName ? ` · done by ${mine && a.doneByAccountId === a.assigneeAccountId ? "you" : a.doneByName}` : ""}</p>
        </div>
        <span className="shrink-0"><StatusBadge a={a} /></span>
      </div>
      {(canDone || canReopen || isAdmin) && (
        <div className="flex items-center gap-2 pl-[4.75rem] sm:pl-0">
          {canDone && (
            <Button variant="outline" size="sm" onClick={onDone} disabled={busy} aria-label={`Mark team ${a.team} done for ${who === "You" ? "you" : who}`}>{busy ? <Loader2 className="animate-spin" /> : <CircleCheck />} Done</Button>
          )}
          {canReopen && (
            <Button variant="outline" size="sm" onClick={onReopen} disabled={busy} aria-label={`Reopen team ${a.team} for ${who === "You" ? "you" : who}`}><RotateCcw /> Reopen</Button>
          )}
          {/* Removing sits apart from the frequent Done/Reopen, at the far end of the row. */}
          {isAdmin && (
            <Button variant="ghost" size="icon-sm" className="ml-auto sm:ml-1" onClick={onDelete} disabled={busy} aria-label={`Remove ${a.assigneeName || "a member"}'s assignment for team ${a.team}`}><Trash2 /></Button>
          )}
        </div>
      )}
    </li>
  );
}

// --- Assign (admins) --------------------------------------------------------------------------

function AssignSheet({ open, onOpenChange, space, season, defaultEvent, state, myAccountId }: {
  open: boolean; onOpenChange: (v: boolean) => void; space: string; season: number; defaultEvent: string; state: AssignmentsState; myAccountId: number | null;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const [eventText, setEventText] = useState(defaultEvent);
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [teams, setTeams] = useState<EventTeamOption[] | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [pickedMembers, setPickedMembers] = useState<Set<number>>(new Set());
  const [pickedTeams, setPickedTeams] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const index = useAssignmentIndex(state.list);
  const eventCode = normalEventCode(eventText);

  // Opening starts afresh from the workspace's default event.
  useEffect(() => { if (open) { setEventText(defaultEvent); setPickedMembers(new Set()); setPickedTeams(new Set()); setFilter(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- only when it opens

  // The members and the event's teams, once the event code has settled.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setTeams(null); setLoadErr(null); setPickedTeams(new Set());
    const t = setTimeout(() => {
      fetchAssignOptions(space, season, eventCode ?? "")
        .then((r) => { if (live) { setMembers(r.members); setTeams(eventCode ? r.teams : []); } })
        .catch((e) => { if (live) setLoadErr(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the members and teams.")); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, space, season, eventCode]);

  const shownTeams = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (teams ?? []).filter((t) => !q || String(t.team).includes(q) || (t.name ?? "").toLowerCase().includes(q));
  }, [teams, filter]);
  const toggle = (set: Set<number>, v: number) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const nameOf = useCallback((id: number) => (id === myAccountId ? "you" : members?.find((m) => m.accountId === id)?.name ?? "a member"), [members, myAccountId]);

  // Teams that would have more than one scout at this event (someone already holds it, or several members are
  // picked): a warning, never a block. The server says the same in its answer.
  const clashes = useMemo(() => {
    if (!eventCode) return [];
    const out: { team: number; holders: string[] }[] = [];
    for (const team of [...pickedTeams].sort((x, y) => x - y)) {
      const names = new Map((index.get(assignmentKey(season, eventCode, team)) ?? []).map((h) => [h.assigneeAccountId, h.assigneeAccountId === myAccountId ? "you" : h.assigneeName]));
      for (const m of pickedMembers) if (!names.has(m)) names.set(m, nameOf(m));
      if (names.size > 1) out.push({ team, holders: [...names.values()] });
    }
    return out;
  }, [pickedTeams, pickedMembers, index, season, eventCode, nameOf, myAccountId]);

  const submit = async () => {
    if (!eventCode || !pickedTeams.size || !pickedMembers.size) return;
    setSaving(true);
    try {
      const r = await createAssignments(space, { season, eventCode, teams: [...pickedTeams].sort((a, b) => a - b), assigneeAccountIds: [...pickedMembers] });
      if (r.created.length) state.apply({ action: "created", assignments: r.created });
      const who = [...pickedMembers].map(nameOf).join(", ");
      toast.success(r.created.length ? `Assigned ${plural(r.created.length, "team")} to ${who}` : "Those were already assigned");
      if (r.duplicates.length) {
        toast.warning(`Scouted by more than one member: ${r.duplicates.map((d) => `${d.team} (${d.assignees.map((x) => (x.accountId === myAccountId ? "you" : x.name)).join(", ")})`).join("; ")}`, { duration: 8000 });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't assign those. Try again.");
    } finally { setSaving(false); }
  };

  const allShown = shownTeams.length > 0 && shownTeams.every((t) => pickedTeams.has(t.team));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} className={cn("gap-0 p-0", phone ? "h-[90dvh]" : "")} aria-describedby={undefined}>
        <SheetHeader className="border-b border-border px-5 pb-4 pt-5">
          <SheetTitle>Assign teams</SheetTitle>
          <SheetDescription>Pick who scouts and which teams. Assignees get a notification.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="assign-event">Event · {season}</Label>
            <EventPicker id="assign-event" season={season} code={eventText} onChange={setEventText} />
          </div>
          {loadErr ? <ErrorState error={loadErr} /> : (
            <>
              <fieldset>
                <legend className="text-sm font-medium">Who scouts</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">Only members who've signed in to Scout are listed.</p>
                {members == null ? <div className="mt-2"><LoadingBlock rows={1} label="Loading members" /></div> : !members.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">No members have signed in to Scout yet.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {members.map((m) => {
                      const on = pickedMembers.has(m.accountId);
                      return (
                        <button key={m.accountId} type="button" aria-pressed={on} onClick={() => setPickedMembers((s) => toggle(s, m.accountId))}
                          className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
                            on ? "border-accent bg-accent text-accent-ink" : "border-border bg-card text-foreground hover:bg-muted")}>
                          {on && <Check className="size-4" />}{m.accountId === myAccountId ? `${m.name} (you)` : m.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
              <fieldset>
                <div className="flex items-end justify-between gap-2">
                  <legend className="text-sm font-medium">Teams{teams?.length ? ` · ${pickedTeams.size} of ${teams.length}` : ""}</legend>
                  {!!shownTeams.length && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPickedTeams((s) => {
                      const n = new Set(s);
                      for (const t of shownTeams) { if (allShown) n.delete(t.team); else n.add(t.team); }
                      return n;
                    })}>{allShown ? "Clear" : filter ? "Select shown" : "Select all"}</Button>
                  )}
                </div>
                {!eventCode ? <p className="mt-2 text-sm text-muted-foreground">Pick the event to see its teams.</p>
                  : teams == null ? <div className="mt-2"><LoadingBlock rows={3} label="Loading teams" /></div>
                    : !teams.length ? <p className="mt-2 text-sm text-muted-foreground">No team list for {eventCode} in {season} yet. It appears once the event's teams are published.</p>
                      : (
                        <>
                          <div className="relative mt-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by number or name" aria-label="Filter teams" className="h-11 pl-9" />
                          </div>
                          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border" aria-label="Teams at this event">
                            {shownTeams.map((t) => {
                              const on = pickedTeams.has(t.team);
                              const label = assignedLabel(index.get(assignmentKey(season, eventCode, t.team)) ?? [], myAccountId);
                              return (
                                <li key={t.team}>
                                  <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2", on && "bg-accent/10")}>
                                    <Checkbox checked={on} onCheckedChange={() => setPickedTeams((s) => toggle(s, t.team))} aria-label={`Team ${t.team}`} className="size-5" />
                                    <span className="w-14 shrink-0 font-mono font-medium">{t.team}</span>
                                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t.name ?? ""}</span>
                                    {label && <Badge variant="beta" className="max-w-[45%] truncate">{label}</Badge>}
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
              </fieldset>
            </>
          )}
        </div>
        {/* Outside the scrolling list, so it's in view on a phone as soon as a pick makes it true. */}
        {clashes.length > 0 && (
          <div role="status" className="mx-5 mt-3 flex max-h-40 items-start gap-2 overflow-y-auto rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">More than one scout on {clashes.length === 1 ? "a team" : "some teams"}</p>
              <ul className="mt-1 text-muted-foreground">
                {clashes.slice(0, 6).map((c) => <li key={c.team}><span className="font-mono">{c.team}</span>: {c.holders.join(", ")}</li>)}
                {clashes.length > 6 && <li>and {clashes.length - 6} more</li>}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">You can still assign them; this is just so it's on purpose.</p>
            </div>
          </div>
        )}
        <SheetFooter className="mt-3 border-t border-border px-5 py-4">
          <Button className="w-full sm:w-auto" onClick={submit} disabled={saving || !eventCode || !pickedTeams.size || !pickedMembers.size}>
            {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
            {pickedTeams.size && pickedMembers.size ? `Assign ${plural(pickedTeams.size, "team")} to ${plural(pickedMembers.size, "member")}` : "Assign"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
