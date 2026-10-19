// Manual scouting: your own match and pit observations on top of public data.
// Offline-first: saved on this device the moment you press Save; synced to
// your account when signed in and online.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardCheck, ClipboardList, Cloud, CloudOff, Download, History, Info, LayoutList, ListOrdered, Loader2, Lock, MessageSquare, Plus, Save, SearchX, Trash2, X } from "lucide-react";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { canDeleteScoutEntry, deleteScoutEntry, localScoutEntries, newScoutId, personalCopy, scoutDraftBase, refusalMessage, SCOUT_REFUSED, type ScoutRefusal, saveScoutEntry, ScoutStorageError, usePendingScoutCounts, useScouting, type ScoutEntry, type ScoutSpace, type ScoutValue } from "../lib/scouting";
import { resolveTemplate, useEntryTemplate, useEntryTemplateState, useWorkspaceTemplate } from "../lib/scoutTemplates";
import { ALL_PHASES, phaseLabel, type WorkspaceTemplate } from "../shared/scoutTemplate";
import { orphanBanner, type OrphanState } from "../shared/orphaned";
import { workspaceExportUrl } from "../shared/scoutExport";
import { activeFilterCount } from "../shared/scoutFilter";
import { EntryFilterBar } from "../components/scout/EntryFilterBar";
import { useEntryFeed, type FeedViewer } from "../lib/scoutFeed";
import { qs, useApi } from "../lib/api";
import type { EventListItem } from "../shared/api";
import { ScoutFieldInput } from "../components/scout/ScoutFieldInput";
import { TemplateEditor } from "../components/scout/TemplateEditor";
import { useScoutSpaces, workspaceLabel } from "../lib/scoutSpace";
import { newEntryEventCode, useWorkspaceSettings } from "../lib/workspaceSettings";
import { ScoutSpaceSwitcher } from "../components/ScoutSpaceSwitcher";
import { LoadingBlock } from "../components/states";
import { useScoutLive, type LiveMode } from "../lib/scoutLive";
import { EntryAttribution } from "../components/EntryAttribution";
import { EntryPhotos } from "../components/scout/EntryPhotos";
import { ActivityFeed } from "../components/scout/ActivityFeed";
import { ConflictNotices, HistorySheet } from "../components/scout/EntryHistory";
import { LOST_UNSAVED_MESSAGE, SCOUT_LOST_UNSAVED } from "../lib/lostEdits";
import { EntryComments } from "../components/scout/EntryComments";
import { announceCommentsResync, useCommentCounts } from "../lib/scoutComments";
import { useWorkspaceActivity } from "../lib/scoutActivity";
import { SharedPicklist } from "../components/scout/SharedPicklist";
import { announcePicklistResync } from "../lib/sharedPicklist";
import { AssignmentsView } from "../components/scout/Assignments";
import { assignedLabel, useAssignmentIndex, useAssignments } from "../lib/assignments";
import { assignmentKey } from "../shared/assignments";
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
  // One team in the filter (a link from a team page, or picked in the filter bar): a new entry starts with it.
  const teamFilter = /^\d+$/.test(sp.get("team") ?? "") ? Number(sp.get("team")) || undefined : undefined;
  const { user, syncReady, offlineAccount, refreshUser, state: personal } = usePersonal();
  const spaces = useScoutSpaces();
  const { space, current: workspace } = spaces;
  // Read-only (Task 19): the workspace was deleted in Control Point, or has no admin left. Everything reads
  // and exports; nothing can be added, edited, deleted or commented on (the server refuses it too, 423).
  const readOnly = workspace?.orphaned ?? null;
  // The workspace's shared settings (Tier 2, docs/settings.md): its default season and event for this space.
  // A season in the URL wins; Personal is unchanged (the current season, no event).
  const wss = useWorkspaceSettings(space);
  const urlSeason = Number(sp.get("season")) || 0;
  // Applied when the space opens: the first settings known for it fix its season for this visit,
  // so a later change to the default never moves the page (or an open form) under the member.
  const [opened, setOpened] = useState<{ space: string; season: number } | null>(null);
  const openedSeason = opened && opened.space === space ? opened.season : null;
  const season = urlSeason || openedSeason || (space != null && wss.defaults.season) || current;
  const settingsKnown = space != null && wss.settings != null;
  // Leaving the space ends the visit: coming back applies the default as it is then.
  useEffect(() => {
    if (settingsKnown && space != null && openedSeason == null) setOpened({ space, season });
    else if (space == null) setOpened(null);
  }, [settingsKnown, space, openedSeason, season]);
  const { entries, status, pendingCount, syncNow } = useScouting({ season }, syncReady, space);
  // The switcher's manual refresh (rarely needed: the stream keeps the list live) reopens the stream with a new generation.
  const [liveGeneration, setLiveGeneration] = useState(0);
  const live = useScoutLive(space, syncReady, liveGeneration);
  const refreshSpace = useCallback(async () => {
    const [synced] = await Promise.all([syncNow(), refreshUser?.()]);
    setLiveGeneration((g) => g + 1);
    // Open comment threads, the card counts and the assignments refetch too (the new stream does again once it is ready).
    if (space != null) { announceCommentsResync(space); reloadAssignments.current(); announcePicklistResync(space); }
    return synced;
  }, [syncNow, refreshUser, space]);
  // How many comments each workspace entry has (Task 15), for the cards; live with the stream.
  const commentCounts = useCommentCounts(syncReady ? space : null);
  const pending = usePendingScoutCounts();
  // The server ended this workspace's stream: access is gone, so back to Personal (with a notice).
  const { revoke } = spaces;
  useEffect(() => { if (live === "revoked" && space != null) revoke(space); }, [live, space, revoke]);
  const editing = sp.get("entry");
  const editEntry = entries.find((e) => e.uuid === editing) ?? null;
  // "Scout this team" (a team page) links here with ?new=1: the form opens with that team. A filtered link alone doesn't open it.
  const opensNew = sp.get("new") === "1";
  const [formOpen, setFormOpen] = useState(opensNew || !!editing);
  // The team a new entry starts with: fixed when the form opens, so filtering while it's open never resets it.
  const [formTeam, setFormTeam] = useState(opensNew ? teamFilter : undefined);
  // Each New entry or Scout starts a fresh form (its own key): never the draft of an earlier one.
  const [formNonce, setFormNonce] = useState(0);
  const openNew = () => { setFormTeam(teamFilter); setFormEvent(null); setFormNonce((n) => n + 1); setFormOpen(true); };
  useEffect(() => { if (editing) setFormOpen(true); }, [editing]);
  // Another space's entry can't be edited here: switching closes an edit (a new entry stays open and saves to the new space).
  // Authors are a workspace's own, so the author filter doesn't carry over.
  // (Cleared once the switch is in the URL: two URL writes in one go would drop one.)
  const switching = useRef<{ to: ScoutSpace } | null>(null);
  const selectSpace = (s: ScoutSpace) => {
    if (editing) setFormOpen(false);
    switching.current = s !== space ? { to: s } : null;
    spaces.select(s);
  };
  useEffect(() => {
    if (!switching.current || switching.current.to !== space) return;
    switching.current = null;
    if (sp.has("author")) setSp((x) => { x.delete("author"); return x; }, { replace: true });
  }, [space, sp, setSp]);
  // Your account and role in this workspace (Control Point's), for which entries you may delete. The server enforces it.
  const me = useMemo(() => {
    const cp = user?.controlPoint;
    return space == null || !cp ? null : { accountId: cp.accountId, role: cp.workspaces?.find((w) => w.id === space)?.role };
  }, [user, space]);
  // The feed: the space's entries filtered and sorted as the URL says (Task 17; the export applies the same filters).
  const viewer = useMemo<FeedViewer | null>(() => (me?.accountId ? { accountId: me.accountId, displayName: user?.displayName ?? "" } : null), [me, user?.displayName]);
  const [wantEvents, setWantEvents] = useState(false);
  const hasEvents = entries.some((e) => e.eventCode);
  const eventList = useApi<{ events: EventListItem[] }>(wantEvents && hasEvents ? `/api/events${qs({ season })}` : null);
  const eventNames = useMemo(() => new Map((eventList.data?.events ?? []).map((e) => [e.code.toUpperCase(), e.name])), [eventList.data]);
  const feed = useEntryFeed(entries, sp, setSp, { workspace: space != null, me: viewer, eventNames });
  // A filter the export would refuse (a hand-edited link): dropped, so the feed and the export always agree.
  const invalidFilters = feed.invalid.join();
  useEffect(() => {
    if (invalidFilters) setSp((x) => { for (const k of invalidFilters.split(",")) x.delete(k); return x; }, { replace: true });
  }, [invalidFilters, setSp]);
  const filtering = activeFilterCount(feed.filters) > 0;
  // The workspace's template for this season (Personal: the built-in defaults). Admins edit it here (?view=template).
  const wt = useWorkspaceTemplate(space, season);
  const isAdmin = me?.role === "admin" && !readOnly;
  const showTemplate = !!workspace && isAdmin && sp.get("view") === "template";
  // Every form that opens (New entry, an edit, or one opened from the URL) checks for a newer template first:
  // the live notice can be missed (realtime off, or a reconnect gap), and polling only pulls entries.
  const refreshTemplate = wt.refresh;
  const refreshSettings = wss.refresh;
  useEffect(() => { if (formOpen) { refreshTemplate(); refreshSettings(); } }, [formOpen, editing, refreshTemplate, refreshSettings]);
  // A workspace whose template this device has never seen: hold the form until the first answer (offline: the built-in fields).
  const templatePending = space != null && !wt.template && wt.status === "loading";
  const toggleTemplate = () => setSp((x) => { if (x.get("view") === "template") x.delete("view"); else x.set("view", "template"); return x; });
  // The workspace's activity feed (?view=activity): every member sees it, in place of the entry list.
  const showActivity = !!workspace && !spaces.resolving && sp.get("view") === "activity";
  const activity = useWorkspaceActivity(showActivity ? space : null, live);
  const toggleActivity = () => setSp((x) => { if (x.get("view") === "activity") x.delete("view"); else x.set("view", "activity"); return x; });
  // The workspace's shared pick list (?view=picklist, Task 11): every member sees and edits it, in place of the entry list.
  const showPicklist = !!workspace && !spaces.resolving && sp.get("view") === "picklist";
  const togglePicklist = () => setSp((x) => { if (x.get("view") === "picklist") x.delete("view"); else x.set("view", "picklist"); return x; });
  const pickMe = useMemo(() => ({ accountId: user?.controlPoint?.accountId ?? null, name: user?.displayName?.trim() || "You" }), [user]);
  // Scouting assignments (Task 10, ?view=assignments): loaded for the whole space, for the view and the badges.
  const assignments = useAssignments(workspace && !spaces.resolving ? space : null, season, live);
  const assignIndex = useAssignmentIndex(assignments.list);
  // Progress is the server's count of each assignee's entries: once entries change (added, edited, deleted,
  // moved; here or live from others) and this device's writes have synced, ask again, so a deleted or moved
  // entry stops counting. Debounced: a burst of changes makes one request.
  const reloadAssignments = useRef(assignments.reload);
  reloadAssignments.current = assignments.reload;
  const hasAssignments = useRef(false);
  hasAssignments.current = assignments.list.length > 0;
  const firstEntries = useRef(true);
  useEffect(() => {
    if (firstEntries.current) { firstEntries.current = false; return; }
    if (!hasAssignments.current || status === "syncing") return;
    const t = setTimeout(() => reloadAssignments.current(), 2000);
    return () => clearTimeout(t);
  }, [entries, status]);
  const showAssignments = !!workspace && !spaces.resolving && sp.get("view") === "assignments";
  const myOpen = workspace && me ? assignments.list.filter((a) => a.assigneeAccountId === me.accountId && a.status === "open").length : 0;
  const toggleAssignments = () => setSp((x) => { if (x.get("view") === "assignments") x.delete("view"); else x.set("view", "assignments"); return x; });
  // Scout an assigned team: the list filtered to that team at that event, and a new entry for it there.
  // The event of the assignment Scout was tapped on: only for that space and season (a switch falls back to the defaults).
  const [formEvent, setFormEvent] = useState<{ space: ScoutSpace; season: number; code: string } | null>(null);
  const scoutAssigned = (team: number, eventCode: string) => {
    setSp((x) => { x.delete("view"); x.delete("entry"); x.set("team", String(team)); x.set("event", eventCode); return x; });
    setFormTeam(team); setFormEvent({ space, season, code: eventCode }); setFormNonce((n) => n + 1); setFormOpen(true);
  };
  const badgeFor = (team: number, eventCode: string | null) => (workspace && eventCode ? assignedLabel(assignIndex.get(assignmentKey(season, eventCode, team)) ?? [], me?.accountId) : null);
  // Tapping an item about an entry opens it (in its season), if this device has it and it wasn't deleted since.
  const openEntry = (uuid: string) => {
    const e = space == null ? null : localScoutEntries(space).find((x) => x.uuid === uuid);
    if (!e) { toast("That entry hasn't synced to this device yet."); return; }
    // A deleted entry opens its History (Task 16): its versions, and any edit of yours it overwrote, to restore.
    if (e.deleted) { setHistoryFor(uuid); return; }
    setSp((x) => { x.delete("view"); x.delete("team"); x.set("season", String(e.season)); x.set("entry", uuid); return x; });
  };
  // The entry whose History sheet is open (Task 16): looked up on the device, so it stays open if the entry is deleted meanwhile.
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  useEffect(() => { setHistoryFor(null); }, [space]);
  const historyEntry = historyFor && space != null ? entries.find((e) => e.uuid === historyFor) ?? localScoutEntries(space).find((e) => e.uuid === historyFor) ?? null : null;
  useEffect(() => {
    const unsaved = (ev: Event) => { if ((ev as CustomEvent<string>).detail === space) toast.error(LOST_UNSAVED_MESSAGE, { id: "cs-lost-unsaved" }); };
    window.addEventListener(SCOUT_LOST_UNSAVED, unsaved);
    return () => window.removeEventListener(SCOUT_LOST_UNSAVED, unsaved);
  }, [space]);
  useEffect(() => {
    const refused = (ev: Event) => { const r = (ev as CustomEvent<ScoutRefusal>).detail; if (r.space === space) toast.error(refusalMessage(r)); };
    window.addEventListener(SCOUT_REFUSED, refused);
    return () => window.removeEventListener(SCOUT_REFUSED, refused);
  }, [space]);
  return (
    <div>
      <PageHeader title="Scout"
        description={workspace && readOnly ? `Shared with everyone who was in ${workspaceLabel(workspace)}. Read-only: everything here can be read and exported.`
          : workspace ? `Shared with everyone in ${workspaceLabel(workspace)}. New entries are kept on this device right away and reach the workspace when they sync; pick list changes and comments are saved once the workspace confirms them.`
          : "Your own observations — private to you. Saved on this device instantly; synced to your account when you're signed in."}
        actions={spaces.resolving ? undefined : <SyncChip status={offlineAccount ? "offline" : status} pending={pendingCount} onSync={syncNow} signedIn={!!user} live={live} />}>
        {spaces.switchable && <ScoutSpaceSwitcher workspaces={spaces.workspaces} space={space} pending={pending} onSelect={selectSpace} onRefresh={syncReady ? refreshSpace : undefined} className="mb-4" />}
        {/* Edits this device lost to newer ones from other members (Task 16): each until dismissed, with its diff. */}
        {space != null && !spaces.resolving && <ConflictNotices space={space} me={me && { ...me, readOnly: !!readOnly }} />}
        {spaces.notice && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1">{spaces.notice}</p>
            <button type="button" onClick={spaces.dismissNotice} aria-label="Dismiss" className="-m-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          </div>
        )}
        {readOnly && !spaces.resolving && <ReadOnlyBanner state={readOnly} />}
        <div className="flex flex-wrap items-center gap-3">
          <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; })} />
          {!formOpen && !readOnly && <Button onClick={openNew}><Plus /> New entry</Button>}
          {workspace && !spaces.resolving && (
            <Button variant="outline" aria-pressed={showActivity} onClick={toggleActivity}><History /> Activity</Button>
          )}
          {workspace && !spaces.resolving && (
            <Button variant="outline" aria-pressed={showAssignments} onClick={toggleAssignments}>
              <ClipboardCheck /> Assignments{myOpen > 0 && <Badge variant="beta" className="ml-0.5" aria-label={`${myOpen} open for you`}>{myOpen}</Badge>}
            </Button>
          )}
          {workspace && !spaces.resolving && (
            <Button variant="outline" aria-pressed={showPicklist} onClick={togglePicklist}><ListOrdered /> Pick list</Button>
          )}
          {workspace && isAdmin && !spaces.resolving && (
            <Button variant="outline" aria-pressed={showTemplate} onClick={toggleTemplate}><LayoutList /> Template</Button>
          )}
          {/* The server applies the URL's filters (src/shared/scoutFilter.ts, the same predicate as the feed) and checks membership. */}
          {workspace && !spaces.resolving && (
            <Button variant="outline" asChild>
              <a href={workspaceExportUrl(workspace.id, exportParams(sp, season))} download>
                <Download /> Export CSV{" "}<span className="sr-only">{filtering ? `(the ${feed.shown.length} filtered ${season} entries)` : `(all ${season} entries)`}</span></a>
            </Button>
          )}
        </div>
      </PageHeader>
      {showTemplate && workspace && (
        <TemplateEditor key={`${workspace.id}:${season}`} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} template={wt.template} onClose={toggleTemplate} />
      )}
      {formOpen && !spaces.resolving && (
        <EntryForm key={editEntry?.uuid ?? `new-${formTeam ?? ""}-${formNonce}`} season={season} initial={editEntry} team={formTeam} space={space} spaceName={workspace ? workspaceLabel(workspace) : null} workspaceTemplate={wt.template} templatePending={templatePending}
          readOnly={!!readOnly}
          defaultEvent={(space != null && formEvent?.space === space && formEvent.season === season && formEvent.code) || newEntryEventCode(space, wss.defaults, season)}
          onDone={() => { setFormOpen(false); setFormEvent(null); setSp((x) => { x.delete("entry"); x.delete("new"); return x; }); }} />
      )}
      {formOpen && !spaces.resolving && editEntry?.workspaceId != null && <EntryComments key={`comments-${editEntry.uuid}`} entry={editEntry} className="-mt-4 mb-8" />}
      {showAssignments && workspace && space != null ? (
        <AssignmentsView space={space} workspaceName={workspaceLabel(workspace)} season={season} defaultEvent={newEntryEventCode(space, wss.defaults, season)}
          state={assignments} myAccountId={me?.accountId ?? null} isAdmin={isAdmin} localEntries={entries} onScout={scoutAssigned} readOnly={!!readOnly} />
      ) : showPicklist && workspace ? <SharedPicklist key={`${workspace.id}:${season}`} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} live={live} me={pickMe} shortlist={personal.bookmarks} readOnly={!!readOnly} />
        : showActivity && workspace ? <ActivityFeed state={activity} workspaceName={workspaceLabel(workspace)} onOpenEntry={openEntry} /> : <>
      <Section title={`Entries (${entries.length})`}>
        {spaces.resolving ? <LoadingBlock rows={3} label="Loading scout space" /> : !entries.length ? <EmptyState icon={ClipboardList} title="No scouting entries yet" description="Start one above, or from any team page. Entries save on this device first, so scouting works with no signal." /> : <>
          <EntryFilterBar filters={feed.filters} query={feed.query} sort={feed.sort} options={feed.options} shown={feed.shown.length} total={entries.length}
            onFilter={feed.setFilter} onSort={feed.setSort} onClear={feed.clear} onWantEvents={() => setWantEvents(true)} />
          {!feed.shown.length ? (
            <EmptyState icon={SearchX} title="No entries match" description={`None of the ${entries.length} entries in this space match these filters.`}
              action={<Button variant="outline" onClick={feed.clear}>Clear filters</Button>} />
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {feed.shown.map((e) => <EntryCard key={e.uuid} e={e} assigned={badgeFor(e.team, e.eventCode)} canDelete={!readOnly && canDeleteScoutEntry(e, me)} readOnly={!!readOnly} comments={commentCounts[e.uuid] ?? 0} onEdit={() => setSp((x) => { x.set("entry", e.uuid); return x; })} onHistory={() => setHistoryFor(e.uuid)} />)}
            </ul>
          )}
        </>}
      </Section>
      <Section title="Match recordings" description="Videos you recorded in the app stay on this device only — they're never uploaded. YouTube links you add sync with your account.">
        <Recordings />
      </Section>
      </>}
      {historyEntry && <HistorySheet entry={historyEntry} me={me && { ...me, readOnly: !!readOnly }} open onOpenChange={(o) => { if (!o) setHistoryFor(null); }} />}
    </div>
  );
}

/** What Export CSV sends: the page URL's filters (the feed's), for the season on screen. */
function exportParams(sp: URLSearchParams, season: number): URLSearchParams {
  const out = new URLSearchParams(sp);
  out.set("season", String(season));
  return out;
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

/** The banner on a read-only space (Task 19). */
function ReadOnlyBanner({ state }: { state: OrphanState }) {
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{orphanBanner(state.reason)}</p>
        <p className="mt-0.5 text-muted-foreground">
          You can still read, filter and export everything here. {state.reason === "deleted" ? "If the workspace comes back in Control Point" : "Once Control Point gives it an admin again"}, editing returns on its own.
        </p>
      </div>
    </div>
  );
}

/** When an entry was saved, for its card. 0 or missing (a repaired impossible timestamp, see
 *  src/shared/scoutEntry.ts) is unknown, never "12/31/1969". */
export function entryDate(updatedAt: number | null | undefined): string {
  if (!updatedAt || !Number.isFinite(updatedAt)) return "Date unknown";
  const d = new Date(updatedAt);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Date unknown";
}

/** One entry in the feed (exported for its tests). */
export function EntryCard({ e, assigned, canDelete, readOnly, comments, onEdit, onHistory }: { e: ScoutEntry; assigned: string | null; canDelete: boolean; readOnly: boolean; comments: number; onEdit: () => void; onHistory: () => void }) {
  // The fields it was made with (an older template version stays readable after the admin changes it).
  const t = useEntryTemplate(e);
  const shown = t.fields.filter((f) => e.data[f.id] !== undefined && e.data[f.id] !== false && e.data[f.id] !== 0 && e.data[f.id] !== "").slice(0, 5);
  const what = `${e.team} · ${e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`}`;
  return (
    // min-w-0: a grid item is otherwise as wide as its longest line that can't break, which pushed the actions
    // past a phone's edge. The actions wrap under the details when both don't fit (long names, two scouts).
    <li className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-medium"><Link to={`/teams/${e.team}?season=${e.season}`} className="font-mono hover:underline">{e.team}</Link> · {e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`}</p>
          {e.workspaceId == null ? <p className="text-xs text-muted-foreground">{e.eventCode ?? "No event"} · {entryDate(e.updatedAt)}</p> : (
            <>
              <p className="text-xs text-muted-foreground">{e.eventCode ?? "No event"}</p>
              <EntryAttribution e={e} className="mt-0.5" />
              {assigned && <Badge variant="beta" className="mt-1.5 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]"><ClipboardCheck className="shrink-0" /> {assigned}</Badge>}
            </>
          )}
        </div>
        <div role="group" aria-label={`Entry ${what}`} className="ml-auto flex shrink-0 gap-1">
          {comments > 0 && (
            <Button variant="ghost" size="sm" onClick={onEdit} className="text-muted-foreground max-sm:h-11" aria-label={`${comments} comment${comments === 1 ? "" : "s"}: open the entry`}>
              <MessageSquare />{comments}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>{readOnly ? "View" : "Edit"}</Button>
          {e.workspaceId != null && <Button variant="ghost" size="icon-sm" aria-label="Version history" title="History" onClick={onHistory} className="max-sm:size-10"><History /></Button>}
          {canDelete && <Button variant="ghost" size="icon-sm" aria-label="Delete entry" onClick={() => { deleteScoutEntry(e); toast("Entry deleted"); }}><Trash2 /></Button>}
        </div>
      </div>
      {shown.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{shown.map((f) => <Badge key={f.id} variant="secondary">{f.label}: {String(e.data[f.id] === true ? "yes" : e.data[f.id])}</Badge>)}</div>}
      {e.notes && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{e.notes}</p>}
      <EntryPhotos entry={e} className="mt-3" />
    </li>
  );
}

function EntryForm({ season, initial, team, space, spaceName, workspaceTemplate, templatePending, defaultEvent, onDone, readOnly = false }: {
  season: number; initial: ScoutEntry | null; team?: number; space: ScoutSpace; spaceName: string | null;
  /**
   * A read-only space (Task 19). An entry opened there shows with every field disabled and no Save. A form
   * that was already open when the space went read-only (a live update), or a new entry, keeps what was typed:
   * its Save keeps it in Personal instead (an edit as a new personal copy).
   */
  readOnly?: boolean;
  /** The workspace's current template (null: Personal, or not known yet: the built-in defaults). */
  workspaceTemplate: WorkspaceTemplate | null;
  /** The workspace's template hasn't come yet (none on this device): new entries wait for it. */
  templatePending: boolean;
  /** Where a new entry's event starts: the workspace's default event (Personal: none). */
  defaultEvent: string;
  onDone: () => void;
}) {
  const startedWritable = useRef(!readOnly);
  const viewOnly = readOnly && !!initial && !startedWritable.current;
  const toPersonal = readOnly && !viewOnly;
  const [kind, setKind] = useState<"match" | "pit">(initial?.kind ?? "match");
  const [teamText, setTeamText] = useState(initial ? String(initial.team) : team ? String(team) : "");
  const [eventCode, setEventCode] = useState(initial ? initial.eventCode ?? "" : defaultEvent);
  // A new entry's event follows the workspace's default (it can arrive after the form opens, or change
  // with the space) until it's typed in; an edit keeps its own.
  const eventTouched = useRef(!!initial);
  useEffect(() => { if (!eventTouched.current) setEventCode(defaultEvent); }, [defaultEvent]);
  const [matchLabel, setMatchLabel] = useState(initial?.matchLabel ?? "");
  const [data, setData] = useState<Record<string, ScoutValue>>(initial?.data ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // An edit keeps the template the entry was made with; a new entry (or a switch to the other kind)
  // uses the space's current one: the workspace's, or the built-in defaults (Personal, never customised).
  const entryTemplate = useEntryTemplateState(initial ?? { season, kind, templateId: undefined, templateVersion: undefined });
  const sameKindEdit = !!initial && kind === initial.kind;
  const latestTemplate = useMemo(() => (sameKindEdit ? entryTemplate.template : resolveTemplate(space == null ? null : workspaceTemplate, season, kind)),
    [sameKindEdit, kind, entryTemplate.template, space, workspaceTemplate, season]);
  // Once a field has an answer, a new entry keeps the template it was being filled in with: a template that
  // arrives late (a slow first load, a live change) never swaps the questions, or drops answers, mid-entry.
  // The pin holds for one space, season and kind only.
  const scope = `${space ?? ""}:${season}:${kind}`;
  const [pinned, setPinned] = useState<{ scope: string; template: typeof latestTemplate } | null>(null);
  const template = !sameKindEdit && pinned?.scope === scope ? pinned.template : latestTemplate;
  const answer = (id: string, v: ScoutValue) => {
    if (!sameKindEdit && pinned?.scope !== scope) setPinned({ scope, template });
    setData((d) => ({ ...d, [id]: v }));
  };
  // A new entry moved to another space or season starts its answers afresh (they belonged to the other one's questions).
  const where = `${space ?? ""}:${season}`;
  const shownWhere = useRef(where);
  useEffect(() => {
    if (shownWhere.current === where) return;
    shownWhere.current = where;
    if (!initial) { setData({}); setPinned(null); }
  }, [where, initial]);
  // No field edits against a stand-in: an edit whose own template version isn't here yet (loading, or offline)
  // shows its answers untouched and lets notes change; a new entry waits for the workspace's template.
  const fieldsLocked = sameKindEdit && !entryTemplate.exact;
  const fieldsPending = !sameKindEdit && templatePending;
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
  const latest = useRef({ kind, teamText, eventCode, matchLabel, data, notes, space, template, fieldsLocked });
  latest.current = { kind, teamText, eventCode, matchLabel, data, notes, space, template, fieldsLocked };
  // The server version this edit started from (Task 16): a newer one arriving while the form is open is one this save never saw.
  const draftBase = useRef(initial ? scoutDraftBase(initial) : undefined);
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
    const { kind, eventCode, matchLabel, data: all, notes, template, fieldsLocked } = latest.current;
    // A new entry keeps only the template's fields (a kind switch or a template change can leave others behind);
    // an edit keeps everything it had.
    const ids = new Set(template.fields.map((f) => f.id));
    const data = initial ? { ...all } : Object.fromEntries(Object.entries(all).filter(([k]) => ids.has(k)));
    // A counter shows its lowest value until it's touched: that shown value is the answer.
    if (!fieldsLocked) for (const f of template.fields) if (f.type === "counter" && (f.min ?? 0) > 0 && data[f.id] === undefined) data[f.id] = f.min!;
    // Workspace entries record the template they were made with (an edit of the same kind keeps the entry's own,
    // whatever stands in on screen); Personal ones always use the built-in defaults.
    const made = space == null || toPersonal ? {}
      : initial && kind === initial.kind ? (initial.templateId ? { templateId: initial.templateId, templateVersion: initial.templateVersion ?? 0 } : {})
      : { templateId: template.id, templateVersion: template.version ?? 0 };
    // Kept in Personal (the workspace went read-only): its own answers go into the notes, which must fit them.
    const copy = toPersonal ? personalCopy(data, notes, template.fields, resolveTemplate(null, season, kind).fields, spaceName) : null;
    if (copy?.overflow) { setSaveErr(`The workspace's answers are written into the notes in Personal: shorten the notes by ${copy.overflow} characters so they fit.`); saveRef.current?.focus(); return; }
    const kept = copy ? { data: copy.data, notes: copy.notes } : { data, notes };
    try {
      saveScoutEntry({ uuid: (toPersonal ? null : initial?.uuid) ?? newScoutId(), season, team: Number(team), eventCode: eventCode.trim().toUpperCase() || null, matchLabel: kind === "match" ? matchLabel.trim().toUpperCase() || null : null, kind, ...kept, workspaceId: toPersonal ? null : space, ...made }, initial && !toPersonal ? { base: draftBase.current ?? null } : {});
      toast.success(toPersonal ? "Kept in Personal: the workspace is read-only" : "Saved on this device");
      onDone();
    } catch (e) {
      setSaveErr(e instanceof ScoutStorageError ? e.message : "Couldn't save this entry on this device. Try again.");
      saveRef.current?.focus();
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!viewOnly) save(); }} noValidate className="mb-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <fieldset disabled={viewOnly} className="m-0 min-w-0 border-0 p-0">
      <div className="flex flex-wrap items-start gap-4">
        <ToggleGroup type="single" value={kind} onValueChange={(v) => { if (v) setKind(v as typeof kind); }} aria-label="Entry type">
          <ToggleGroupItem value="match">Match</ToggleGroupItem><ToggleGroupItem value="pit">Pit</ToggleGroupItem>
        </ToggleGroup>
        <div className={teamErr ? "w-56" : "w-32"}><TeamInput label="Team" value={teamText} onChange={(v) => { setTeamText(v); setTeamErr(null); }} error={teamErr} inputRef={teamRef} /></div>
        <div className="w-36"><Input value={eventCode} onChange={(e) => { eventTouched.current = true; setEventCode(e.target.value); }} placeholder="Event code" aria-label="Event code" className="h-11 font-mono uppercase" /></div>
        {kind === "match" && <div className="w-24"><Input value={matchLabel} onChange={(e) => setMatchLabel(e.target.value)} placeholder="Q12" aria-label="Match" className="h-11 font-mono uppercase" /></div>}
      </div>
      {fieldsPending ? <div className="mt-5"><LoadingBlock rows={2} label="Loading the workspace's fields" /></div> : fieldsLocked ? (
        <p role="status" className="mt-5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          This entry was made with an earlier version of the workspace's fields, which this device hasn't loaded yet. Its answers are kept as they are; you can still change the notes.
        </p>
      ) : <div className="mt-5 grid gap-5 md:grid-cols-2">
        {phases.map((ph) => {
          const fields = template.fields.filter((f) => f.phase === ph);
          if (!fields.length) return null;
          return (
            <fieldset key={ph} className="min-w-0 rounded-xl border border-border p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{phaseLabel(ph)}</legend>
              <div className="space-y-3">{fields.map((f) => <ScoutFieldInput key={f.id} f={f} value={data[f.id]} onChange={(v) => answer(f.id, v)} />)}</div>
            </fieldset>
          );
        })}
      </div>}
      <div className="mt-5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What stood out? Strategy, reliability, driver habits…" className="mt-2" />
      </div>
      </fieldset>
      {initial && <EntryPhotos entry={initial} editable={!readOnly} className="mt-5" />}
      {toPersonal && (
        <p role="status" className="mt-5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          This workspace is read-only now, so this entry can't be saved to it. Save keeps what you typed in Personal{initial ? ", as a new entry of your own" : ""}.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {!viewOnly && <Button ref={saveRef} type="submit" disabled={checking || fieldsPending} aria-describedby={saveErr ? saveErrId : undefined}><Save /> {toPersonal ? "Save to Personal" : "Save"}</Button>}
        <Button type="button" variant={viewOnly ? "outline" : "ghost"} onClick={onDone}>{viewOnly ? "Close" : "Cancel"}</Button>
        <p className="ml-auto self-center text-xs text-muted-foreground">{viewOnly ? <>This workspace is read-only, so this entry can be read but not changed.</>
          : <>{spaceName && !toPersonal ? <>Saves to <span className="font-medium text-foreground">{spaceName}</span>, shared with the workspace. </> : null}Saved on this device first — works without a connection.</>}</p>
      </div>
      <FieldError id={saveErrId}>{saveErr}</FieldError>
    </form>
  );
}
