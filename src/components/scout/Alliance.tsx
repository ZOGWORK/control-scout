// The Scout page's Alliance view (?view=alliance; docs/alliances.md): link this workspace with other teams' for one
// event. An admin starts an alliance (an invite code and link) or joins one; while linked every member sees each
// team's coverage in its own colour, one consensus over everyone's entries, the other teams' entries and assignments
// (read-only), and can switch the pick list to another team's. The team that started it invites more and removes
// teams; any team's admin can leave. Who may do what is the server's call (server/scout/alliances.ts); the buttons follow it.
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronDown, ClipboardList, Copy, Handshake, Link2, Loader2, LogOut, Plus, ThumbsUp, Unlink2, Users, X } from "lucide-react";
import { ApiError } from "../../lib/api";
import { agoShort, int } from "../../lib/format";
import {
  acceptAlliance, activeAlliance, allianceJoinLink, endAlliance, inviteAlliance, leaveAlliance, newAllianceCode, removeAllianceMember,
  useAlliances, useAllianceConsensus, useAlliancePicklist, useAllianceShared,
} from "../../lib/alliances";
import { formatInviteCode, normalInviteCode, type Alliance, type AllianceMember, type AllianceShared, type CoverageSide } from "../../shared/alliances";
import { matchRangeLabel } from "../../shared/assignments";
import { watchingLabel } from "../../shared/scoutMatch";
import type { TeamConsensus } from "../../shared/consensus";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { Badge, Input, Label } from "../ui/basic";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { toast } from "../ui/sonner";
import { Meter, StatTile, TONES, type Tone } from "../StatTile";
import { cn } from "../cn";
import { EventPicker } from "./EventPicker";

const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't reach the server. Try again.");
const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
/** "A", "A and B", "A, B and C" */
const names = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

// Each team's colour, everywhere in this view: this workspace is always the accent, the others follow in the order they joined.
const OTHER_TONES: Tone[] = ["sky", "violet", "emerald", "amber", "rose", "teal", "orange"];
type Tones = (workspaceId: string) => Tone;
function tonesFor(members: { workspaceId: string }[], you: string): Tones {
  const map = new Map<string, Tone>([[you, "accent"]]);
  for (const m of members) if (!map.has(m.workspaceId)) map.set(m.workspaceId, OTHER_TONES[(map.size - 1) % OTHER_TONES.length]);
  return (ws) => map.get(ws) ?? "sky";
}

export function AllianceView({ workspaceId, workspaceName, season, eventCode, isAdmin, readOnly }: {
  workspaceId: string; workspaceName: string; season: number;
  /** The scouting session's event: the invite form starts with it, and its alliance is shown first. */
  eventCode: string | null;
  isAdmin: boolean; readOnly: boolean;
}) {
  const st = useAlliances(workspaceId, season);
  const list = st.data?.alliances;
  const active = activeAlliance(list, eventCode);
  const pending = (list ?? []).filter((a) => a.status === "pending");
  const past = (list ?? []).filter((a) => a.status === "ended").slice(0, 5);
  const canManage = !!st.data?.canManage && isAdmin && !readOnly;
  // An invite link opens this view with ?join=CODE: the join form starts with it.
  const [sp] = useSearchParams();
  const joinCode = normalInviteCode(sp.get("join"));
  // The code just made: held here, above the forms (which hide once the alliance exists), until Done.
  const [code, setCode] = useState<{ code: string; until: number | null } | null>(null);
  return (
    <Section title="Scouting alliance"
      description={<>Share {workspaceName}'s scouting with other teams for one meet. Everyone in it sees each other's entries and assignments at that event and shares one consensus. Nobody joins another team, and each team's entries stay its own to edit. It ends by itself after the event.</>}>
      {st.loading ? <LoadingBlock rows={3} label="Loading alliances" /> : st.error ? <ErrorState error={st.error} onRetry={st.reload} /> : (
        <div className="space-y-6">
          {code && <NewCode code={code.code} until={code.until} onDone={() => setCode(null)} />}
          {active && <LinkedPanel workspaceId={workspaceId} alliance={active} canManage={canManage} onCode={setCode} />}
          {pending.map((a) => <PendingCard key={a.id} workspaceId={workspaceId} alliance={a} canManage={canManage} onCode={setCode} />)}
          {/* One alliance at a time on screen: the forms come back once it ends (or the invite is cancelled). */}
          {canManage ? !active && !pending.length && <LinkForms workspaceId={workspaceId} season={season} eventCode={eventCode} joinCode={joinCode} onCode={setCode} linkedEvents={[...(list ?? [])].filter((a) => a.status !== "ended").map((a) => a.eventCode)} />
            : !active && !pending.length && <EmptyState icon={Handshake} title="No alliance yet" description={readOnly ? "This workspace is read-only." : "An admin of this workspace can start an alliance with other teams at a meet, or join one with a code."} />}
          {past.length > 0 && <PastLinks list={past} />}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Linked: members, coverage, consensus, the other teams' entries and assignments
// ---------------------------------------------------------------------------

type OnCode = (c: { code: string; until: number | null }) => void;

function LinkedPanel({ workspaceId, alliance, canManage, onCode }: { workspaceId: string; alliance: Alliance; canManage: boolean; onCode: OnCode }) {
  const shared = useAllianceShared(workspaceId, alliance.id);
  const tone = useMemo(() => tonesFor(alliance.members, workspaceId), [alliance.members, workspaceId]);
  return (
    <div className="space-y-5" data-testid="alliance-linked">
      <LinkBanner workspaceId={workspaceId} alliance={alliance} canManage={canManage} tone={tone} onCode={onCode} />
      {shared.loading ? <LoadingBlock rows={3} label="Loading what the alliance shares" /> : shared.error ? <ErrorState error={shared.error} onRetry={shared.reload} /> : shared.data && (
        <>
          <Coverage data={shared.data} tone={tone} />
          <SharedConsensus workspaceId={workspaceId} data={shared.data} />
          <OtherEntries data={shared.data} you={workspaceId} tone={tone} />
          <AllAssignments data={shared.data} tone={tone} />
        </>
      )}
    </div>
  );
}

function SideName({ name, tone }: { name: string; tone: Tone }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5"><span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONES[tone].bar)} /><span className="truncate font-medium">{name}</span></span>;
}

function copiesLine(a: Alliance): string {
  if (a.copiesKept) return "Teams that agreed kept a copy of each other's entries.";
  const others = a.members.filter((m) => m.workspaceId !== a.you.workspaceId);
  if (!a.you.keepsCopies) return "You chose not to keep copies, so you keep only your own entries.";
  const keepers = others.filter((m) => m.keepsCopies);
  if (!keepers.length) return "No other team chose to keep copies, so each team keeps only its own entries.";
  if (keepers.length === others.length) return `When it ends, you keep a copy of ${others.length === 1 ? "the other team's" : "the other teams'"} entries.`;
  return `When it ends, you keep a copy of the entries from ${names(keepers.map((m) => m.name))}.`;
}

function LinkBanner({ workspaceId, alliance: a, canManage, tone, onCode }: { workspaceId: string; alliance: Alliance; canManage: boolean; tone: Tones; onCode: OnCode }) {
  const [confirming, setConfirming] = useState<"end" | "leave" | null>(null);
  const [busy, setBusy] = useState(false);
  const creator = a.you.creator;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast.success(done); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); setConfirming(null); }
  };
  const invite = async () => {
    setBusy(true);
    try { const r = await newAllianceCode(workspaceId, a.id); onCode({ code: r.code, until: r.alliance.inviteExpiresAt }); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-info/30 bg-gradient-to-br from-accent/[0.07] to-info/[0.07] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link2 aria-hidden className="size-5 shrink-0 text-info" />
        <p className="min-w-0 flex-1 text-base font-medium">{plural(a.members.length, "team")} linked</p>
        <Badge variant="beta">Linked</Badge>
      </div>
      <p className="mt-2 text-sm">{a.eventName ?? a.eventCode} <span className="text-muted-foreground">· {a.eventCode} · ends after {dateLabel(a.endsOn)}</span></p>
      <Members workspaceId={workspaceId} alliance={a} tone={tone} canRemove={canManage && creator} />
      <p className="mt-3 text-xs text-muted-foreground">{copiesLine(a)} Entries stay editable only in their own workspace.</p>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {confirming === "end" ? <>
            <Button size="sm" variant="destructive" onClick={() => act(() => endAlliance(workspaceId, a.id), "Alliance ended.")} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Unlink2 />} End for everyone</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>Keep linked</Button>
          </> : confirming === "leave" ? <>
            <Button size="sm" variant="destructive" onClick={() => act(() => leaveAlliance(workspaceId, a.id), "You left the alliance.")} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <LogOut />} Leave now</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>Stay</Button>
          </> : <>
            {creator && <Button size="sm" variant="outline" onClick={invite} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Invite a team</Button>}
            {creator && <Button size="sm" variant="outline" onClick={() => setConfirming("end")}><Unlink2 /> End</Button>}
            <Button size="sm" variant="outline" onClick={() => setConfirming("leave")}><LogOut /> Leave</Button>
          </>}
        </div>
      )}
      {creator && a.inviteExpiresAt && <p className="mt-2 text-xs text-muted-foreground">Your invite code works until {dayLabel(a.inviteExpiresAt)}.</p>}
    </div>
  );
}

/** Every team in it, in its colour. The team that started it can take another one out. */
function Members({ workspaceId, alliance: a, tone, canRemove }: { workspaceId: string; alliance: Alliance; tone: Tones; canRemove: boolean }) {
  const [removing, setRemoving] = useState<AllianceMember | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (m: AllianceMember) => {
    setBusy(true);
    try { await removeAllianceMember(workspaceId, a.id, m.workspaceId); toast.success(`Removed ${m.name}.`); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); setRemoving(null); }
  };
  return (
    <div className="mt-3">
      <ul aria-label="Teams in this alliance" className="flex flex-wrap gap-2">
        {a.members.map((m) => (
          <li key={m.workspaceId} className={cn("inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border px-2.5 text-sm", TONES[tone(m.workspaceId)].box)}>
            <SideName name={m.name} tone={tone(m.workspaceId)} />
            {(m.workspaceId === workspaceId || m.creator) && <span className="shrink-0 text-xs text-muted-foreground">{[m.workspaceId === workspaceId && "you", m.creator && "started it"].filter(Boolean).join(" · ")}</span>}
            {canRemove && m.workspaceId !== workspaceId && (
              <button type="button" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`} className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground">
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {removing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Remove {removing.name}? They stop seeing the alliance and keep no copies.</span>
          <Button size="sm" variant="destructive" onClick={() => remove(removing)} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Remove</Button>
          <Button size="sm" variant="outline" onClick={() => setRemoving(null)} disabled={busy}>Keep</Button>
        </div>
      )}
    </div>
  );
}

function sideHint(s: CoverageSide) {
  return `${plural(s.teams, "team")} · ${plural(s.matches, "match", "matches")} · ${plural(s.scouts, "scout")}`;
}

/** Each team's contribution, one card each in its colour, including a team that adds nothing: shown, never enforced. */
function Coverage({ data, tone }: { data: AllianceShared; tone: Tones }) {
  const { members, teams } = data.coverage;
  const total = members.reduce((n, m) => n + m.entries, 0);
  const idle = members.filter((m) => m.entries === 0).map((m) => m.name);
  const [all, setAll] = useState(false);
  const shown = all ? teams : teams.slice(0, 12);
  const most = Math.max(1, ...teams.map((t) => t.total));
  return (
    <div className="space-y-3" data-testid="alliance-coverage">
      <h3 className="text-sm font-semibold">Coverage</h3>
      <div className={cn("grid grid-cols-2 gap-3", members.length > 2 && "lg:grid-cols-3")}>
        {members.map((m) => (
          <StatTile key={m.workspaceId} tone={tone(m.workspaceId)} icon={ClipboardList} label={m.name} value={int(m.entries)} hint={sideHint(m)}
            bar={<Meter parts={[{ pc: total ? (m.entries / total) * 100 : 0, cls: TONES[tone(m.workspaceId)].bar }]} />} />
        ))}
      </div>
      {total > 0 && idle.length > 0 && (
        <p className="text-xs text-muted-foreground">{names(idle)} {idle.length === 1 ? "hasn't" : "haven't"} added any entries at this event yet.</p>
      )}
      {teams.length > 0 && (
        <ul aria-label="Entries per team" className="overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((t) => (
            <li key={t.team} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
              <span className="w-14 shrink-0 font-mono tabular-nums">{t.team}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.name ?? ""}</span>
              {t.total === 0 ? <span className="shrink-0 text-xs text-muted-foreground">Not scouted yet</span> : (
                <span className="flex w-36 shrink-0 items-center gap-2 max-sm:w-28"
                  aria-label={members.filter((m) => t.byMember[m.workspaceId]).map((m) => `${t.byMember[m.workspaceId]} by ${m.name}`).join(", ")}>
                  <span aria-hidden className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    {members.map((m) => t.byMember[m.workspaceId] ? <span key={m.workspaceId} className={TONES[tone(m.workspaceId)].bar} style={{ width: `${(t.byMember[m.workspaceId] / most) * 100}%` }} /> : null)}
                  </span>
                  <span aria-hidden className="w-6 text-right font-mono text-xs tabular-nums">{t.total}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {teams.length > 12 && <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${teams.length} teams`}</Button>}
    </div>
  );
}

const avg = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One consensus over every team's entries at the event, for the most scouted teams. */
function SharedConsensus({ workspaceId, data }: { workspaceId: string; data: AllianceShared }) {
  const teams = useMemo(() => data.coverage.teams.filter((t) => t.total > 0).slice(0, 12).map((t) => t.team), [data.coverage.teams]);
  const c = useAllianceConsensus(workspaceId, data.alliance.id, teams);
  if (!teams.length) return null;
  const teamNames = new Map(data.coverage.teams.map((t) => [t.team, t.name]));
  return (
    <div className="space-y-3" data-testid="alliance-consensus">
      <h3 className="text-sm font-semibold">Shared consensus</h3>
      <p className="-mt-2 text-xs text-muted-foreground">Every team's entries at this event, read together. Everyone in the alliance sees the same numbers.</p>
      {c.loading ? <LoadingBlock rows={2} label="Loading consensus" /> : c.error ? <ErrorState error={c.error} onRetry={c.reload} /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {c.data?.teams.map((t) => <ConsensusCard key={t.team} t={t} name={teamNames.get(t.team) ?? null} />)}
        </ul>
      )}
    </div>
  );
}

function ConsensusCard({ t, name }: { t: TeamConsensus; name: string | null }) {
  const top = t.ratings.slice(0, 2);
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-baseline gap-2"><span className="font-mono text-base font-semibold tabular-nums">{t.team}</span><span className="min-w-0 truncate text-sm text-muted-foreground">{name ?? ""}</span></p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Users aria-hidden className="size-3.5" />{plural(t.entries, "entry", "entries")} by {plural(t.scouts, "scout")}{t.lastUpdated ? ` · ${agoShort(t.lastUpdated)}` : ""}</p>
      {top.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {top.map((r) => (
            <div key={`${r.kind}:${r.id}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm"><dt className="min-w-0 truncate">{r.label}</dt><dd className="shrink-0 font-medium tabular-nums">{avg(r.avg)}<span className="text-xs font-normal text-muted-foreground"> / {r.max}</span></dd></div>
              <Meter parts={[{ pc: ((r.avg - 1) / ((r.max ?? 5) - 1)) * 100, cls: "bg-violet-500" }]} />
            </div>
          ))}
        </dl>
      )}
      {t.strengths.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs"><ThumbsUp aria-hidden className="size-3.5 text-success" />
          {t.strengths.slice(0, 3).map((s) => <span key={s.label} className="rounded-md border border-success/30 bg-success/[0.08] px-1.5 py-0.5">{s.label} ×{s.count}</span>)}
        </p>
      )}
    </li>
  );
}

/** The other teams' entries, each marked with its team's colour. Read-only. */
function OtherEntries({ data, you, tone }: { data: AllianceShared; you: string; tone: Tones }) {
  const theirs = data.entries.filter((e) => e.workspaceId !== you);
  const [all, setAll] = useState(false);
  const teamName = new Map(data.coverage.members.map((m) => [m.workspaceId, m.name]));
  const many = data.coverage.members.length > 2;
  if (!theirs.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {many ? "Other teams' entries" : <><SideName name={teamName.get(theirs[0].workspaceId) ?? ""} tone={tone(theirs[0].workspaceId)} /> entries</>}
        <span className="font-normal text-muted-foreground">· read-only</span>
      </h3>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {(all ? theirs : theirs.slice(0, 8)).map((e) => (
          <li key={e.uuid} className="border-b border-border text-sm last:border-b-0">
            {/* Tap for the answers, under the questions of that team's own template. Read-only. */}
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center px-3 py-2 hover:bg-text-base/[0.04] [&::-webkit-details-marker]:hidden">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span aria-label={teamName.get(e.workspaceId)} className={cn("size-2 shrink-0 self-center rounded-full", TONES[tone(e.workspaceId)].bar)} />
                  <span className="font-mono font-medium tabular-nums">{e.team}</span>
                  <span className="text-muted-foreground">{e.kind === "pit" ? "Pit" : e.matchLabel ?? "Match"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{e.authorDisplayName || "A scout"}{many ? ` (${teamName.get(e.workspaceId) ?? ""})` : ""} · {agoShort(e.updatedAt)}</span>
                  <ChevronDown aria-hidden className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-180" />
                </span>
                {e.notes && <span className="mt-0.5 line-clamp-2 break-words text-muted-foreground group-open:line-clamp-none">{e.notes}</span>}
              </summary>
              <div className="px-3 pb-3">
                {e.answers.length ? (
                  <dl className="grid gap-x-4 gap-y-1 rounded-lg bg-text-base/[0.03] p-2.5 sm:grid-cols-2" data-testid="partner-answers">
                    {e.answers.map((x, i) => (
                      <div key={i} className="flex min-w-0 items-baseline justify-between gap-3">
                        <dt className="min-w-0 text-muted-foreground">{x.label}</dt><dd className="shrink-0 text-right font-medium break-words">{x.text}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="text-xs text-muted-foreground">No answers, notes only.</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {theirs.length > 8 && <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${theirs.length}`}</Button>}
    </div>
  );
}

function AllAssignments({ data, tone }: { data: AllianceShared; tone: Tones }) {
  if (!data.assignments.length && !data.matchAssignments.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Assignments</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.coverage.members.map((side) => {
          const teams = data.assignments.filter((a) => a.workspaceId === side.workspaceId);
          const matches = data.matchAssignments.filter((a) => a.workspaceId === side.workspaceId);
          return (
            <div key={side.workspaceId} className="min-w-0 rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-sm"><SideName name={side.name} tone={tone(side.workspaceId)} /></p>
              {!teams.length && !matches.length ? <p className="text-xs text-muted-foreground">Nothing assigned yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {matches.map((m) => <li key={`m${m.id}`}>{m.assigneeName}: <span className="text-muted-foreground">{watchingLabel(m.watching)}, {matchRangeLabel(m.fromMatch, m.toMatch)}</span></li>)}
                  {teams.map((a) => (
                    <li key={`t${a.id}`} className="flex items-center gap-1.5">
                      {a.status === "done" && <Check aria-label="Done" className="size-3.5 text-success" />}
                      <span className="font-mono tabular-nums">{a.team}</span><span className="text-muted-foreground">{a.assigneeName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Start, join, pending, past
// ---------------------------------------------------------------------------

function CopiesBox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>Keep a copy of the other teams' entries when the event ends<span className="block text-xs text-muted-foreground">You get copies only from teams that tick this too.</span></span>
    </label>
  );
}

function LinkForms({ workspaceId, season, eventCode, linkedEvents, joinCode, onCode }: {
  workspaceId: string; season: number; eventCode: string | null; linkedEvents: string[]; joinCode: string | null; onCode: OnCode;
}) {
  const [mode, setMode] = useState<"invite" | "accept">(joinCode ? "accept" : "invite");
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "invite" | "accept")} aria-label="Start or join" className="mb-4">
        <ToggleGroupItem value="invite">Start an alliance</ToggleGroupItem>
        <ToggleGroupItem value="accept">I have a code</ToggleGroupItem>
      </ToggleGroup>
      {mode === "invite" ? <InviteForm workspaceId={workspaceId} season={season} eventCode={eventCode} linkedEvents={linkedEvents} onCode={onCode} /> : <AcceptForm workspaceId={workspaceId} initial={joinCode} />}
    </div>
  );
}

function InviteForm({ workspaceId, season, eventCode, linkedEvents, onCode }: { workspaceId: string; season: number; eventCode: string | null; linkedEvents: string[]; onCode: OnCode }) {
  const [event, setEvent] = useState(eventCode ?? "");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const taken = !!event && linkedEvents.includes(event.toUpperCase());
  const send = async () => {
    setBusy(true);
    try { const r = await inviteAlliance(workspaceId, season, event, keep); onCode({ code: r.code, until: r.alliance.inviteExpiresAt }); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="alliance-event">Event</Label><EventPicker id="alliance-event" season={season} code={event} onChange={setEvent} /></div>
      {taken && <p className="text-xs text-warning">This workspace is already in an alliance (or has an invite out) for this event.</p>}
      <CopiesBox id="alliance-keep-invite" checked={keep} onChange={setKeep} />
      <Button onClick={send} disabled={!event || taken || busy}>{busy ? <Loader2 className="animate-spin" /> : <Handshake />} Create invite code</Button>
    </div>
  );
}

function NewCode({ code, until, onDone }: { code: string; until: number | null; onDone: () => void }) {
  const shown = formatInviteCode(code);
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied.`), () => {}); };
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-card p-4" data-testid="alliance-code">
      <p className="text-sm">Send this code or link to each team's workspace admin. Any team can use it{until ? ` until ${dayLabel(until)}` : " for 7 days"}. It's shown only now.</p>
      <p className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg border border-accent/40 bg-accent/[0.08] px-4 py-2 font-mono text-2xl font-semibold tracking-widest">{shown}</span>
        <Button variant="outline" size="sm" onClick={() => copy(shown, "Code")}><Copy /> Copy code</Button>
        <Button variant="outline" size="sm" onClick={() => copy(allianceJoinLink(code), "Link")}><Link2 /> Copy link</Button>
      </p>
      <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
    </div>
  );
}

function AcceptForm({ workspaceId, initial }: { workspaceId: string; initial: string | null }) {
  const [text, setText] = useState(initial ? formatInviteCode(initial) : "");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const code = normalInviteCode(text);
  const accept = async () => {
    if (!code) return;
    setBusy(true);
    try {
      const r = await acceptAlliance(workspaceId, code, keep);
      const others = r.alliance.members.filter((m) => m.workspaceId !== workspaceId).map((m) => m.name);
      toast.success(others.length ? `Linked with ${names(others)}.` : "Joined the alliance.");
      setText("");
    }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="alliance-code">Invite code</Label>
        <Input id="alliance-code" value={text} onChange={(e) => setText(e.target.value)} placeholder="XXXXX-XXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="max-w-[14rem] font-mono uppercase tracking-widest" />
      </div>
      <CopiesBox id="alliance-keep-accept" checked={keep} onChange={setKeep} />
      <Button onClick={accept} disabled={!code || busy}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />} Join the alliance</Button>
    </div>
  );
}

function PendingCard({ workspaceId, alliance: a, canManage, onCode }: { workspaceId: string; alliance: Alliance; canManage: boolean; onCode: OnCode }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-warning/50 bg-warning/[0.06] p-4 text-sm">
      <Loader2 aria-hidden className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">Alliance started for <span className="font-medium">{a.eventName ?? a.eventCode}</span>. Waiting for a team to join{a.inviteExpiresAt ? ` (the code works until ${dayLabel(a.inviteExpiresAt)})` : ""}.</p>
      {canManage && <>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { const r = await newAllianceCode(workspaceId, a.id); onCode({ code: r.code, until: r.alliance.inviteExpiresAt }); })}>New code</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { await endAlliance(workspaceId, a.id); })}>Cancel</Button>
      </>}
    </div>
  );
}

const endedWhy: Record<string, string> = { event_over: "event ended", unlinked: "ended early", cancelled: "cancelled", expired: "nobody joined", left: "you left", removed: "removed" };

function PastLinks({ list }: { list: Alliance[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Earlier</h3>
      <ul className="space-y-1 text-sm">
        {list.map((a) => {
          const others = a.members.filter((m) => m.workspaceId !== a.you.workspaceId).map((m) => m.name);
          return (
            <li key={a.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
              <span className="text-foreground">{others.length ? names(others) : "No other team"}</span><span>· {a.eventName ?? a.eventCode}</span>
              <span>· {endedWhy[a.endedReason ?? ""] ?? "ended"}{a.copiesKept ? ", copies kept" : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The pick list's "View <team>'s" toggle
// ---------------------------------------------------------------------------

/**
 * Pick lists stay per workspace. While linked, a toggle above this workspace's list switches to another team's in the
 * alliance, read-only (the server sends only the teams at the event). Without an active alliance, just the list.
 */
export function PicklistWithPartner({ workspaceId, workspaceName, season, eventCode, enabled = true, children }: {
  workspaceId: string; workspaceName: string; season: number; eventCode: string | null;
  /** Scouting alliances on for this workspace (the owner's switch): off asks nothing and shows just the list. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const st = useAlliances(enabled ? workspaceId : null, season);
  const active = enabled ? activeAlliance(st.data?.alliances, eventCode) : null;
  const [which, setWhich] = useState<string>("ours");
  const others = active?.members.filter((m) => m.workspaceId !== workspaceId) ?? [];
  if (!active || !others.length) return <>{children}</>;
  const tone = tonesFor(active.members, workspaceId);
  const shown = others.find((m) => m.workspaceId === which);
  return (
    <div>
      <ToggleGroup type="single" value={shown ? which : "ours"} onValueChange={(v) => v && setWhich(v)} aria-label="Whose pick list" className="mb-4 flex-wrap">
        <ToggleGroupItem value="ours">{workspaceName}</ToggleGroupItem>
        {others.map((m) => (
          <ToggleGroupItem key={m.workspaceId} value={m.workspaceId}><span aria-hidden className={cn("size-2 rounded-full", TONES[tone(m.workspaceId)].bar)} /> View {m.name}'s</ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown ? <PartnerPicklist workspaceId={workspaceId} alliance={active} member={shown} /> : children}
    </div>
  );
}

function PartnerPicklist({ workspaceId, alliance, member }: { workspaceId: string; alliance: Alliance; member: AllianceMember }) {
  const st = useAlliancePicklist(workspaceId, alliance.id, member.workspaceId);
  const name = member.name;
  return (
    <Section title={`${name}'s pick list`} description={`Read-only: ${name}'s own list, the teams at ${alliance.eventName ?? alliance.eventCode}. Only ${name}'s members change it.`}>
      {st.loading ? <LoadingBlock rows={4} label={`Loading ${name}'s pick list`} /> : st.error ? <ErrorState error={st.error} onRetry={st.reload} />
        : st.data && !st.data.teamsKnown ? <EmptyState icon={ClipboardList} title="No team list for this event yet" description={`${name}'s picks show here once the event's teams are published, so only teams at this meet are ever shared.`} />
        : !st.data?.list.picks.length ? <EmptyState icon={ClipboardList} title={`${name} hasn't picked any teams at this event yet`} /> : (
          <ol className="overflow-hidden rounded-xl border border-border bg-card" data-testid="partner-picklist">
            {st.data.list.picks.map((p, i) => (
              <li key={p.team} className="flex min-h-12 items-start gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
                <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs tabular-nums text-info">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono font-medium tabular-nums">{p.team}</span>
                  {p.note && <span className="mt-0.5 block break-words text-muted-foreground">{p.note}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.addedBy.name}</span>
              </li>
            ))}
          </ol>
        )}
    </Section>
  );
}
