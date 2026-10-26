// One match, several teams (the Scout redesign, docs/mockups/scout-redesign.html steps 2–3): a draft of
// answers and notes per watched team, kept while the scout switches tabs, and one Save for the whole match.
// The save follows the old entry form's rules (src/pages/ScoutPage.tsx, EntryForm) team by team: a team you
// already scouted in this match is edited (same uuid, the base it was opened on), never saved twice; new
// entries keep only the template's fields and record the template; a read-only workspace keeps what was typed
// in Personal. Drafts are kept in sessionStorage per space, account, season, event and match, so a phone that
// locks or reloads mid-match loses nothing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { newScoutId, personalCopy, saveScoutEntry, scoutDraftBase, ScoutStorageError, templateFor, type ScoutEntry, type ScoutSpace, type ScoutValue } from "./scouting";
import type { ScoutField, ScoutTemplate } from "../shared/scoutTemplate";
import { normalizeMatchLabel, type ScheduleMatch, type WatchedTeam } from "../shared/scoutMatch";

/** The template an entry records (absent fields: it records none, the built-in defaults). */
type Made = { templateId?: string; templateVersion?: number };

/** One team's unsaved work in a match. Where it saves is fixed by its first change, never by entries arriving later. */
export interface TeamDraft {
  data: Record<string, ScoutValue>;
  notes: string;
  /** An edit: the entry it edits (yours, in this match) when the first change was made. Absent: a new entry. */
  uuid?: string;
  /** That entry's draft base (scoutDraftBase) then: a newer version arriving after is one this save never saw. */
  base?: number | null;
  /** That entry's template then: an edit keeps it, also when the entry was deleted meanwhile and is saved again as new. */
  made?: Made;
  /** A new entry's template, fixed at its first answer, so a template arriving mid-match never swaps the questions or drops answers. */
  template?: ScoutTemplate;
  /** Read-only workspace: the Personal copy already saved for this team (and what it was saved from), so a retry or a later change updates it. */
  kept?: { uuid: string; data: Record<string, ScoutValue>; notes: string };
}

/** empty: nothing entered and nothing saved; started: unsaved answers; done: saved, nothing changed since. */
export type TeamStatus = "empty" | "started" | "done";

export interface TeamState {
  watched: WatchedTeam;
  data: Record<string, ScoutValue>;
  notes: string;
  status: TeamStatus;
  /** The saved entry Save edits for this team, or null (a new entry). */
  entry: ScoutEntry | null;
  /** The template a new entry is being filled with (an edit is read with its own: useEntryTemplateState(entry)). */
  template: ScoutTemplate;
}

export type MatchSaveResult =
  | { ok: true; saved: number; /** Teams already saved with nothing changed since. */ unchanged: number; skipped: number[] }
  | { ok: false; saved: number; error: string };

const KEY_PREFIX = "cs-scout-match-draft:";
/** Per space and, in a workspace, per account: another member on the same device never inherits a draft. */
export const matchDraftKey = (space: ScoutSpace, season: number, eventCode: string, label: string, author?: number | null) =>
  `${KEY_PREFIX}${space == null ? "personal" : `${space}@${author ?? 0}`}:${season}:${eventCode.trim().toUpperCase()}:${normalizeMatchLabel(label) ?? ""}`;

const isRecord = (v: unknown): v is Record<string, ScoutValue> => !!v && typeof v === "object" && !Array.isArray(v);

function readDrafts(key: string): Record<number, TeamDraft> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<number, TeamDraft> = {};
    for (const [t, d] of Object.entries(raw as Record<string, unknown>)) {
      const v = d as Partial<TeamDraft> | null;
      if (!/^\d+$/.test(t) || !v || typeof v !== "object" || !isRecord(v.data) || typeof v.notes !== "string") continue;
      const k = v.kept;
      out[Number(t)] = {
        data: v.data, notes: v.notes,
        ...(typeof v.uuid === "string" ? { uuid: v.uuid } : {}),
        ...(typeof v.base === "number" || v.base === null ? { base: v.base } : {}),
        ...(v.made && typeof v.made === "object" ? { made: typeof v.made.templateId === "string" ? { templateId: v.made.templateId, templateVersion: Number(v.made.templateVersion) || 0 } : {} } : {}),
        ...(v.template && Array.isArray(v.template.fields) && typeof v.template.id === "string" ? { template: v.template } : {}),
        ...(k && typeof k.uuid === "string" && isRecord(k.data) && typeof k.notes === "string" ? { kept: { uuid: k.uuid, data: k.data, notes: k.notes } } : {}),
      };
    }
    return out;
  } catch { return {}; }
}

function writeDrafts(key: string, drafts: Record<number, TeamDraft>) {
  try {
    if (Object.keys(drafts).length) sessionStorage.setItem(key, JSON.stringify(drafts));
    else sessionStorage.removeItem(key);
  } catch { /* storage blocked or full: the draft stays in memory for this page */ }
}

/** The value a field shows before it's touched: a value equal to it isn't an answer yet. */
function untouched(f: Pick<ScoutField, "type" | "min">, v: ScoutValue | undefined): boolean {
  if (v === undefined || v === "" || v === false) return true;
  if (f.type === "counter") return v === (f.min ?? 0);
  if (f.type === "rating") return v === 0;
  return false;
}

/** Has anything been entered: an answer that differs from what the field shows untouched, or notes. */
export function hasAnswers(data: Record<string, ScoutValue>, notes: string, fields: readonly Pick<ScoutField, "id" | "type" | "min">[]): boolean {
  if (notes.trim()) return true;
  const known = new Map(fields.map((f) => [f.id, f]));
  return Object.entries(data).some(([id, v]) => !untouched(known.get(id) ?? { type: "text" }, v));
}

const sameData = (a: Record<string, ScoutValue>, b: Record<string, ScoutValue>) => {
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};
const sameText = (d: Pick<TeamDraft, "data" | "notes">, e: Pick<TeamDraft, "data" | "notes">) => sameData(d.data, e.data) && d.notes === e.notes;

/**
 * Your entry for a team in this match at this event (the newest, if there were ever two). In a workspace, "yours":
 * written by `author` (your shared account id), or not synced yet (made on this device). Other members' entries
 * are never edited here: a second scout on the same team is a second entry.
 */
export function yourMatchEntry(existing: readonly ScoutEntry[], o: { space: ScoutSpace; eventCode: string; label: string | null; team: number; author?: number | null }): ScoutEntry | null {
  const code = o.eventCode.trim().toUpperCase();
  let best: ScoutEntry | null = null;
  for (const e of existing) {
    if (e.deleted || e.kind !== "match" || e.team !== o.team || (e.workspaceId ?? null) !== o.space) continue;
    if ((e.eventCode ?? "").toUpperCase() !== code || normalizeMatchLabel(e.matchLabel) !== o.label) continue;
    if (o.space != null && e.authorAccountId && e.authorAccountId !== o.author) continue;
    if (!best || e.updatedAt > best.updatedAt) best = e;
  }
  return best;
}

export interface MatchDraftOptions {
  space: ScoutSpace;
  season: number;
  eventCode: string;
  match: ScheduleMatch;
  teams: WatchedTeam[];
  /** The space's current match template (resolveTemplate(workspaceTemplate, season, "match")). */
  template: ScoutTemplate;
  /** The space's entries on this device (useScouting's list). */
  existing: ScoutEntry[];
  /** Your shared account id (workspaces): only your entries are edited. Unknown: only ones not synced yet. */
  author?: number | null;
  /**
   * The workspace is read-only (Task 19): as in the old form, Save keeps what was typed in Personal, as new
   * entries of your own, with the workspace's answers written into the notes. `spaceName` names it there.
   */
  readOnly?: boolean;
  spaceName?: string | null;
}

export function useMatchDraft(o: MatchDraftOptions) {
  const { space, season, eventCode, match, teams, template, existing, author, readOnly = false, spaceName = null } = o;
  const label = normalizeMatchLabel(match.label);
  const key = matchDraftKey(space, season, eventCode, match.label, author);
  const [state, setState] = useState(() => ({ key, drafts: readDrafts(key) }));
  // Another match (or space, account, season, event): its own drafts, read from storage at once.
  const drafts = state.key === key ? state.drafts : readDrafts(key);
  useEffect(() => { setState((s) => (s.key === key ? s : { key, drafts: readDrafts(key) })); }, [key]);
  const toPersonal = readOnly && space != null;

  /** Your saved entry for a team when nothing's been changed yet (read-only: none, Save makes Personal copies). */
  const savedEntry = useCallback((team: number) => (toPersonal ? null : yourMatchEntry(existing, { space, eventCode, label, team, author })), [toPersonal, existing, space, eventCode, label, author]);
  /** The entry an edit draft targets, if it's still there (deleted meanwhile: null, and it's saved again as new). */
  const targetOf = useCallback((d: TeamDraft) => (d.uuid ? existing.find((e) => e.uuid === d.uuid && !e.deleted && (e.workspaceId ?? null) === space) ?? null : null), [existing, space]);

  const update = useCallback((team: number, change: (d: TeamDraft) => TeamDraft) => {
    setState((s) => {
      const cur = s.key === key ? s.drafts : readDrafts(key);
      const entry = savedEntry(team);
      // The first change fixes where the draft saves: your saved entry (with its base and template then), else a new one.
      const start: TeamDraft = cur[team] ?? (entry
        ? { data: { ...entry.data }, notes: entry.notes, uuid: entry.uuid, base: scoutDraftBase(entry) ?? null, made: entry.templateId ? { templateId: entry.templateId, templateVersion: entry.templateVersion ?? 0 } : {} }
        : { data: {}, notes: "" });
      const next = { ...cur, [team]: change(start) };
      writeDrafts(key, next);
      return { key, drafts: next };
    });
  }, [key, savedEntry]);

  const setAnswer = useCallback((team: number, id: string, v: ScoutValue) => update(team, (d) => ({
    ...d, data: { ...d.data, [id]: v },
    // A new entry keeps the questions it was first answered with.
    ...(!d.uuid && !d.template ? { template } : {}),
  })), [update, template]);
  /** A team's whole answers record at once, kept as given (the form's "Undo last tap" checks it's the very record it made). */
  const setData = useCallback((team: number, data: Record<string, ScoutValue>) => update(team, (d) => ({
    ...d, data,
    ...(!d.uuid && !d.template ? { template } : {}),
  })), [update, template]);
  const setNotes = useCallback((team: number, notes: string) => update(team, (d) => ({ ...d, notes })), [update]);
  /** Let a team's unsaved changes go: back to the saved entry, or to nothing. */
  const discard = useCallback((team: number) => setState((s) => {
    const cur = { ...(s.key === key ? s.drafts : readDrafts(key)) };
    delete cur[team];
    writeDrafts(key, cur);
    return { key, drafts: cur };
  }), [key]);

  const view = useMemo<TeamState[]>(() => teams.map((w) => {
    const d = drafts[w.team];
    if (!d) {
      const entry = savedEntry(w.team);
      return { watched: w, data: entry ? entry.data : {}, notes: entry?.notes ?? "", status: entry ? "done" : "empty", entry, template };
    }
    const tpl = d.template ?? template, entry = targetOf(d);
    const status: TeamStatus = d.kept ? (sameText(d, d.kept) ? "done" : "started")
      : entry ? (sameText(d, entry) ? "done" : "started")
      : hasAnswers(d.data, d.notes, tpl.fields) ? "started" : "empty";
    return { watched: w, data: d.data, notes: d.notes, status, entry, template: tpl };
  }), [teams, drafts, savedEntry, targetOf, template]);

  /** New teams with nothing entered: Save skips them unless asked to save them anyway. */
  const emptyTeams = useMemo(() => view.filter((t) => t.status === "empty").map((t) => t.watched.team), [view]);

  /**
   * Save every watched team: one entry each, kind "match", at this event and match. An edit goes to the entry it
   * was started on (same uuid, the base and template it had then); new teams with nothing entered are skipped
   * unless `includeEmpty`. Saved teams' drafts are cleared (read-only: kept, marked saved in Personal); on a
   * storage error the rest stay as they are.
   */
  const saveMatch = useCallback((opts: { includeEmpty?: boolean } = {}): MatchSaveResult => {
    const code = eventCode.trim().toUpperCase() || null;
    const builtin = templateFor(season, "match").fields;
    type Plan = { team: number; uuid: string; d: TeamDraft; kept: { data: Record<string, ScoutValue>; notes: string }; made: Made; base?: number | null };
    const plans: Plan[] = [], skipped: number[] = [];
    let unchanged = 0;
    for (const t of view) {
      if (t.status === "done") { unchanged++; continue; }
      if (t.status === "empty" && !opts.includeEmpty) { skipped.push(t.watched.team); continue; }
      const d = drafts[t.watched.team] ?? { data: {}, notes: "" }, tpl = t.template;
      // New: not an edit of a saved entry (a Personal copy saved while read-only is one too, once the workspace is writable).
      const isNew = !d.uuid;
      // A new entry keeps only its template's fields; an edit keeps everything it had (also one whose entry was
      // deleted meanwhile: it's saved as a new entry, answers and all, with the template they were given with).
      const ids = new Set(tpl.fields.map((f) => f.id));
      const data = isNew ? Object.fromEntries(Object.entries(d.data).filter(([k]) => ids.has(k))) : { ...d.data };
      // A counter shows its lowest value until it's touched: that shown value is the answer.
      if (isNew) for (const f of tpl.fields) if (f.type === "counter" && (f.min ?? 0) > 0 && data[f.id] === undefined) data[f.id] = f.min!;
      if (toPersonal) {
        const copy = personalCopy(data, d.notes, (d.template ?? tpl).fields, builtin, spaceName);
        if (copy.overflow) return { ok: false, saved: 0, error: `${t.watched.team}: the workspace's answers are written into the notes in Personal. Shorten its notes by ${copy.overflow} characters so they fit.` };
        plans.push({ team: t.watched.team, uuid: d.kept?.uuid ?? newScoutId(), d: { ...d, data }, kept: { data: copy.data, notes: copy.notes }, made: {} });
        continue;
      }
      const made: Made = space == null ? {} : isNew ? { templateId: tpl.id, templateVersion: tpl.version ?? 0 } : d.made ?? {};
      plans.push({ team: t.watched.team, uuid: t.entry?.uuid ?? newScoutId(), d, kept: { data, notes: d.notes }, made, ...(t.entry ? { base: d.base ?? null } : {}) });
    }
    let saved = 0;
    const done: Plan[] = [];
    try {
      for (const p of plans) {
        saveScoutEntry({
          uuid: p.uuid, season, team: p.team, eventCode: code, matchLabel: label, kind: "match",
          ...p.kept, workspaceId: toPersonal ? null : space, ...p.made,
        }, p.base !== undefined ? { base: p.base } : {});
        saved++; done.push(p);
      }
    } catch (e) {
      settle(done);
      return { ok: false, saved, error: e instanceof ScoutStorageError ? e.message : "Couldn't save this match on this device. Try again." };
    }
    settle(done);
    return { ok: true, saved, unchanged, skipped };

    /** Saved drafts go; read-only, each stays as the Personal copy it was saved to, so a retry never saves it twice. */
    function settle(list: Plan[]) {
      if (!list.length) return;
      setState((s) => {
        const cur = { ...(s.key === key ? s.drafts : readDrafts(key)) };
        for (const p of list) {
          if (toPersonal) cur[p.team] = { data: p.d.data, notes: p.d.notes, ...(p.d.template ? { template: p.d.template } : {}), kept: { uuid: p.uuid, data: p.d.data, notes: p.d.notes } };
          else delete cur[p.team];
        }
        writeDrafts(key, cur);
        return { key, drafts: cur };
      });
    }
  }, [view, drafts, eventCode, season, space, label, toPersonal, spaceName, key]);

  return { teams: view, emptyTeams, toPersonal, setAnswer, setData, setNotes, discard, saveMatch };
}

/** What the toast says after a save: "Saved Q14 · 2 entries. Now Q15." */
export function savedMessage(label: string, r: Extract<MatchSaveResult, { ok: true }>, nextLabel: string | null): string {
  const now = nextLabel ? ` Now ${nextLabel}.` : "";
  if (!r.saved) return r.unchanged ? `${label} was already saved.${now}` : `Nothing saved for ${label}.`;
  return `Saved ${label} · ${r.saved} ${r.saved === 1 ? "entry" : "entries"}.${now}`;
}
