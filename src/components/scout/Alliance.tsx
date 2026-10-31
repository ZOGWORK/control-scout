// The Scout page's Alliance view (?view=alliance; docs/alliances.md): link this workspace with another team's for
// one event. Admins invite (a one-time code) or accept one; while linked every member sees both sides' coverage,
// one consensus over both sides' entries, the partner's entries and assignments (read-only), and can switch the
// pick list to the partner's. Who may do what is the server's call (server/scout/alliances.ts); the buttons follow it.
import { useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardList, Copy, Handshake, Link2, Loader2, ThumbsUp, Unlink2, Users } from "lucide-react";
import { ApiError } from "../../lib/api";
import { agoShort, int } from "../../lib/format";
import {
  acceptAlliance, activeAlliance, endAlliance, inviteAlliance, useAlliances, useAllianceConsensus, useAlliancePicklist, useAllianceShared,
} from "../../lib/alliances";
import { formatInviteCode, normalInviteCode, type Alliance, type AllianceShared, type CoverageSide } from "../../shared/alliances";
import { matchRangeLabel } from "../../shared/assignments";
import { watchingLabel } from "../../shared/scoutMatch";
import type { TeamConsensus } from "../../shared/consensus";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { Badge, Input, Label } from "../ui/basic";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { toast } from "../ui/sonner";
import { Meter, StatTile } from "../StatTile";
import { cn } from "../cn";
import { EventPicker } from "./EventPicker";

const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't reach the server. Try again.");
const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
// Your side and the partner's, everywhere in this view.
const YOU = { dot: "bg-accent", text: "text-accent-text", bar: "bg-accent" };
const THEM = { dot: "bg-info", text: "text-info", bar: "bg-info" };

export function AllianceView({ workspaceId, workspaceName, season, eventCode, isAdmin, readOnly }: {
  workspaceId: string; workspaceName: string; season: number;
  /** The scouting session's event: the invite form starts with it, and its link is shown first. */
  eventCode: string | null;
  isAdmin: boolean; readOnly: boolean;
}) {
  const st = useAlliances(workspaceId, season);
  const list = st.data?.alliances;
  const active = activeAlliance(list, eventCode);
  const pending = (list ?? []).filter((a) => a.status === "pending");
  const past = (list ?? []).filter((a) => a.status === "ended").slice(0, 5);
  const canManage = !!st.data?.canManage && isAdmin && !readOnly;
  return (
    <Section title="Scouting alliance"
      description={<>Share {workspaceName}'s scouting with another team for one meet. Both teams see each other's entries and assignments at that event and share one consensus; nobody joins the other team, and each side's entries stay its own to edit. The link ends by itself after the event.</>}>
      {st.loading ? <LoadingBlock rows={3} label="Loading alliances" /> : st.error ? <ErrorState error={st.error} onRetry={st.reload} /> : (
        <div className="space-y-6">
          {active && <LinkedPanel workspaceId={workspaceId} alliance={active} canManage={canManage} />}
          {pending.map((a) => <PendingCard key={a.id} workspaceId={workspaceId} alliance={a} canManage={canManage} />)}
          {/* One link at a time on screen: the forms come back once it ends (or the invite is cancelled). */}
          {canManage ? !active && !pending.length && <LinkForms workspaceId={workspaceId} season={season} eventCode={eventCode} linkedEvents={[...(list ?? [])].filter((a) => a.status !== "ended").map((a) => a.eventCode)} />
            : !active && !pending.length && <EmptyState icon={Handshake} title="No alliance yet" description={readOnly ? "This workspace is read-only." : "An admin of this workspace can invite another team to share scouting at a meet, or accept their invite."} />}
          {past.length > 0 && <PastLinks list={past} />}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Linked: coverage, consensus, the partner's entries and assignments
// ---------------------------------------------------------------------------

function LinkedPanel({ workspaceId, alliance, canManage }: { workspaceId: string; alliance: Alliance; canManage: boolean }) {
  const shared = useAllianceShared(workspaceId, alliance.id);
  return (
    <div className="space-y-5" data-testid="alliance-linked">
      <LinkBanner workspaceId={workspaceId} alliance={alliance} canManage={canManage} />
      {shared.loading ? <LoadingBlock rows={3} label="Loading what both sides share" /> : shared.error ? <ErrorState error={shared.error} onRetry={shared.reload} /> : shared.data && (
        <>
          <Coverage data={shared.data} />
          <SharedConsensus workspaceId={workspaceId} data={shared.data} />
          <PartnerEntries data={shared.data} />
          <BothAssignments data={shared.data} />
        </>
      )}
    </div>
  );
}

function SideName({ name, you }: { name: string; you: boolean }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5"><span aria-hidden className={cn("size-2 shrink-0 rounded-full", you ? YOU.dot : THEM.dot)} /><span className="truncate font-medium">{name}</span></span>;
}

function copiesLine(a: Alliance): string {
  if (a.copiesKept) return "Each side kept a copy of the other's entries.";
  const you = a.you.keepsCopies, them = a.partner?.keepsCopies;
  if (you && them) return "When it ends, each side keeps a copy of the other's entries.";
  if (them === false) return `${a.partner?.name ?? "The partner"} chose not to keep copies, so each side keeps only its own entries.`;
  if (you === false) return "You chose not to keep copies, so each side keeps only its own entries.";
  return "Each side keeps its own entries.";
}

function LinkBanner({ workspaceId, alliance: a, canManage }: { workspaceId: string; alliance: Alliance; canManage: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlink = async () => {
    setBusy(true);
    try { await endAlliance(workspaceId, a.id); toast.success(`Unlinked from ${a.partner?.name ?? "the partner"}.`); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); setConfirming(false); }
  };
  return (
    <div className="rounded-xl border border-info/30 bg-gradient-to-br from-accent/[0.07] to-info/[0.07] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link2 aria-hidden className="size-5 shrink-0 text-info" />
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <SideName name={a.you.name} you /><span className="text-muted-foreground">and</span><SideName name={a.partner?.name ?? ""} you={false} />
        </p>
        <Badge variant="beta">Linked</Badge>
      </div>
      <p className="mt-2 text-sm">{a.eventName ?? a.eventCode} <span className="text-muted-foreground">· {a.eventCode} · ends after {dateLabel(a.endsOn)}</span></p>
      <p className="mt-1 text-xs text-muted-foreground">{copiesLine(a)} Entries stay editable only in their own workspace.</p>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {confirming ? <>
            <Button size="sm" variant="destructive" onClick={unlink} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Unlink2 />} Unlink now</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Keep linked</Button>
          </> : <Button size="sm" variant="outline" onClick={() => setConfirming(true)}><Unlink2 /> Unlink</Button>}
        </div>
      )}
    </div>
  );
}

function sideHint(s: CoverageSide) {
  return `${plural(s.teams, "team")} · ${plural(s.matches, "match", "matches")} · ${plural(s.scouts, "scout")}`;
}

/** Each side's contribution, including a side that adds nothing: shown, never enforced. */
function Coverage({ data }: { data: AllianceShared }) {
  const { you, partner, teams } = data.coverage;
  const total = you.entries + partner.entries;
  const [all, setAll] = useState(false);
  const shown = all ? teams : teams.slice(0, 12);
  const most = Math.max(1, ...teams.map((t) => t.you + t.partner));
  return (
    <div className="space-y-3" data-testid="alliance-coverage">
      <h3 className="text-sm font-semibold">Coverage</h3>
      <div className="grid grid-cols-2 gap-3">
        <StatTile tone="accent" icon={ClipboardList} label={you.name} value={int(you.entries)} hint={sideHint(you)}
          bar={<Meter parts={[{ pc: total ? (you.entries / total) * 100 : 0, cls: YOU.bar }]} />} />
        <StatTile tone="sky" icon={ClipboardList} label={partner.name} value={int(partner.entries)} hint={sideHint(partner)}
          bar={<Meter parts={[{ pc: total ? (partner.entries / total) * 100 : 0, cls: THEM.bar }]} />} />
      </div>
      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {you.entries === 0 ? `${you.name} hasn't added any entries at this event yet.` : partner.entries === 0 ? `${partner.name} hasn't added any entries at this event yet.`
            : `${you.name} ${Math.round((you.entries / total) * 100)}% · ${partner.name} ${Math.round((partner.entries / total) * 100)}% of ${plural(total, "entry", "entries")}.`}
        </p>
      )}
      {teams.length > 0 && (
        <ul aria-label="Entries per team" className="overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((t) => (
            <li key={t.team} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
              <span className="w-14 shrink-0 font-mono tabular-nums">{t.team}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.name ?? ""}</span>
              {t.you + t.partner === 0 ? <span className="shrink-0 text-xs text-muted-foreground">Not scouted yet</span> : (
                <span className="flex w-36 shrink-0 items-center gap-2 max-sm:w-28" aria-label={`${t.you} by ${you.name}, ${t.partner} by ${partner.name}`}>
                  <span aria-hidden className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className={YOU.bar} style={{ width: `${(t.you / most) * 100}%` }} />
                    <span className={THEM.bar} style={{ width: `${(t.partner / most) * 100}%` }} />
                  </span>
                  <span aria-hidden className="w-12 text-right font-mono text-xs tabular-nums"><span className={YOU.text}>{t.you}</span>·<span className={THEM.text}>{t.partner}</span></span>
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

/** One consensus over both sides' entries at the event, for the most scouted teams. */
function SharedConsensus({ workspaceId, data }: { workspaceId: string; data: AllianceShared }) {
  const teams = useMemo(() => data.coverage.teams.filter((t) => t.you + t.partner > 0).slice(0, 12).map((t) => t.team), [data.coverage.teams]);
  const c = useAllianceConsensus(workspaceId, data.alliance.id, teams);
  if (!teams.length) return null;
  const names = new Map(data.coverage.teams.map((t) => [t.team, t.name]));
  return (
    <div className="space-y-3" data-testid="alliance-consensus">
      <h3 className="text-sm font-semibold">Shared consensus</h3>
      <p className="-mt-2 text-xs text-muted-foreground">Both sides' entries at this event, read together. Both workspaces see the same numbers.</p>
      {c.loading ? <LoadingBlock rows={2} label="Loading consensus" /> : c.error ? <ErrorState error={c.error} onRetry={c.reload} /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {c.data?.teams.map((t) => <ConsensusCard key={t.team} t={t} name={names.get(t.team) ?? null} />)}
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

function PartnerEntries({ data }: { data: AllianceShared }) {
  const theirs = data.entries.filter((e) => e.side === "partner");
  const [all, setAll] = useState(false);
  const name = data.coverage.partner.name;
  if (!theirs.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><SideName name={name} you={false} /> entries <span className="font-normal text-muted-foreground">· read-only</span></h3>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {(all ? theirs : theirs.slice(0, 8)).map((e) => (
          <li key={e.uuid} className="border-b border-border px-3 py-2 text-sm last:border-b-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-medium tabular-nums">{e.team}</span>
              <span className="text-muted-foreground">{e.kind === "pit" ? "Pit" : e.matchLabel ?? "Match"}</span>
              <span className="ml-auto text-xs text-muted-foreground">{e.authorDisplayName || "A scout"} · {agoShort(e.updatedAt)}</span>
            </p>
            {e.notes && <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{e.notes}</p>}
          </li>
        ))}
      </ul>
      {theirs.length > 8 && <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${theirs.length}`}</Button>}
    </div>
  );
}

function BothAssignments({ data }: { data: AllianceShared }) {
  if (!data.assignments.length && !data.matchAssignments.length) return null;
  const col = (side: "you" | "partner", name: string) => {
    const teams = data.assignments.filter((a) => a.side === side);
    const matches = data.matchAssignments.filter((a) => a.side === side);
    return (
      <div className="min-w-0 rounded-xl border border-border bg-card p-3">
        <p className="mb-2 text-sm"><SideName name={name} you={side === "you"} /></p>
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
  };
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Assignments</h3>
      <div className="grid gap-3 sm:grid-cols-2">{col("you", data.coverage.you.name)}{col("partner", data.coverage.partner.name)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite, accept, pending, past
// ---------------------------------------------------------------------------

function CopiesBox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>Keep a copy of the other side's entries when the event ends<span className="block text-xs text-muted-foreground">Copies are made only if both sides tick this.</span></span>
    </label>
  );
}

function LinkForms({ workspaceId, season, eventCode, linkedEvents }: { workspaceId: string; season: number; eventCode: string | null; linkedEvents: string[] }) {
  const [mode, setMode] = useState<"invite" | "accept">("invite");
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "invite" | "accept")} aria-label="Invite or accept" className="mb-4">
        <ToggleGroupItem value="invite">Invite a team</ToggleGroupItem>
        <ToggleGroupItem value="accept">I have a code</ToggleGroupItem>
      </ToggleGroup>
      {mode === "invite" ? <InviteForm workspaceId={workspaceId} season={season} eventCode={eventCode} linkedEvents={linkedEvents} /> : <AcceptForm workspaceId={workspaceId} />}
    </div>
  );
}

function InviteForm({ workspaceId, season, eventCode, linkedEvents }: { workspaceId: string; season: number; eventCode: string | null; linkedEvents: string[] }) {
  const [event, setEvent] = useState(eventCode ?? "");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const taken = !!event && linkedEvents.includes(event.toUpperCase());
  const send = async () => {
    setBusy(true);
    try { setCode((await inviteAlliance(workspaceId, season, event, keep)).code); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  if (code) return <NewCode code={code} onDone={() => setCode(null)} />;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="alliance-event">Event</Label><EventPicker id="alliance-event" season={season} code={event} onChange={setEvent} /></div>
      {taken && <p className="text-xs text-warning">This workspace already has a link or an invite for this event.</p>}
      <CopiesBox id="alliance-keep-invite" checked={keep} onChange={setKeep} />
      <Button onClick={send} disabled={!event || taken || busy}>{busy ? <Loader2 className="animate-spin" /> : <Handshake />} Create invite code</Button>
    </div>
  );
}

function NewCode({ code, onDone }: { code: string; onDone: () => void }) {
  const shown = formatInviteCode(code);
  const copy = () => { void navigator.clipboard?.writeText(shown).then(() => toast.success("Code copied."), () => {}); };
  return (
    <div className="space-y-3" data-testid="alliance-code">
      <p className="text-sm">Send this code to the other team's workspace admin. It works once, for 7 days, and is shown only now.</p>
      <p className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg border border-accent/40 bg-accent/[0.08] px-4 py-2 font-mono text-2xl font-semibold tracking-widest">{shown}</span>
        <Button variant="outline" size="sm" onClick={copy}><Copy /> Copy</Button>
      </p>
      <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
    </div>
  );
}

function AcceptForm({ workspaceId }: { workspaceId: string }) {
  const [text, setText] = useState("");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const code = normalInviteCode(text);
  const accept = async () => {
    if (!code) return;
    setBusy(true);
    try { const r = await acceptAlliance(workspaceId, code, keep); toast.success(`Linked with ${r.alliance.partner?.name ?? "the other workspace"}.`); setText(""); }
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
      <Button onClick={accept} disabled={!code || busy}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />} Accept and link</Button>
    </div>
  );
}

function PendingCard({ workspaceId, alliance: a, canManage }: { workspaceId: string; alliance: Alliance; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try { await endAlliance(workspaceId, a.id); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-warning/50 bg-warning/[0.06] p-4 text-sm">
      <Loader2 aria-hidden className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">Invite sent for <span className="font-medium">{a.eventName ?? a.eventCode}</span>. Waiting for the other admin to accept{a.inviteExpiresAt ? ` (the code works until ${new Date(a.inviteExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : ""}.</p>
      {canManage && <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>Cancel invite</Button>}
    </div>
  );
}

const endedWhy: Record<string, string> = { event_over: "event ended", unlinked: "unlinked", cancelled: "invite cancelled", expired: "invite expired" };

function PastLinks({ list }: { list: Alliance[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Earlier</h3>
      <ul className="space-y-1 text-sm">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
            <span className="text-foreground">{a.partner?.name ?? "No partner"}</span><span>· {a.eventName ?? a.eventCode}</span>
            <span>· {endedWhy[a.endedReason ?? ""] ?? "ended"}{a.copiesKept ? ", copies kept" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The pick list's "View partner's" toggle
// ---------------------------------------------------------------------------

/**
 * Pick lists stay per workspace. While linked, a toggle above this workspace's list switches to the partner's,
 * read-only (the server sends only the teams at the event). Without an active link, just the list.
 */
export function PicklistWithPartner({ workspaceId, workspaceName, season, eventCode, enabled = true, children }: {
  workspaceId: string; workspaceName: string; season: number; eventCode: string | null;
  /** Scouting alliances on for this workspace (the owner's switch): off asks nothing and shows just the list. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const st = useAlliances(enabled ? workspaceId : null, season);
  const active = enabled ? activeAlliance(st.data?.alliances, eventCode) : null;
  const [which, setWhich] = useState<"ours" | "partner">("ours");
  if (!active?.partner) return <>{children}</>;
  return (
    <div>
      <ToggleGroup type="single" value={which} onValueChange={(v) => v && setWhich(v as "ours" | "partner")} aria-label="Whose pick list" className="mb-4">
        <ToggleGroupItem value="ours">{workspaceName}</ToggleGroupItem>
        <ToggleGroupItem value="partner"><span aria-hidden className={cn("size-2 rounded-full", THEM.dot)} /> View {active.partner.name}'s</ToggleGroupItem>
      </ToggleGroup>
      {which === "ours" ? children : <PartnerPicklist workspaceId={workspaceId} alliance={active} />}
    </div>
  );
}

function PartnerPicklist({ workspaceId, alliance }: { workspaceId: string; alliance: Alliance }) {
  const st = useAlliancePicklist(workspaceId, alliance.id);
  const name = alliance.partner?.name ?? "The partner";
  return (
    <Section title={`${name}'s pick list`} description={`Read-only: ${name}'s own list, the teams at ${alliance.eventName ?? alliance.eventCode}. Only ${name}'s members change it.`}>
      {st.loading ? <LoadingBlock rows={4} label="Loading the partner's pick list" /> : st.error ? <ErrorState error={st.error} onRetry={st.reload} />
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
