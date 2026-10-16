// Workspace scout templates on the device (Task 5; server/scout/templates.ts).
//
// - Personal always uses the built-in defaults (templateFor in scouting.ts).
// - A workspace's space uses its template for the season: each kind (match, pit)
//   is the workspace's own field list, or the built-in default when the admin
//   hasn't customised it (and when the workspace never did: version 0).
// - The current template is kept on the device (localStorage, per workspace and
//   season), so the form works offline with the last one seen, and refetched when
//   the form opens and whenever the live stream says it changed (`event: template`,
//   scoutLive.ts). The server's ETag makes an unchanged refetch a 304.
// - Each entry records the template id and version it was made with
//   (ScoutEntry.templateId/templateVersion); an entry made with an older version
//   renders with that version's fields, fetched once and kept (versions never change).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { templateFor, type ScoutEntry, type ScoutSpace } from "./scouting";
import { parseWorkspaceTemplateId, workspaceTemplateId, type ScoutTemplate, type TemplateKind, type WorkspaceTemplate } from "../shared/scoutTemplate";

/** Window event: a workspace's template changed (detail: { space, season? }). Open forms and editors refetch. */
export const TEMPLATE_CHANGED = "cs-scout-template";
export interface TemplateChange { space: string; season?: number; version?: number }
export const announceTemplateChange = (c: TemplateChange) => window.dispatchEvent(new CustomEvent<TemplateChange>(TEMPLATE_CHANGED, { detail: c }));

const CURRENT = (ws: string, season: number) => `cs-scout-tpl:${ws}:${season}`;
const VERSION = (ws: string, season: number, v: number) => `cs-scout-tplv:${ws}:${season}:${v}`;

function readJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full: fetched again next time */ } }

const isTemplate = (t: unknown): t is WorkspaceTemplate => !!t && typeof t === "object" && Number.isSafeInteger((t as WorkspaceTemplate).version);

/** The current template last seen on this device for a workspace and season (null: never fetched here). */
export function cachedWorkspaceTemplate(ws: string, season: number): WorkspaceTemplate | null {
  const t = readJson<WorkspaceTemplate>(CURRENT(ws, season));
  return isTemplate(t) ? t : null;
}

/**
 * Keep a template on the device under its version, and (a reply for the current template only, never a
 * version from the history, which carries today's settingsVersion) as the current one unless that's newer.
 */
export function rememberWorkspaceTemplate(t: WorkspaceTemplate, current = true) {
  const cur = current ? cachedWorkspaceTemplate(t.workspaceId, t.season) : null;
  if (current && (!cur || t.settingsVersion >= cur.settingsVersion)) writeJson(CURRENT(t.workspaceId, t.season), t);
  if (t.version > 0) writeJson(VERSION(t.workspaceId, t.season, t.version), t);
}

const inflight = new Map<string, Promise<WorkspaceTemplate>>();
/** GET the template (current, or one version), deduped, kept on the device. */
export function fetchWorkspaceTemplate(ws: string, season: number, version?: number): Promise<WorkspaceTemplate> {
  const path = `/api/scout/workspaces/${encodeURIComponent(ws)}/template?season=${season}${version != null ? `&version=${version}` : ""}`;
  let p = inflight.get(path);
  if (!p) {
    p = apiFetch<{ template: WorkspaceTemplate }>(path).then((r) => { rememberWorkspaceTemplate(r.template, version == null); return r.template; });
    inflight.set(path, p);
    void p.catch(() => undefined).finally(() => inflight.delete(path));
  }
  return p;
}

/** One kind of a workspace template as the form uses it: the workspace's own fields, or the built-in default. */
export function resolveTemplate(wt: WorkspaceTemplate | null, season: number, kind: TemplateKind): ScoutTemplate {
  const fields = wt?.[kind];
  if (!wt || !fields) return templateFor(season, kind);
  const base = templateFor(season, kind);
  return { id: workspaceTemplateId(wt.workspaceId, season, kind), kind, name: base.name, fields, version: wt.version };
}

export type TemplateStatus = "personal" | "loading" | "ready" | "offline";

/** How long a new-entry form waits for a workspace template this device has never seen before using the built-in fields. */
export const TEMPLATE_WAIT_MS = 6_000;

/**
 * The template a space's new entries use for a season: null for Personal (the built-in defaults), else
 * the workspace's (from the device at once, then from the server). `refresh` refetches.
 */
export function useWorkspaceTemplate(space: ScoutSpace, season: number): { template: WorkspaceTemplate | null; status: TemplateStatus; refresh: () => void } {
  const [state, setState] = useState<{ key: string; template: WorkspaceTemplate | null; status: TemplateStatus }>(() => initial(space, season));
  const key = `${space ?? ""}:${season}`;
  const cur = state.key === key ? state : initial(space, season);
  const refresh = useCallback(() => {
    if (space == null) return;
    fetchWorkspaceTemplate(space, season)
      .then((t) => setState((s) => (s.key === key ? { key, template: t, status: "ready" } : s)))
      .catch(() => setState((s) => (s.key === key ? { ...s, status: "offline" } : s)));
    // Venue Wi-Fi can look online yet stall: after TEMPLATE_WAIT_MS stop waiting (a form held for a first
    // template opens with the built-in fields); a late answer still arrives and is used from then on.
    setTimeout(() => setState((s) => (s.key === key && s.status === "loading" ? { ...s, status: "offline" } : s)), TEMPLATE_WAIT_MS);
  }, [space, season, key]);
  useEffect(() => {
    setState(initial(space, season));
    if (space == null) return;
    refresh();
    const changed = (ev: Event) => {
      const c = (ev as CustomEvent<TemplateChange>).detail;
      if (c?.space === space && (c.season == null || c.season === season)) refresh();
    };
    window.addEventListener(TEMPLATE_CHANGED, changed);
    return () => window.removeEventListener(TEMPLATE_CHANGED, changed);
  }, [space, season, refresh]);
  return { template: cur.template, status: cur.status, refresh };
}

function initial(space: ScoutSpace, season: number) {
  const key = `${space ?? ""}:${season}`;
  if (space == null) return { key, template: null, status: "personal" as TemplateStatus };
  return { key, template: cachedWorkspaceTemplate(space, season), status: "loading" as TemplateStatus };
}

/**
 * The template an existing entry renders with: the one it was made with. A workspace version not on
 * the device yet is fetched (once; versions never change); until then, and offline, the space's
 * current template, else the built-in default. Entries made before templates use the built-in.
 */
export function useEntryTemplate(e: Pick<ScoutEntry, "season" | "kind" | "templateId" | "templateVersion">): ScoutTemplate {
  return useEntryTemplateState(e).template;
}

/**
 * useEntryTemplate, plus `exact`: false while the entry's own version isn't on the device (still loading, or
 * offline), so the template shown is a stand-in. An edit form must not offer field edits against a stand-in.
 */
export function useEntryTemplateState(e: Pick<ScoutEntry, "season" | "kind" | "templateId" | "templateVersion">): { template: ScoutTemplate; exact: boolean } {
  const ref = parseWorkspaceTemplateId(e.templateId);
  const version = Number.isSafeInteger(e.templateVersion) ? e.templateVersion! : 0;
  const ws = ref?.workspaceId ?? null, season = ref?.season ?? e.season, kind = ref?.kind ?? e.kind;
  const read = useCallback(() => (ws && version > 0 ? versionOnDevice(ws, season, version) : null), [ws, season, version]);
  const [held, setHeld] = useState<WorkspaceTemplate | null>(read);
  useEffect(() => {
    const now = read();
    setHeld(now);
    if (!ws || version < 1 || now) return;
    let live = true;
    fetchWorkspaceTemplate(ws, season, version).then((t) => { if (live) setHeld(t); }).catch(() => { /* offline: the fallback below */ });
    return () => { live = false; };
  }, [read, ws, season, version]);
  return useMemo(() => {
    if (!ws || version < 1) return { template: templateFor(e.season, e.kind), exact: true };
    if (held) return { template: resolveTemplate(held, season, kind), exact: true };
    // Not here yet: the newest template seen stands in (most fields still match) for reading only.
    return { template: resolveTemplate(cachedWorkspaceTemplate(ws, season), season, kind), exact: false };
  }, [ws, version, held, season, kind, e.season, e.kind]);
}

function versionOnDevice(ws: string, season: number, version: number): WorkspaceTemplate | null {
  const t = readJson<WorkspaceTemplate>(VERSION(ws, season, version));
  if (isTemplate(t)) return t;
  const cur = cachedWorkspaceTemplate(ws, season);
  return cur && cur.version === version ? cur : null;
}

/** Save an admin's template (PUT). Throws ApiError (409: another admin saved first: refetch theirs). */
export async function saveWorkspaceTemplate(ws: string, season: number, body: { match: unknown; pit: unknown; baseVersion: number }) {
  const r = await apiFetch<{ changed: boolean; template: WorkspaceTemplate; dropped: { kind: TemplateKind; index: number; id?: string; reason: string }[] }>(
    `/api/scout/workspaces/${encodeURIComponent(ws)}/template`, { method: "PUT", json: { season, ...body } });
  rememberWorkspaceTemplate(r.template);
  announceTemplateChange({ space: ws, season, version: r.template.version });
  return r;
}
