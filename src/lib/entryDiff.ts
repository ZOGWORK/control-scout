// Field-level differences between two versions of a scout entry (Task 16): what
// the conflict notice's "View diff" and the History sheet show. Answers are
// labelled with the template each version was made with (an answer only the
// older template had keeps its label), and shown as the form shows them: a
// yes/no left unanswered reads "No", an untouched counter its lowest value.
import type { ScoutField } from "../shared/scoutTemplate";
import type { ScoutValue } from "./scouting";

/** The text of an entry version (an entry, a kept version, or an edit kept on this device). */
export interface EntryText {
  team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit";
  data: Record<string, ScoutValue>; notes: string; deleted?: boolean;
}

export interface DiffRow { key: string; label: string; before: string; after: string }

export const NONE = "—";

/** One answer as the form shows it. */
export function formatAnswer(v: ScoutValue | undefined, f?: Pick<ScoutField, "type" | "min" | "max">): string {
  if (f?.type === "toggle") return v === true ? "Yes" : "No";
  if (f?.type === "counter" && v === undefined) return String(f.min ?? 0);
  if (v === undefined || v === null || v === "") return NONE;
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (f?.type === "rating" && typeof v === "number" && f.max) return `${v} / ${f.max}`;
  return String(v);
}

const text = (v: string | null | undefined) => (v && v.trim() ? v : NONE);

/**
 * Rows for every part that differs, `before` → `after`: whether it's deleted, team, kind, event, match,
 * then each answer (in the order of `after`'s template, then `before`'s, then any answer no template
 * names, by id), then the notes. `fields`: the templates' fields, newest first; the first label found wins.
 */
export function entryDiff(before: EntryText, after: EntryText, fields: ScoutField[][]): DiffRow[] {
  const rows: DiffRow[] = [];
  const add = (key: string, label: string, b: string, a: string) => { if (b !== a) rows.push({ key, label, before: b, after: a }); };
  add("deleted", "Status", before.deleted ? "Deleted" : "Live", after.deleted ? "Deleted" : "Live");
  add("team", "Team", String(before.team), String(after.team));
  add("kind", "Type", before.kind === "pit" ? "Pit" : "Match", after.kind === "pit" ? "Pit" : "Match");
  add("event", "Event", text(before.eventCode), text(after.eventCode));
  add("match", "Match", text(before.matchLabel), text(after.matchLabel));
  const byId = new Map<string, ScoutField>();
  for (const list of fields) for (const f of list) if (!byId.has(f.id)) byId.set(f.id, f);
  const answered = new Set([...Object.keys(before.data ?? {}), ...Object.keys(after.data ?? {})]);
  const ids = [...byId.keys(), ...[...answered].filter((k) => !byId.has(k)).sort()];
  // A deleted version has no answers: compare the answers only between live versions (the status row says the rest).
  if (!before.deleted && !after.deleted) {
    for (const id of ids) {
      const f = byId.get(id);
      // A field neither version answered (and the form shows the same for both) isn't a difference.
      add(`f:${id}`, f?.label ?? id, formatAnswer(before.data?.[id], f), formatAnswer(after.data?.[id], f));
    }
    add("notes", "Notes", text(before.notes), text(after.notes));
  }
  return rows;
}

/** Every answered part of one version (the oldest kept version has nothing before it to compare with). */
export function entrySummary(v: EntryText, fields: ScoutField[][]): DiffRow[] {
  const blank: EntryText = { team: v.team, eventCode: v.eventCode, matchLabel: v.matchLabel, kind: v.kind, data: {}, notes: "", deleted: v.deleted };
  return entryDiff(blank, v, fields).filter((r) => r.after !== NONE);
}
