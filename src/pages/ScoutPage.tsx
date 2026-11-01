// Manual scouting: your own match and pit observations on top of public data.
// Offline-first: saved on this device the moment you press Save; synced to
// your account when signed in and online.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ClipboardCheck, ClipboardList, Cloud, CloudOff, Download, Handshake, History, Info, LayoutList, ListOrdered, Loader2, Lock, MessageSquare, Pause, Plus, Save, SearchX, Trash2, Video, X } from "lucide-react";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { canDeleteScoutEntry, deleteScoutEntry, isScoutQueued, scoutSyncProblem, localScoutEntries, newScoutId, personalCopy, scoutDraftBase, refusalMessage, SCOUT_REFUSED, type ScoutRefusal, saveScoutEntry, ScoutStorageError, usePendingScoutCounts, useScouting, type ScoutEntry, type ScoutSpace, type ScoutValue } from "../lib/scouting";
import { resolveTemplate, useEntryTemplate, useEntryTemplateState, useWorkspaceTemplate } from "../lib/scoutTemplates";
import { ALL_PHASES, phaseLabel, type WorkspaceTemplate } from "../shared/scoutTemplate";
import { orphanBanner, type OrphanState } from "../shared/orphaned";
import { useWorkspaceFlag } from "../lib/flags";
import { featureOffMessage } from "../shared/flags";
import { DEFAULT_WATCHING, nextMatchIndex, normalizeMatchLabel, scoutedByMatch, type Watching } from "../shared/scoutMatch";
import { activeFilterCount } from "../shared/scoutFilter";
import { EntryFilterBar } from "../components/scout/EntryFilterBar";
import { useEntryFeed, type FeedViewer } from "../lib/scoutFeed";
import { qs, useApi } from "../lib/api";
import { isKnownTime } from "../lib/format";
import type { EventListItem } from "../shared/api";
import { TemplateEditor } from "../components/scout/TemplateEditor";
import { useScoutSpaces, workspaceLabel } from "../lib/scoutSpace";
import { newEntryEventCode, useWorkspaceSettings } from "../lib/workspaceSettings";
import { ScoutSpaceSwitcher } from "../components/ScoutSpaceSwitcher";
import { LoadingBlock } from "../components/states";
import { useScoutLive, type LiveMode } from "../lib/scoutLive";
import { EntryAttribution } from "../components/EntryAttribution";
import { SaveStatus } from "../components/SaveStatus";
import { EntryPhotos } from "../components/scout/EntryPhotos";
import { CommonsBadge, CommonsShare } from "../components/scout/CommonsShare";
import { ActivityFeed } from "../components/scout/ActivityFeed";
import { ConflictNotices, HistorySheet } from "../components/scout/EntryHistory";
import { LOST_UNSAVED_MESSAGE, SCOUT_LOST_UNSAVED } from "../lib/lostEdits";
import { EntryComments } from "../components/scout/EntryComments";
import { RecoverableChanges } from "../components/scout/RecoverableChanges";
import { announceCommentsResync, useCommentCounts } from "../lib/scoutComments";
import { useWorkspaceActivity } from "../lib/scoutActivity";
import { SharedPicklist } from "../components/scout/SharedPicklist";
import { AllianceView, PicklistWithPartner } from "../components/scout/Alliance";
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
import { MatchScout } from "../components/scout/redesign/MatchScout";
import { EntryEditor } from "../components/scout/forms/EntryEditor";
import type { SaveSync } from "../components/scout/forms/SaveState";
import { PitScout } from "../components/scout/eventday/PitScout";
import { ScoutSections } from "../components/scout/eventday/ScoutSections";
import { EventBar } from "../components/scout/eventday/EventBar";
import { EventChooser } from "../components/scout/eventday/EventChooser";
import { EventDay, MatchQueue } from "../components/scout/eventday/EventDay";
import { useScoutEvent } from "../lib/scoutEvent";
import { isPlanningView, legacyScoutUrl, PERSONAL_SECTIONS, SCOUT_SECTIONS, sectionFromUrl, type PlanningView, type ScoutSection } from "../shared/scoutSections";
import { matchQueueProgress } from "../shared/scoutProgress";
import { workspaceExportUrl } from "../shared/scoutExport";
import { useScoutSession } from "../lib/scoutSession";
import { myMatchAssignment, useMatchAssignments } from "../lib/slotAssignments";
import { useSavedToLine } from "../lib/adminCopies";

/** What Export CSV sends: the page URL's filters (the entry list's), for the season on screen. */
export function dataExportUrl(workspaceId: string, sp: URLSearchParams, season: number): string {
  const out = new URLSearchParams(sp);
  out.set("season", String(season));
  return workspaceExportUrl(workspaceId, out);
}

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
  // Paused by the owner for this workspace (the workspaceScouting feature toggle): the server refuses its reads and
  // writes (403 feature_disabled) and what's queued waits on this device; the page says so instead of "removed".
  const scoutingOn = useWorkspaceFlag("workspaceScouting", space);
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
  // A match typed in by hand (no schedule, a practice match, an assignment's team): its team and event. Each one
  // opens a fresh form (its nonce), never the draft of an earlier one. Pit entries open from the pit queue (?pit=).
  // `from`: the section it opened in (Event day needs a picked event; Entries and assignments don't). `eventCode`: an
  // assignment's event, held only in the space it was opened in; otherwise the form is at the picked event, or the
  // workspace's default event when none is picked (following a change to the default while it's open).
  const [manual, setManual] = useState<{ from: "event" | "entries"; team?: number; eventCode?: string; space: ScoutSpace; season: number; nonce: number } | null>(null);
  const pitTeam = /^\d+$/.test(sp.get("pit") ?? "") ? Number(sp.get("pit")) : null;
  const formOpen = !!editEntry || !!manual || pitTeam != null;
  // A pit form opened while the space could be written to stays open if it goes read-only (its Save keeps the
  // answers in Personal); a read-only space never opens a new one.
  const [pitWritable, setPitWritable] = useState<number | null>(null);
  useEffect(() => { if (pitTeam == null) setPitWritable(null); else if (!readOnly) setPitWritable(pitTeam); }, [pitTeam, readOnly]);
  // The forms' Save bar says Saved (not how saving works) once anything was saved this visit.
  const [savedHere, setSavedHere] = useState(false);
  // Another space's entry can't be edited here: switching closes an edit (a new entry stays open and saves to the new space).
  // Authors are a workspace's own, so the author filter doesn't carry over.
  // (Cleared once the switch is in the URL: two URL writes in one go would drop one.)
  const switching = useRef<{ to: ScoutSpace } | null>(null);
  const selectSpace = (s: ScoutSpace) => {
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
  // Every form that opens (New entry, an edit, or one opened from the URL) checks for a newer template first:
  // the live notice can be missed (realtime off, or a reconnect gap), and polling only pulls entries.
  const refreshTemplate = wt.refresh;
  const refreshSettings = wss.refresh;
  useEffect(() => { if (formOpen) { refreshTemplate(); refreshSettings(); } }, [formOpen, editing, refreshTemplate, refreshSettings]);
  // A workspace whose template this device has never seen: hold the form until the first answer (offline: the built-in fields).
  const templatePending = space != null && !wt.template && wt.status === "loading";
  // The workspace's activity feed (Pick list & planning, ?view=activity): every member sees it.
  const showActivity = !!workspace && !spaces.resolving && sp.get("view") === "activity";
  const activity = useWorkspaceActivity(showActivity ? space : null, live);
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
  // A scouting alliance (?view=alliance, docs/alliances.md): link with another team's workspace for one event.
  // Off (the owner's scoutingAlliances switch, for this workspace): no row, no view, no partner's pick list.
  const alliancesOn = useWorkspaceFlag("scoutingAlliances", space);
  const myOpen = workspace && me ? assignments.list.filter((a) => a.assigneeAccountId === me.accountId && a.status === "open").length : 0;
  // Scout an assigned team: the list filtered to that team at that event, and a new entry for it there.
  // The event of the assignment Scout was tapped on: only for that space and season (a switch falls back to the defaults).
  const scoutAssigned = (team: number, eventCode: string) => {
    const code = eventCode.toUpperCase();
    const from = session?.eventCode === code ? "event" : "entries";
    setSp((x) => { x.set("tab", from); x.delete("view"); x.delete("entry"); x.delete("at"); x.delete("pit"); return x; });
    setManual({ from, team, eventCode: code, space, season, nonce: Date.now() });
  };
  const badgeFor = (team: number, eventCode: string | null) => (workspace && eventCode ? assignedLabel(assignIndex.get(assignmentKey(season, eventCode, team)) ?? [], me?.accountId) : null);
  // Tapping an item about an entry opens it (in its season), if this device has it and it wasn't deleted since.
  const openEntry = (uuid: string) => {
    const e = space == null ? null : localScoutEntries(space).find((x) => x.uuid === uuid);
    if (!e) { toast("That entry hasn't synced to this device yet."); return; }
    // A deleted entry opens its History (Task 16): its versions, and any edit of yours it overwrote, to restore.
    if (e.deleted) { setHistoryFor(uuid); return; }
    setSp((x) => { x.set("tab", "entries"); x.delete("view"); x.delete("team"); x.set("season", String(e.season)); x.set("entry", uuid); return x; });
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
  // The sections (src/shared/scoutSections.ts): Event day, Entries, and Pick list & planning. A link from before
  // the rebuild (?tab=match, ?tab=data, ?view=pit…) is rewritten in place to the section it meant.
  const legacy = legacyScoutUrl(sp);
  const legacyKey = legacy?.toString() ?? null;
  useEffect(() => { if (legacyKey != null) setSp(new URLSearchParams(legacyKey), { replace: true }); }, [legacyKey, setSp]);
  const view = sp.get("view");
  // Personal has nothing shared to plan: its pick list, assignments and alliance are a workspace's.
  const sections: readonly ScoutSection[] = workspace ? SCOUT_SECTIONS : PERSONAL_SECTIONS;
  const wantSection = sectionFromUrl(sp, !!readOnly);
  const section: ScoutSection = sections.includes(wantSection) ? wantSection : "entries";
  const planningView: PlanningView = isPlanningView(view) && (view !== "template" || isAdmin) && (view !== "alliance" || alliancesOn) ? view : "picklist";
  const setSection = (s: ScoutSection) => setSp((x) => { x.set("tab", s); x.delete("view"); x.delete("at"); x.delete("pick"); return x; });
  const openView = (s: ScoutSection, v: string | null) => setSp((x) => { x.set("tab", s); x.delete("pick"); if (v) x.set("view", v); else x.delete("view"); return x; });
  // The scouting session: the event and teams, set once (per space and season) and kept on this device.
  const scoutSession = useScoutSession(space, season, newEntryEventCode(space, wss.defaults, season));
  const session = scoutSession.session;
  const scoutEvent = useScoutEvent(season, session?.eventCode ?? null);
  // With no event picked, Event day is the picker (no sections above it); Change event (?pick=1) opens it again.
  // With no event picked, Event day is the picker; a pit form asked for meanwhile (a team page's Scout this team,
  // ?pit=) waits under it and opens at the event picked. (A match typed in from Entries isn't on Event day.)
  const picking = !spaces.resolving && !readOnly && (sp.get("pick") === "1" || (!session && section === "event"));
  // Match assignments ("Red 1, Q1–Q30"): who has the other teams in the queue, and yours is what a new event starts watching.
  const matchAssignments = useMatchAssignments(workspace && !spaces.resolving ? space : null, season, live);
  const mineAt = (code: string) => {
    if (!workspace || !me?.accountId) return null;
    return myMatchAssignment(matchAssignments.list, me.accountId, code, season)?.watching ?? null;
  };
  const pickEvent = (code: string) => {
    const changed = !session || session.eventCode !== code.toUpperCase();
    scoutSession.set(code, (changed ? mineAt(code.toUpperCase()) : null) ?? session?.watching ?? DEFAULT_WATCHING);
    // A typed-in match waiting for its event (Pick the event) goes on where it was, now at this event.
    setSp((x) => { x.delete("pick"); x.set("tab", manual?.from ?? "event"); x.delete("view"); if (changed) x.delete("at"); return x; });
  };
  const setWatching = (w: Watching) => { if (session) scoutSession.set(session.eventCode, w); };
  // The match being scouted has its own key (`at`): `match` is the entry list's filter, which this never touches.
  const openMatch = (label: string) => setSp((x) => { x.set("tab", "event"); x.set("at", label); return x; });
  const closeMatch = () => setSp((x) => { x.delete("at"); return x; });
  const scoutingMatch = !!session && !readOnly && section === "event" && !!sp.get("at");
  // No schedule to scout from (or a practice match): a match typed in, at the picked event.
  const openManual = (from: "event" | "entries" = "event") => {
    setSp((x) => { x.set("tab", from); x.delete("view"); x.delete("entry"); x.delete("at"); x.delete("pit"); return x; });
    // From Entries filtered to one team, the form starts with that team.
    setManual({ from, team: from === "entries" ? teamFilter : undefined, space, season, nonce: Date.now() });
  };
  const manualEvent = manual ? ((manual.space === space && manual.season === season && manual.eventCode) || session?.eventCode || newEntryEventCode(space, wss.defaults, season)) : null;
  const manualForm = (back: string) => manual && (
    <div className="grid gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground max-sm:h-10" onClick={() => setManual(null)}><ChevronLeft /> {back}</Button>
      <h3 className="text-xl font-bold text-foreground">Type a match in</h3>
      <EntryEditor key={manual.nonce} kind="match" season={season} initial={null} team={manual.team} space={space} spaceName={spaceName} workspaceTemplate={wt.template} templatePending={templatePending}
        readOnly={!!readOnly} sync={sync} savedHere={savedHere}
        event={manualEvent ? { code: manualEvent, name: manualEvent === session?.eventCode ? scoutEvent.info?.name ?? null : null } : null}
        teams={manualEvent && manualEvent === session?.eventCode ? scoutEvent.teams : []}
        onSaved={(e) => { setSavedHere(true); setManual(null); toast.success(`Saved ${e.team} on this device`); }}
        onClose={() => setManual(null)} onPickEvent={() => setSp((x) => { x.set("pick", "1"); return x; })} />
    </div>
  );
  // A pit team in the queue: its pit entry at this event (a new one, or the one it has, to read or change).
  const openPit = (team: number) => {
    setManual(null);
    setSp((x) => { x.set("tab", "event"); x.set("pit", String(team)); x.delete("at"); x.delete("entry"); return x; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const closePit = () => setSp((x) => { x.delete("pit"); return x; });
  const closeEdit = () => setSp((x) => { x.delete("entry"); x.delete("new"); return x; });
  // Where saving stands, for the forms' Save bars: the page's sync state and this space's queue.
  const sync: SaveSync = { status: offlineAccount ? "offline" : status, pending: pendingCount, onRetry: () => void syncNow() };
  // Each match that comes on screen checks for newer questions (a missed live notice, or polling), as opening the
  // old form does; drafts already started keep the questions they began with (useMatchDraft).
  const onMatchShown = useCallback(() => { refreshTemplate(); refreshSettings(); }, [refreshTemplate, refreshSettings]);
  const matchTemplate = useMemo(() => resolveTemplate(space == null ? null : wt.template, season, "match"), [space, wt.template, season]);
  const spaceName = workspace ? workspaceLabel(workspace) : null;
  // Your teams: the account's own and its Control Point teams (the picker and Event day mark them).
  const cpTeams = user?.controlPoint?.teams;
  const ourTeams = useMemo(() => [...new Set([personal.myTeam, ...(cpTeams ?? []).map((t) => t.teamNumber)]
    .filter((t): t is number => typeof t === "number" && t > 0))], [personal.myTeam, cpTeams]);
  const scoutedHere = useMemo(() => (session ? scoutedByMatch(entries, session.eventCode) : new Map<string, Set<number>>()), [entries, session]);
  const nextHere = useMemo(() => (session ? nextMatchIndex(scoutEvent.schedule.matches, session.watching, scoutedHere) : -1), [session, scoutEvent.schedule.matches, scoutedHere]);
  const syncChip = spaces.resolving ? undefined : <SyncChip status={offlineAccount ? "offline" : status} pending={pendingCount} onSync={syncNow} signedIn={!!user} live={live} />;
  const exportHref = workspace ? dataExportUrl(workspace.id, sp, season) : null;
  const seasonRow = <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; })} />;
  return (
    <div>
      <PageHeader title="Scout" actions={session && !picking ? undefined : syncChip}>
        {spaces.switchable && <ScoutSpaceSwitcher workspaces={spaces.workspaces} space={space} pending={pending} onSelect={selectSpace} onRefresh={syncReady ? refreshSpace : undefined} className="mb-4" />}
        {/* Edits this device lost to newer ones from other members (Task 16): each until dismissed, with its diff. */}
        {space != null && !spaces.resolving && <ConflictNotices space={space} me={me && { ...me, readOnly: !!readOnly }} />}
        {/* This account's shared work that hasn't reached its workspace (E4), in any workspace: only while there is some. */}
        {user?.controlPoint && !spaces.resolving && <RecoverableChanges account={user.controlPoint.accountId} workspaces={user.controlPoint.workspaces ?? []} />}
        {spaces.notice && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1">{spaces.notice}</p>
            <button type="button" onClick={spaces.dismissNotice} aria-label="Dismiss" className="-m-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          </div>
        )}
        {readOnly && !spaces.resolving && <ReadOnlyBanner state={readOnly} />}
        {space != null && !scoutingOn && !spaces.resolving && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <Pause className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0 flex-1">{featureOffMessage("workspaceScouting")}</p>
          </div>
        )}
      </PageHeader>
      {spaces.resolving ? <LoadingBlock rows={3} label="Loading scout space" /> : <>
        {/* No event yet (or Change event): the picker is the page, with no sections above it. What's under it stays
            mounted (hidden), so an entry being filled in keeps its answers through Change event and back. */}
        {picking && <>
          <EventChooser key={`${space ?? "personal"}:${season}`} season={season} entries={entries} ourTeams={ourTeams} current={session?.eventCode ?? scoutSession.suggested} onPick={pickEvent}
            onCancel={session ? () => setSp((x) => { x.delete("pick"); return x; }) : undefined} />
          {!session && (
            <p className="mt-6 text-sm text-muted-foreground">
              Looking for what's already scouted? <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => openView("entries", null)}>Open entries</button>
              {workspace && <> or the <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => openView("planning", null)}>pick list &amp; planning</button></>}.
            </p>
          )}
        </>}
        <div hidden={picking}>
        {session && <EventBar event={scoutEvent} status={syncChip} onChange={readOnly ? null : () => setSp((x) => { x.set("pick", "1"); return x; })} />}
        {!session && <div className="mb-4 flex justify-end">{syncChip}</div>}
        <ScoutSections section={section} onSection={setSection} sections={sections}>
          {section === "event" ? (
            !session ? (
              <EmptyState icon={ClipboardList} title="Nothing to scout here" description="This workspace is read-only. Its entries, pick list and export are still here."
                action={<Button variant="outline" onClick={() => setSection("entries")}>Open entries</Button>} />
            ) : templatePending ? <LoadingBlock rows={3} label="Loading the workspace's fields" />
            : manual?.from === "event" ? manualForm("Event day")
            : pitTeam != null && (!readOnly || pitWritable === pitTeam) ? (
              <div className="grid gap-3">
                <Button variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground max-sm:h-10" onClick={closePit}><ChevronLeft /> Event day</Button>
                <PitScout event={scoutEvent} entries={entries} team={pitTeam} onTeam={openPit} onClose={closePit} onSaved={() => setSavedHere(true)}
                  season={season} space={space} spaceName={spaceName} workspaceTemplate={wt.template} templatePending={templatePending} readOnly={!!readOnly} sync={sync} savedHere={savedHere} />
              </div>
            )
            : scoutingMatch ? (
              // One match being scouted, with the queue beside it on a wide screen to see what's done and jump.
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
                <div className="grid min-w-0 gap-3">
                  <Button variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground max-sm:h-10" onClick={closeMatch}><ChevronLeft /> Event day</Button>
                  <MatchScout space={space} season={season} session={session} entries={entries} template={matchTemplate} author={me?.accountId ?? null}
                    readOnly={!!readOnly} spaceName={spaceName} matchLabel={sp.get("at")} onMatch={openMatch} onManual={() => openManual()} onShown={onMatchShown}
                    sync={sync} savedHere={savedHere} onAnySave={() => setSavedHere(true)} />
                </div>
                <div className="hidden xl:sticky xl:top-20 xl:block">
                  <MatchQueue event={scoutEvent} session={session} readOnly={!!readOnly} onMatch={openMatch} onManualMatch={() => openManual()}
                    assignments={matchAssignments.list} me={me?.accountId ?? null} scouted={scoutedHere} next={nextHere}
                    done={matchQueueProgress(scoutEvent.schedule.matches, session.watching, scoutedHere).done} current={sp.get("at")} />
                </div>
              </div>
            ) : (
              <EventDay event={scoutEvent} session={session} entries={entries} readOnly={!!readOnly} onWatching={setWatching} onMatch={openMatch}
                onManualMatch={() => openManual()} onPit={openPit} assignments={matchAssignments.list} me={me?.accountId ?? null} ourTeams={ourTeams} />
            )
          ) : section === "entries" ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup type="single" variant="chips" value={view === "recordings" ? "recordings" : "entries"} aria-label="Entries"
                  onValueChange={(v) => { if (v) openView("entries", v === "recordings" ? "recordings" : null); }}>
                  <ToggleGroupItem value="entries" className="max-sm:h-[44px]"><ClipboardList /> Entries <span className="tabular-nums text-text-muted">{entries.length}</span></ToggleGroupItem>
                  <ToggleGroupItem value="recordings" className="max-sm:h-[44px]"><Video /> Recordings</ToggleGroupItem>
                </ToggleGroup>
                {seasonRow}
              </div>
              {manual?.from === "entries" ? manualForm("Entries") : editEntry ? (
                // An entry opened from the list (or a link): the same form as a new one, with its own team, event and template.
                <div className="grid gap-3">
                  <Button variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground max-sm:h-10" onClick={closeEdit}><ChevronLeft /> Entries</Button>
                  <h3 className="text-xl font-bold text-foreground">{editEntry.kind === "pit" ? "Pit entry" : `Match ${editEntry.matchLabel ?? ""}`}</h3>
                  <EntryEditor key={editEntry.uuid} kind={editEntry.kind} season={season} initial={editEntry} space={space} spaceName={spaceName} workspaceTemplate={wt.template} templatePending={templatePending}
                    readOnly={!!readOnly} sync={sync} savedHere={savedHere} event={editEntry.eventCode ? { code: editEntry.eventCode } : null}
                    teams={session && editEntry.eventCode?.toUpperCase() === session.eventCode ? scoutEvent.teams : []}
                    onSaved={(e) => { setSavedHere(true); closeEdit(); toast.success(`Saved ${e.team} on this device`); }} onClose={closeEdit} />
                  {editEntry.workspaceId != null && <EntryComments key={`comments-${editEntry.uuid}`} entry={editEntry} />}
                </div>
              ) : view === "recordings" ? (
                <Section title="Match recordings" description="Videos you recorded in the app stay on this device only — they're never uploaded. YouTube links you add sync with your account.">
                  <Recordings />
                </Section>
              ) : (
                <Section title={`Entries (${entries.length})`} action={<div className="flex flex-wrap gap-2">
                  {!readOnly && <Button size="sm" variant="outline" onClick={() => openManual("entries")}><Plus /> Type a match in</Button>}
                  {exportHref && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={exportHref} download>
                        <Download /> Export CSV{" "}<span className="sr-only">{filtering ? `(the ${feed.shown.length} filtered ${season} entries)` : `(all ${season} entries)`}</span></a>
                    </Button>
                  )}
                </div>}>
                  {!entries.length ? <EmptyState icon={ClipboardList} title="No scouting entries yet" description="Scout from Event day, or start one from any team page. Entries save on this device first, so scouting works with no signal." /> : <>
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
              )}
            </div>
          ) : workspace && space != null ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup type="single" variant="chips" value={planningView} aria-label="Pick list and planning"
                  onValueChange={(v) => { if (v) openView("planning", v === "picklist" ? null : v); }}>
                  <ToggleGroupItem value="picklist" className="max-sm:h-[44px]"><ListOrdered /> Pick list</ToggleGroupItem>
                  <ToggleGroupItem value="assignments" className="max-sm:h-[44px]"><ClipboardCheck /> Assignments{myOpen > 0 && <Badge variant="beta" className="tabular-nums">{myOpen}</Badge>}</ToggleGroupItem>
                  {alliancesOn && <ToggleGroupItem value="alliance" className="max-sm:h-[44px]"><Handshake /> Alliance</ToggleGroupItem>}
                  <ToggleGroupItem value="activity" className="max-sm:h-[44px]"><History /> Activity</ToggleGroupItem>
                  {isAdmin && <ToggleGroupItem value="template" className="max-sm:h-[44px]"><LayoutList /> Template</ToggleGroupItem>}
                </ToggleGroup>
                {seasonRow}
              </div>
              {planningView === "template" ? (
                <TemplateEditor key={`${workspace.id}:${season}`} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} template={wt.template} onClose={() => openView("planning", null)} />
              ) : planningView === "assignments" ? (
                <AssignmentsView space={space} workspaceName={workspaceLabel(workspace)} season={season} defaultEvent={newEntryEventCode(space, wss.defaults, season)}
                  state={assignments} matchState={matchAssignments} live={live} myAccountId={me?.accountId ?? null} isAdmin={isAdmin} localEntries={entries} onScout={scoutAssigned} readOnly={!!readOnly} />
              ) : planningView === "alliance" ? (
                <AllianceView key={`${workspace.id}:${season}`} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} eventCode={session?.eventCode ?? null} isAdmin={isAdmin} readOnly={!!readOnly} />
              ) : planningView === "activity" ? (
                <ActivityFeed state={activity} workspaceName={workspaceLabel(workspace)} onOpenEntry={openEntry} />
              ) : (
                <PicklistWithPartner key={`${workspace.id}:${season}`} enabled={alliancesOn} workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} eventCode={session?.eventCode ?? null}>
                  <SharedPicklist workspaceId={workspace.id} workspaceName={workspaceLabel(workspace)} season={season} live={live} me={pickMe} shortlist={personal.bookmarks ?? []} readOnly={!!readOnly} />
                </PicklistWithPartner>
              )}
            </div>
          ) : null}
        </ScoutSections>
        </div>
      </>}
      {historyEntry && <HistorySheet entry={historyEntry} me={me && { ...me, readOnly: !!readOnly }} open onOpenChange={(o) => { if (!o) setHistoryFor(null); }} />}
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
  if (!isKnownTime(updatedAt)) return "Date unknown";
  const d = new Date(updatedAt);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Date unknown";
}

/**
 * Where a shared entry's latest change stands (E4). Synced: nothing (the calm state). Queued: Syncing…, or
 * Waiting to sync while offline (kept on this device), or Needs attention when a push didn't go through or its
 * answer was lost (it goes again by itself; the recoverable-changes view offers Retry and Discard).
 */
export function EntrySyncState({ e }: { e: ScoutEntry }) {
  if (e.workspaceId == null) return null;
  const queued = isScoutQueued(e);
  const problem = queued ? scoutSyncProblem(e.workspaceId) : null;
  const state = !queued ? null : problem?.kind === "offline" || problem?.kind === "paused" ? "draft" : problem ? "attention" : "saving";
  const text = problem?.kind === "paused" && queued ? "Paused by the owner" : state === "draft" ? "Waiting to sync" : state === "saving" ? "Syncing…" : state === "attention" ? (problem?.kind === "unconfirmed" ? "Not confirmed yet" : "Not synced") : undefined;
  return <SaveStatus state={state} text={text} what={`Entry ${e.team} ${e.kind === "pit" ? "pit" : `match ${e.matchLabel ?? ""}`}`.trim()} className="shrink-0" />;
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
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <EntryAttribution e={e} className="min-w-0" />
                <EntrySyncState e={e} />
              </div>
              <CommonsBadge e={e} />
              {assigned && <Badge variant="beta" className="mt-1.5 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]"><ClipboardCheck className="shrink-0" /> {assigned}</Badge>}
            </>
          )}
        </div>
        <div role="group" aria-label={`Entry ${what}`} className="ml-auto flex shrink-0 gap-1">
          {comments > 0 && (
            <Button variant="ghost" size="sm" onClick={onEdit} className="text-muted-foreground max-sm:h-10" aria-label={`${comments} comment${comments === 1 ? "" : "s"}: open the entry`}>
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
