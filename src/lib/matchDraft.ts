// One match, several teams (the Scout redesign, docs/mockups/scout-redesign.html steps 2–3): a draft of
// answers and notes per watched team, kept while the scout switches tabs, and one Save for the whole match.
// The save follows the old entry form's rules (src/pages/ScoutPage.tsx, EntryForm) team by team: a team you
// already scouted in this match is edited (same uuid, the base it was opened with), never saved twice; new
// entries keep only the template's fields and record the template; a read-only workspace keeps what was typed
// in Personal. Drafts are kept in sessionStorage per space, season, event and match, so a phone that locks or
// reloads mid-match loses nothing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { newScoutId, personalCopy, saveScoutEntry, scoutDraftBase, ScoutStorageError, templateFor, type ScoutEntry, type ScoutSpace, type ScoutValue } from "./scouting";
import type { ScoutField, ScoutTemplate } from "../shared/scoutTemplate";
import { normalizeMatchLabel, type ScheduleMatch, type WatchedTeam } from "../shared/scoutMatch";

/** One team's unsaved work in a match. */
export interface TeamDraft {
  data: Record<string, ScoutValue>;
  notes: string;
  /** The entry this draft edits (yours, in this match), as it was when the first change was made. */
  uuid?: string;
  /** That entry's draft base (scoutDraftBase) when the first change was made: a newer version arriving after is one this save never saw. */
  base?: number | null;
  /** A new entry's template, fixed at its first answer, so a template arriving mid-match never swaps the questions or drops answers. */
  template?: ScoutTemplate;
}

/** empty: nothing entered and nothing saved; started: unsaved answers; done: saved, nothing changed since. */
export type TeamStatus = "empty" | "started" | "done";

export interface TeamState {
  watched: WatchedTeam;
  data: Record<string, ScoutValue>;
  notes: string;
  status: TeamStatus;
  /** Your saved entry for this team in this match (the one Save edits), or null. */
  entry: ScoutEntry | null;
  /** The template a new entry is being filled with (an edit is read with its own: useEntryTemplateState(entry)). */
  template: ScoutTemplate;
}

export type MatchSaveResult =
  | { ok: true; saved: number; /** Teams already saved with nothing changed since. */ unchanged: number; skipped: number[] }
  | { ok: false; saved: number; error: string };

const KEY_PREFIX = "cs-scout-match-draft:";
export const matchDraftKey = (space: ScoutSpace, season: number, eventCode: string, label: string) =>
  `${KEY_PREFIX}${space ?? "personal"}:${season}:${eventCode.trim().toUpperCase()}:${normalizeMatchLabel(label) ?? ""}`;

function readDrafts(key: string): Record<number, TeamDraft> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<number, TeamDraft> = {};
    for (const [t, d] of Object.entries(raw as Record<string, unknown>)) {
      const v = d as Partial<TeamDraft> | null;
      if (!/^\d+$/.test(t) || !v || typeof v !== "object" || !v.data || typeof v.data !== "object" || typeof v.notes !== "string") continue;
      out[Number(t)] = {
        data: v.data as Record<string, ScoutValue>, notes: v.notes,
        ...(typeof v.uuid === "string" ? { uuid: v.uuid } : {}),
        ...(typeof v.base === "number" || v.base === null ? { base: v.base } : {}),
        ...(v.template && Array.isArray(v.template.fields) && typeof v.template.id === "string" ? { template: v.template } : {}),
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
  const key = matchDraftKey(space, season, eventCode, match.label);
  const [state, setState] = useState(() => ({ key, drafts: readDrafts(key) }));
  // Another match (or space, season, event): its own drafts, read from storage at once.
  const drafts = state.key === key ? state.drafts : readDrafts(key);
  useEffect(() => { setState((s) => (s.key === key ? s : { key, drafts: readDrafts(key) })); }, [key]);
  const toPersonal = readOnly && space != null;

  const entryOf = useCallback((team: number) => (toPersonal ? null : yourMatchEntry(existing, { space, eventCode, label, team, author })), [toPersonal, existing, space, eventCode, label, author]);

  const update = useCallback((team: number, change: (d: TeamDraft) => TeamDraft) => {
    setState((s) => {
      const cur = s.key === key ? s.drafts : readDrafts(key);
      const entry = entryOf(team);
      // The first change starts from your saved entry (with the base it had then), else from nothing.
      const start: TeamDraft = cur[team] ?? (entry ? { data: { ...entry.data }, notes: entry.notes, uuid: entry.uuid, base: scoutDraftBase(entry) ?? null } : { data: {}, notes: "" });
      const next = { ...cur, [team]: change(start) };
      writeDrafts(key, next);
      return { key, drafts: next };
    });
  }, [key, entryOf]);

  const setAnswer = useCallback((team: number, id: string, v: ScoutValue) => update(team, (d) => ({
    ...d, data: { ...d.data, [id]: v },
    // A new entry keeps the questions it was first answered with.
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
    const entry = entryOf(w.team), d = drafts[w.team];
    const tpl = d?.template ?? template;
    if (!d) return { watched: w, data: entry ? entry.data : {}, notes: entry?.notes ?? "", status: entry ? "done" : "empty", entry, template: tpl };
    const changed = entry ? !(sameData(d.data, entry.data) && d.notes === entry.notes) : hasAnswers(d.data, d.notes, tpl.fields);
    return { watched: w, data: d.data, notes: d.notes, status: changed ? "started" : entry ? "done" : "empty", entry, template: tpl };
  }), [teams, drafts, entryOf, template]);

  /** New teams with nothing entered: Save skips them unless asked to save them anyway. */
  const emptyTeams = useMemo(() => view.filter((t) => t.status === "empty").map((t) => t.watched.team), [view]);

  /**
   * Save every watched team: one entry each, kind "match", at this event and match. Edits go to your entry
   * (same uuid, with the base the draft was opened on); new teams with nothing entered are skipped unless
   * `includeEmpty`. Saved teams' drafts are cleared; on a storage error the rest stay as they are.
   */
  const saveMatch = useCallback((opts: { includeEmpty?: boolean } = {}): MatchSaveResult => {
    const code = eventCode.trim().toUpperCase() || null;
    const builtin = templateFor(season, "match").fields;
    type Plan = { team: number; entry: ScoutEntry | null; d: TeamDraft; tpl: ScoutTemplate; kept: { data: Record<string, ScoutValue>; notes: string } };
    const plans: Plan[] = [], skipped: number[] = [];
    let unchanged = 0;
    for (const t of view) {
      if (t.status === "done") { unchanged++; continue; }
      if (t.status === "empty" && !opts.includeEmpty) { skipped.push(t.watched.team); continue; }
      const entry = t.entry, d = drafts[t.watched.team] ?? { data: {}, notes: "" };
      const tpl = t.template;
      // A new entry keeps only its template's fields; an edit keeps everything it had (also one whose entry was
      // deleted meanwhile: it's saved as a new entry, answers and all).
      const ids = new Set(tpl.fields.map((f) => f.id));
      const data = entry || d.uuid ? { ...d.data } : Object.fromEntries(Object.entries(d.data).filter(([k]) => ids.has(k)));
      // A counter shows its lowest value until it's touched: that shown value is the answer. Only against the
      // questions the entry was made with (an edit read with a stand-in template is left as it is).
      const sameTemplate = !entry || (entry.templateId ?? "") === (space == null ? "" : tpl.id) && (entry.templateVersion ?? 0) === (space == null ? 0 : tpl.version ?? 0);
      if (sameTemplate) for (const f of tpl.fields) if (f.type === "counter" && (f.min ?? 0) > 0 && data[f.id] === undefined) data[f.id] = f.min!;
      if (toPersonal) {
        const copy = personalCopy(data, d.notes, tpl.fields, builtin, spaceName);
        if (copy.overflow) return { ok: false, saved: 0, error: `${t.watched.team}: the workspace's answers are written into the notes in Personal. Shorten its notes by ${copy.overflow} characters so they fit.` };
        plans.push({ team: t.watched.team, entry: null, d, tpl, kept: { data: copy.data, notes: copy.notes } });
      } else plans.push({ team: t.watched.team, entry, d, tpl, kept: { data, notes: d.notes } });
    }
    let saved = 0;
    const done: number[] = [];
    try {
      for (const p of plans) {
        // Workspace entries record the template they were made with (an edit keeps the entry's own); Personal ones use the built-in.
        const made = space == null || toPersonal ? {}
          : p.entry ? (p.entry.templateId ? { templateId: p.entry.templateId, templateVersion: p.entry.templateVersion ?? 0 } : {})
          : { templateId: p.tpl.id, templateVersion: p.tpl.version ?? 0 };
        // The base this edit was opened on: the draft's own when it was started on this entry, else the entry's now.
        const base = p.entry ? (p.d.uuid === p.entry.uuid && p.d.base !== undefined ? p.d.base : scoutDraftBase(p.entry) ?? null) : undefined;
        saveScoutEntry({
          uuid: p.entry?.uuid ?? newScoutId(), season, team: p.team, eventCode: code, matchLabel: label, kind: "match",
          ...p.kept, workspaceId: toPersonal ? null : space, ...made,
        }, p.entry ? { base } : {});
        saved++; done.push(p.team);
      }
    } catch (e) {
      clear(done);
      return { ok: false, saved, error: e instanceof ScoutStorageError ? e.message : "Couldn't save this match on this device. Try again." };
    }
    clear(done);
    return { ok: true, saved, unchanged, skipped };

    function clear(teamsSaved: number[]) {
      if (!teamsSaved.length) return;
      setState((s) => {
        const cur = { ...(s.key === key ? s.drafts : readDrafts(key)) };
        for (const t of teamsSaved) delete cur[t];
        writeDrafts(key, cur);
        return { key, drafts: cur };
      });
    }
  }, [view, drafts, eventCode, season, space, label, toPersonal, spaceName, key]);

  return { teams: view, emptyTeams, toPersonal, setAnswer, setNotes, discard, saveMatch };
}

/** What the toast says after a save: "Saved Q14 · 2 entries. Now Q15." */
export function savedMessage(label: string, r: Extract<MatchSaveResult, { ok: true }>, nextLabel: string | null): string {
  const now = nextLabel ? ` Now ${nextLabel}.` : "";
  if (!r.saved) return r.unchanged ? `${label} was already saved.${now}` : `Nothing saved for ${label}.`;
  return `Saved ${label} · ${r.saved} ${r.saved === 1 ? "entry" : "entries"}.${now}`;
}
