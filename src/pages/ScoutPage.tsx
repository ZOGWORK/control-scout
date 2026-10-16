// Manual scouting: your own match and pit observations on top of public data.
// Offline-first: saved on this device the moment you press Save; synced to
// your account when signed in and online.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Cloud, CloudOff, Info, LayoutList, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { canDeleteScoutEntry, deleteScoutEntry, newScoutId, refusalMessage, SCOUT_REFUSED, type ScoutRefusal, saveScoutEntry, ScoutStorageError, usePendingScoutCounts, useScouting, type ScoutEntry, type ScoutSpace, type ScoutValue } from "../lib/scouting";
import { resolveTemplate, useEntryTemplate, useWorkspaceTemplate } from "../lib/scoutTemplates";
import { ALL_PHASES, phaseLabel, type WorkspaceTemplate } from "../shared/scoutTemplate";
import { ScoutFieldInput } from "../components/scout/ScoutFieldInput";
import { TemplateEditor } from "../components/scout/TemplateEditor";
import { useScoutSpaces, workspaceLabel } from "../lib/scoutSpace";
import { ScoutSpaceSwitcher } from "../components/ScoutSpaceSwitcher";
import { LoadingBlock } from "../components/states";
import { useScoutLive, type LiveMode } from "../lib/scoutLive";
import { EntryAttribution } from "../components/EntryAttribution";
import { EntryPhotos } from "../components/scout/EntryPhotos";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge, FieldError, Input, Textarea, Label } from "../components/ui/basic";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { TeamInput, lookupTeamName } from "../components/TeamInput";
import { teamError } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { Recordings } from "../components/MatchVideo";

export default function ScoutPage() {
  useTitle("Scout");
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const teamFilter = Number(sp.get("team")) || undefined;
  const { user, syncReady } = usePersonal();
  const spaces = useScoutSpaces();
  const { space, current: workspace } = spaces;
  const { entries, status, pendingCount, syncNow } = useScouting({ season, team: teamFilter }, syncReady, space);
  const live = useScoutLive(space, syncReady);
  const pending = usePendingScoutCounts();
  // The server ended this workspace's stream: access is gone, so back to Personal (with a notice).
  const { revoke } = spaces;
  useEffect(() => { if (live === "revoked" && space != null) revoke(space); }, [live, space, revoke]);
  const editing = sp.get("entry");
  const editEntry = entries.find((e) => e.uuid === editing) ?? null;
  const [formOpen, setFormOpen] = useState(!!teamFilter || !!editing);
  useEffect(() => { if (editing) setFormOpen(true); }, [editing]);
  // Another space's entry can't be edited here: switching closes an edit (a new entry stays open and saves to the new space).
  const selectSpace = (s: ScoutSpace) => { if (editing) setFormOpen(!!teamFilter); spaces.select(s); };
  // Your account and role in this workspace (Control Point's), for which entries you may delete. The server enforces it.
  const me = useMemo(() => {
    const cp = user?.controlPoint;
    return space == null || !cp ? null : { accountId: cp.accountId, role: cp.workspaces?.find((w) => w.id === space)?.role };
  }, [user, space]);
  // The workspace's template for this season (Personal: the built-in defaults). Admins edit it here (?view=template).
  const wt = useWorkspaceTemplate(space, season);
  const isAdmin = me?.role === "admin";
  const showTemplate = !!workspace && isAdmin && sp.get("view") === "template";
  const toggleTemplate = () => setSp((x) => { if (x.get("view") === "template") x.delete("view"); else x.set("view", "template"); return x; });
  useEffect(() => {
    const refused = (ev: Event) => { const r = (ev as CustomEvent<ScoutRefusal>).detail; if (r.space === space) toast.error(refusalMessage(r)); };
    window.addEventListener(SCOUT_REFUSED, refused);
    return () => window.removeEventListener(SCOUT_REFUSED, refused);
  }, [space]);
  return (
    <div>
      <PageHeader title="Scout"
        description={workspace ? `Shared with everyone in ${workspaceLabel(workspace)}. Saved on this device instantly; the workspace sees new entries as they sync.`
          : "Your own observations — private to you. Saved on this device instantly; synced to your account when you're signed in."}
        actions={spaces.resolving ? undefined : <SyncChip status={status} pending={pendingCount} onSync={syncNow} signedIn={!!user} live={live} />}>
        {spaces.switchable && <ScoutSpaceSwitcher workspaces={spaces.workspaces} space={space} pending={pending} onSelect={selectSpace} className="mb-4" />}
        {spaces.notice && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1">{spaces.notice}</p>
            <button type="button" onClick={spaces.dismissNotice} aria-label="Dismiss" className="-m-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; })} />
          {teamFilter && <Badge variant="soft">Team {teamFilter} <button onClick={() => setSp((x) => { x.delete("team"); return x; })} aria-label="Clear team filter" className="ml-1">×</button></Badge>}
          {!formOpen && <Button onClick={() => setFormOpen(true)}><Plus /> New entry</Button>}
          {workspace && isAdmin && !spaces.resolving && (
            <Button variant="outline" aria-pressed={showTemplate} onClick={toggleTemplate}><LayoutList /> Template</Button>
          )}
        </div>
      </PageHeader>
      {showTemplate && workspace && (
        <TemplateEditor key={`${workspace.id}:${season}`} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} template={wt.template} onClose={toggleTemplate} />
      )}
      {formOpen && !spaces.resolving && (
        <EntryForm key={editEntry?.uuid ?? `new-${teamFilter ?? ""}`} season={season} initial={editEntry} team={teamFilter} space={space} spaceName={workspace ? workspaceLabel(workspace) : null} workspaceTemplate={wt.template}
          onDone={() => { setFormOpen(false); setSp((x) => { x.delete("entry"); return x; }); }} />
      )}
      <Section title={`Entries (${entries.length})`} description={teamFilter ? `For team ${teamFilter}` : "Newest first"}>
        {spaces.resolving ? <LoadingBlock rows={3} label="Loading scout space" /> : !entries.length ? <EmptyState icon={ClipboardList} title="No scouting entries yet" description="Start one above, or from any team page. Entries save on this device first, so scouting works with no signal." /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {entries.map((e) => <EntryCard key={e.uuid} e={e} canDelete={canDeleteScoutEntry(e, me)} onEdit={() => setSp((x) => { x.set("entry", e.uuid); return x; })} />)}
          </ul>
        )}
      </Section>
      <Section title="Match recordings" description="Videos you recorded in the app stay on this device only — they're never uploaded. YouTube links you add sync with your account.">
        <Recordings />
      </Section>
    </div>
  );
}

function SyncChip({ status, pending, onSync, signedIn, live }: { status: string; pending: number; onSync: () => void; signedIn: boolean; live: LiveMode }) {
  if (!signedIn) return <Badge variant="secondary"><CloudOff /> On this device only</Badge>;
  const synced = status !== "syncing" && status !== "offline" && status !== "error" && !pending;
  return (
    <button onClick={onSync} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
      {status === "syncing" ? <Loader2 className="size-3.5 animate-spin" /> : status === "offline" || status === "error" ? <CloudOff className="size-3.5 text-warning" /> : <Cloud className="size-3.5 text-success" />}
      {status === "syncing" ? "Syncing…" : status === "offline" ? `Offline — ${pending} pending` : status === "error" ? `Sync failed — ${pending} pending · retry` : pending ? `${pending} pending` : "Synced"}
      {synced && live === "live" && <span className="inline-flex items-center gap-1 text-success"><span aria-hidden className="size-1.5 rounded-full bg-success" />Live</span>}
      {synced && live === "polling" && <span>· checks every 15 s</span>}
    </button>
  );
}

function EntryCard({ e, canDelete, onEdit }: { e: ScoutEntry; canDelete: boolean; onEdit: () => void }) {
  // The fields it was made with (an older template version stays readable after the admin changes it).
  const t = useEntryTemplate(e);
  const shown = t.fields.filter((f) => e.data[f.id] !== undefined && e.data[f.id] !== false && e.data[f.id] !== 0 && e.data[f.id] !== "").slice(0, 5);
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium"><Link to={`/teams/${e.team}?season=${e.season}`} className="font-mono hover:underline">{e.team}</Link> · {e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`}</p>
          {e.workspaceId == null ? <p className="text-xs text-muted-foreground">{e.eventCode ?? "No event"} · {new Date(e.updatedAt).toLocaleString()}</p> : (
            <>
              <p className="text-xs text-muted-foreground">{e.eventCode ?? "No event"}</p>
              <EntryAttribution e={e} className="mt-0.5" />
            </>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
          {canDelete && <Button variant="ghost" size="icon-sm" aria-label="Delete entry" onClick={() => { deleteScoutEntry(e); toast("Entry deleted"); }}><Trash2 /></Button>}
        </div>
      </div>
      {shown.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{shown.map((f) => <Badge key={f.id} variant="secondary">{f.label}: {String(e.data[f.id] === true ? "yes" : e.data[f.id])}</Badge>)}</div>}
      {e.notes && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{e.notes}</p>}
      <EntryPhotos entry={e} className="mt-3" />
    </li>
  );
}

function EntryForm({ season, initial, team, space, spaceName, workspaceTemplate, onDone }: {
  season: number; initial: ScoutEntry | null; team?: number; space: ScoutSpace; spaceName: string | null;
  /** The workspace's current template (null: Personal, or not known yet: the built-in defaults). */
  workspaceTemplate: WorkspaceTemplate | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"match" | "pit">(initial?.kind ?? "match");
  const [teamText, setTeamText] = useState(initial ? String(initial.team) : team ? String(team) : "");
  const [eventCode, setEventCode] = useState(initial?.eventCode ?? "");
  const [matchLabel, setMatchLabel] = useState(initial?.matchLabel ?? "");
  const [data, setData] = useState<Record<string, ScoutValue>>(initial?.data ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // An edit keeps the template the entry was made with; a new entry (or a switch to the other kind)
  // uses the space's current one: the workspace's, or the built-in defaults (Personal, never customised).
  const entryTemplate = useEntryTemplate(initial ?? { season, kind, templateId: undefined, templateVersion: undefined });
  const template = useMemo(() => (initial && kind === initial.kind ? entryTemplate : resolveTemplate(space == null ? null : workspaceTemplate, season, kind)),
    [initial, kind, entryTemplate, space, workspaceTemplate, season]);
  const phases = ALL_PHASES;
  // Inline errors: the team field's own, and one for the save itself (storage full or blocked).
  const [teamErr, setTeamErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const teamRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const saveErrId = useId();
  // The team check awaits a lookup: by then the form may be cancelled (closed) or still being
  // edited. A closed form saves nothing; an open one saves what it holds now, if the team is unchanged.
  const latest = useRef({ kind, teamText, eventCode, matchLabel, data, notes, space, template });
  latest.current = { kind, teamText, eventCode, matchLabel, data, notes, space, template };
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  const save = async () => {
    setSaveErr(null);
    setChecking(true);
    const team = teamText;
    const err = await teamError(team, lookupTeamName);
    if (!open.current) return;
    setChecking(false);
    if (latest.current.teamText !== team) return; // edited while checking: the next Save checks the new number
    if (latest.current.space !== space) return; // switched spaces while checking: the next Save goes to the space now shown
    if (err) { setTeamErr(err); teamRef.current?.focus(); return; }
    const { kind, eventCode, matchLabel, data: all, notes, template } = latest.current;
    // A new entry keeps only the template's fields (a kind switch or a template change can leave others behind);
    // an edit keeps everything it had.
    const ids = new Set(template.fields.map((f) => f.id));
    const data = initial ? all : Object.fromEntries(Object.entries(all).filter(([k]) => ids.has(k)));
    // Workspace entries record the template they were made with; Personal ones always use the built-in defaults.
    const made = space == null ? {} : { templateId: template.id, templateVersion: template.version ?? 0 };
    try {
      saveScoutEntry({ uuid: initial?.uuid ?? newScoutId(), season, team: Number(team), eventCode: eventCode.trim().toUpperCase() || null, matchLabel: kind === "match" ? matchLabel.trim().toUpperCase() || null : null, kind, data, notes, workspaceId: space, ...made });
      toast.success("Saved on this device");
      onDone();
    } catch (e) {
      setSaveErr(e instanceof ScoutStorageError ? e.message : "Couldn't save this entry on this device. Try again.");
      saveRef.current?.focus();
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate className="mb-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <ToggleGroup type="single" value={kind} onValueChange={(v) => { if (v) setKind(v as typeof kind); }} aria-label="Entry type">
          <ToggleGroupItem value="match">Match</ToggleGroupItem><ToggleGroupItem value="pit">Pit</ToggleGroupItem>
        </ToggleGroup>
        <div className={teamErr ? "w-56" : "w-32"}><TeamInput label="Team" value={teamText} onChange={(v) => { setTeamText(v); setTeamErr(null); }} error={teamErr} inputRef={teamRef} /></div>
        <div className="w-36"><Input value={eventCode} onChange={(e) => setEventCode(e.target.value)} placeholder="Event code" aria-label="Event code" className="h-11 font-mono uppercase" /></div>
        {kind === "match" && <div className="w-24"><Input value={matchLabel} onChange={(e) => setMatchLabel(e.target.value)} placeholder="Q12" aria-label="Match" className="h-11 font-mono uppercase" /></div>}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {phases.map((ph) => {
          const fields = template.fields.filter((f) => f.phase === ph);
          if (!fields.length) return null;
          return (
            <fieldset key={ph} className="min-w-0 rounded-xl border border-border p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{phaseLabel(ph)}</legend>
              <div className="space-y-3">{fields.map((f) => <ScoutFieldInput key={f.id} f={f} value={data[f.id]} onChange={(v) => setData((d) => ({ ...d, [f.id]: v }))} />)}</div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What stood out? Strategy, reliability, driver habits…" className="mt-2" />
      </div>
      {initial && <EntryPhotos entry={initial} editable className="mt-5" />}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button ref={saveRef} type="submit" disabled={checking} aria-describedby={saveErr ? saveErrId : undefined}><Save /> Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <p className="ml-auto self-center text-xs text-muted-foreground">{spaceName ? <>Saves to <span className="font-medium text-foreground">{spaceName}</span>, shared with the workspace. </> : null}Saved on this device first — works without a connection.</p>
      </div>
      <FieldError id={saveErrId}>{saveErr}</FieldError>
    </form>
  );
}
