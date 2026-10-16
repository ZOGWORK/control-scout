// Settings → Workspace (Task 6, Tier 2; docs/settings.md): the shared settings of one Control Point
// workspace the account belongs to. Every member sees them; only its admins can change them (the
// server checks the role too). Personal settings (theme, density, notifications) stay in the
// Personal sections: a workspace never sets them.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, LayoutList, Save } from "lucide-react";
import { useCurrentSeason, useMeta } from "../../lib/meta";
import { usePersonal } from "../../lib/personal";
import { readRememberedSpace, workspaceLabel, workspacesOf, type WorkspaceSpace } from "../../lib/scoutSpace";
import { useWorkspaceTemplate } from "../../lib/scoutTemplates";
import { saveWorkspaceSettings, useWorkspaceSettings } from "../../lib/workspaceSettings";
import type { WorkspaceSettings } from "../../shared/workspaceSettings";
import { seasonLabel } from "../../lib/format";
import { Button } from "../ui/button";
import { Badge, Input } from "../ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/controls";
import { toast } from "../ui/sonner";
import { Group, Row } from "./rows";
import { WorkspaceMembers } from "./WorkspaceMembers";

/** The one-line explanation members see on controls only admins can use. */
export const ADMINS_ONLY = "Only workspace admins can change these.";
/** Membership itself is Control Point's. */
export const MEMBERSHIP_NOTE = "Adding people and changing roles happen in Control Point.";
const NO_SEASON = "none";

/** The workspace to show: ?workspace=, else the scout space last used here (when it's one), else the first. */
function useSelectedWorkspace(list: WorkspaceSpace[]): [WorkspaceSpace, (id: string) => void] {
  const [sp, setSp] = useSearchParams();
  const asked = sp.get("workspace");
  const remembered = readRememberedSpace()?.id;
  const ws = list.find((w) => w.id === asked) ?? list.find((w) => w.id === remembered) ?? list[0];
  const select = (id: string) => setSp((x) => { const n = new URLSearchParams(x); n.set("workspace", id); return n; }, { replace: true });
  return [ws, select];
}

export function WorkspaceSection() {
  const { user } = usePersonal();
  const { list } = workspacesOf(user);
  const [ws, select] = useSelectedWorkspace(list);
  if (!ws) return null;
  const isAdmin = ws.role === "admin";
  return (
    <div>
      {list.length > 1 && (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="settings-workspace" className="text-sm text-muted-foreground">You're in {list.length} workspaces. Showing:</label>
          <Select value={ws.id} onValueChange={select}>
            <SelectTrigger id="settings-workspace" className="h-11 w-full sm:w-64" aria-label="Workspace"><SelectValue /></SelectTrigger>
            <SelectContent>
              {list.map((w) => <SelectItem key={w.id} value={w.id}>{workspaceLabel(w)}{w.role === "admin" ? " · admin" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <Membership workspace={ws} url={user?.controlPoint?.url} />
      <WorkspaceShared key={ws.id} workspace={ws} isAdmin={isAdmin} />
    </div>
  );
}

/**
 * Who's in the workspace. Membership and roles are Control Point's: the Members list (Task 9) shows
 * what it says, and an admin's Remove asks Control Point to do it. Invites and roles stay there.
 */
function Membership({ workspace, url }: { workspace: WorkspaceSpace; url?: string }) {
  return (
    <Group title="Membership" description={`${workspaceLabel(workspace)} is a Control Point workspace: everyone in it shares one scout space here.`}>
      <Row label="Your role" description={workspace.role === "admin" ? "You can change this workspace's shared settings below." : "You can read this workspace's shared settings; its admins change them."}>
        <Badge variant={workspace.role === "admin" ? "success" : "secondary"}>{workspace.role === "admin" ? "Admin" : "Member"}</Badge>
      </Row>
      <WorkspaceMembers workspace={workspace} />
      <Row label="Invites and roles" description={MEMBERSHIP_NOTE}>
        {url && <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noreferrer noopener">Open Control Point <ExternalLink /></a></Button>}
      </Row>
    </Group>
  );
}

function WorkspaceShared({ workspace, isAdmin }: { workspace: WorkspaceSpace; isAdmin: boolean }) {
  const { settings, status, refresh } = useWorkspaceSettings(workspace.id);
  return (
    <>
      {!settings ? (
        status === "offline"
          ? <p className="mb-8 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Couldn't load this workspace's settings. Check your connection and open this page again.</p>
          : <div className="skeleton mb-8 h-40 rounded-xl" aria-label="Loading workspace settings" />
      ) : (
        // Remounted on each new version: a change from another admin replaces the form's values.
        <Defaults key={settings.settingsVersion} workspace={workspace} settings={settings} isAdmin={isAdmin} onConflict={refresh} />
      )}
      <Template workspace={workspace} isAdmin={isAdmin} defaultSeason={settings?.defaults.season ?? null} />
      <Group title="Entry policy" description="The same for every workspace for now. The server applies it to every save.">
        <Row label="Create and edit entries"><span className="text-sm text-foreground">Every member</span></Row>
        <Row label="Delete an entry"><span className="text-sm text-foreground">Its author, or an admin</span></Row>
      </Group>
    </>
  );
}

function Defaults({ workspace, settings, isAdmin, onConflict }: { workspace: WorkspaceSpace; settings: WorkspaceSettings; isAdmin: boolean; onConflict: () => void }) {
  const meta = useMeta();
  const current = useCurrentSeason();
  // Seasons the Scout page offers (with predictions); a stored default outside them stays listed.
  const offered = (meta?.seasons.filter((s) => s.predictable).map((s) => s.season) ?? [current]);
  const seasons = [...new Set([...offered, ...(settings.defaults.season != null ? [settings.defaults.season] : [])])].sort((a, b) => b - a);
  const [season, setSeason] = useState(settings.defaults.season == null ? NO_SEASON : String(settings.defaults.season));
  const [event, setEvent] = useState(settings.defaults.eventCode ?? "");
  const [saving, setSaving] = useState(false);
  const next = { season: season === NO_SEASON ? null : Number(season), eventCode: event.trim().toUpperCase() || null };
  const dirty = next.season !== settings.defaults.season || next.eventCode !== settings.defaults.eventCode;
  const save = async () => {
    setSaving(true);
    try {
      const r = await saveWorkspaceSettings(workspace.id, { defaults: next, baseVersion: settings.settingsVersion });
      if (r.dropped.length) toast.error(`Not saved: ${r.dropped.map((d) => `${d.field.replace(/^defaults\./, "")} ${d.reason}`).join("; ")}`);
      else toast.success(`Saved for everyone in ${workspaceLabel(workspace)}`);
    } catch (e: any) {
      if (e?.status === 409) { toast.error("Another admin changed these meanwhile. Theirs are loaded; make your change again."); onConflict(); }
      else toast.error(e?.message ?? "Couldn't save. Try again");
    } finally { setSaving(false); }
  };
  const saved = settings.updatedAt ? `Last changed${settings.updatedBy ? ` by ${settings.updatedBy}` : ""} on ${new Date(settings.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.` : null;
  return (
    <Group title="Defaults for new entries" description={<>Where a new entry in {workspaceLabel(workspace)}'s scout space starts, for every member. {isAdmin ? saved : ADMINS_ONLY}</>}>
      <Row label="Default season" htmlFor="ws-default-season" description="The Scout page opens on it in this space. Anyone can still switch season there.">
        <Select value={season} onValueChange={(v) => { if (v) setSeason(v); }} disabled={!isAdmin}>
          <SelectTrigger id="ws-default-season" className="h-11 w-full sm:w-48" aria-label="Default season"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SEASON}>Current season</SelectItem>
            {seasons.map((s) => <SelectItem key={s} value={String(s)}>{seasonLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Default event" htmlFor="ws-default-event" description="Filled in on a new entry in that season. Empty: no event.">
        <Input id="ws-default-event" value={event} onChange={(e) => setEvent(e.target.value)} disabled={!isAdmin} placeholder="Event code" maxLength={24} className="h-11 w-full font-mono uppercase sm:w-48" />
      </Row>
      {isAdmin && (
        <div className="flex justify-end px-4 py-3">
          <Button onClick={save} disabled={!dirty || saving}><Save /> {saving ? "Saving…" : "Save defaults"}</Button>
        </div>
      )}
    </Group>
  );
}

// The season the scout space opens on: the workspace's default, else the current one.
function Template({ workspace, isAdmin, defaultSeason }: { workspace: WorkspaceSpace; isAdmin: boolean; defaultSeason: number | null }) {
  const current = useCurrentSeason();
  const season = defaultSeason ?? current;
  const { template, status } = useWorkspaceTemplate(workspace.id, season);
  const href = `/scout?space=${encodeURIComponent(workspace.id)}&season=${season}&view=template`;
  const summary = !template ? (status === "offline" ? "Couldn't load the template just now." : "Loading…")
    : template.version === 0 ? `${seasonLabel(season)}: the built-in match and pit fields (not customised).`
    : `${seasonLabel(season)}: version ${template.version}${template.updatedBy ? `, last changed by ${template.updatedBy}` : ""}.`;
  return (
    <Group title="Scout template" description={isAdmin ? "The match and pit fields every member's entries ask for. Edited in the scout space, one tap from there too." : `The match and pit fields every member's entries ask for. ${ADMINS_ONLY}`}>
      <Row label="Fields" description={summary}>
        {isAdmin
          ? <Button variant="outline" size="sm" asChild><Link to={href}><LayoutList /> Edit template</Link></Button>
          : <Button variant="outline" size="sm" disabled><LayoutList /> Edit template</Button>}
      </Row>
    </Group>
  );
}
