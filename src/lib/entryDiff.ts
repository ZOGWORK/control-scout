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

/**
 * `beforeEmpty` / `afterEmpty`: that side has nothing (shown as NONE). Set only when true, and kept apart from the
 * text so a value someone actually saved as "—" is never mistaken for an empty one.
 */
export interface DiffRow { key: string; label: string; before: string; after: string; beforeEmpty?: true; afterEmpty?: true }

export const NONE = "—";

/** One answer as the form shows it. */
/** True when formatAnswer would show NONE because there's no answer (not because the answer is a literal "—"). */
const noAnswer = (v: ScoutValue | undefined, f?: Pick<ScoutField, "type">) =>
  f?.type !== "toggle" && !(f?.type === "counter" && v === undefined) && (v === undefined || v === null || v === "");

export function formatAnswer(v: ScoutValue | undefined, f?: Pick<ScoutField, "type" | "min" | "max">): string {
  if (f?.type === "toggle") return v === true ? "Yes" : "No";
  if (f?.type === "counter" && v === undefined) return String(f.min ?? 0);
  if (v === undefined || v === null || v === "") return NONE;
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (f?.type === "rating" && typeof v === "number" && f.max) return `${v} / ${f.max}`;
  return String(v);
}

const blank = (v: string | null | undefined) => !(v && v.trim());
const text = (v: string | null | undefined) => (blank(v) ? NONE : v!);

/**
 * Rows for every part that differs, `before` → `after`: whether it's deleted, team, kind, event, match,
 * then each answer (in the order of `after`'s template, then `before`'s, then any answer no template
 * names, by id), then the notes. `beforeFields` / `afterFields`: each version's own template, so each side
 * reads as it did when it was written (a rating scale changed since keeps its old "of"); the label is the
 * newer one's.
 */
export function entryDiff(before: EntryText, after: EntryText, beforeFields: ScoutField[], afterFields: ScoutField[] = beforeFields): DiffRow[] {
  const rows: DiffRow[] = [];
  const add = (key: string, label: string, b: string, a: string, bEmpty = false, aEmpty = false) => {
    if (b !== a || bEmpty !== aEmpty) rows.push({ key, label, before: b, after: a, ...(bEmpty && { beforeEmpty: true as const }), ...(aEmpty && { afterEmpty: true as const }) });
  };
  add("deleted", "Status", before.deleted ? "Deleted" : "Live", after.deleted ? "Deleted" : "Live");
  add("team", "Team", String(before.team), String(after.team));
  add("kind", "Type", before.kind === "pit" ? "Pit" : "Match", after.kind === "pit" ? "Pit" : "Match");
  add("event", "Event", text(before.eventCode), text(after.eventCode), blank(before.eventCode), blank(after.eventCode));
  add("match", "Match", text(before.matchLabel), text(after.matchLabel), blank(before.matchLabel), blank(after.matchLabel));
  const oldDefs = new Map(beforeFields.map((f) => [f.id, f])), newDefs = new Map(afterFields.map((f) => [f.id, f]));
  const known = [...new Set([...newDefs.keys(), ...oldDefs.keys()])];
  const answered = new Set([...Object.keys(before.data ?? {}), ...Object.keys(after.data ?? {})]);
  const ids = [...known, ...[...answered].filter((k) => !newDefs.has(k) && !oldDefs.has(k)).sort()];
  // A deleted version has no answers: its side reads empty, so the live side shows everything it holds (what a restore brings back).
  const bData = before.deleted ? {} : before.data ?? {}, aData = after.deleted ? {} : after.data ?? {};
  for (const id of ids) {
    const fb = oldDefs.get(id) ?? newDefs.get(id), fa = newDefs.get(id) ?? oldDefs.get(id);
    // A field neither version answered (and the form shows the same for both) isn't a difference.
    add(`f:${id}`, fa?.label ?? id, formatAnswer(bData[id], fb), formatAnswer(aData[id], fa), noAnswer(bData[id], fb), noAnswer(aData[id], fa));
  }
  const bNotes = before.deleted ? "" : before.notes, aNotes = after.deleted ? "" : after.notes;
  add("notes", "Notes", text(bNotes), text(aNotes), blank(bNotes), blank(aNotes));
  return rows;
}

/** Every answered part of one version (the oldest kept version has nothing before it to compare with). */
export function entrySummary(v: EntryText, fields: ScoutField[]): DiffRow[] {
  const empty: EntryText = { team: v.team, eventCode: v.eventCode, matchLabel: v.matchLabel, kind: v.kind, data: {}, notes: "", deleted: v.deleted };
  return entryDiff(empty, v, fields).filter((r) => !r.afterEmpty);
}
