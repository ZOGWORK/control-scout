// Scout templates: the fields a match or pit entry asks for. Shared by the web
// app (the built-in defaults in src/lib/scouting.ts, the new-entry form, the
// template editor) and the server (a workspace's custom template, validated
// field by field before it's stored: server/scout/templates.ts).
//
// Validation is cleanValue's spirit (src/shared/personal.ts): numbers are
// clamped, unknown properties are dropped, and one bad field is dropped on its
// own; the rest of the template is never thrown away because of it.

export type FieldType = "counter" | "toggle" | "choice" | "rating" | "text";
export type FieldPhase = "auto" | "teleop" | "endgame" | "overall" | "pit";
export type TemplateKind = "match" | "pit";
/**
 * One field of a template. `max`: a counter's ceiling, a rating's number of
 * steps. `min`: a counter's floor (0 when absent). `options`: a choice's options.
 */
export interface ScoutField { id: string; label: string; type: FieldType; phase: FieldPhase; options?: string[]; min?: number; max?: number }
/**
 * A template as the form uses it. `id`: "match-<season>" / "pit" for the
 * built-in defaults, "ws:<workspace>:<season>:<kind>" for a workspace's own.
 * `version`: 0 for the built-in defaults, else the workspace template's
 * version for that season (it goes up on every admin change).
 */
export interface ScoutTemplate { id: string; kind: TemplateKind; name: string; fields: ScoutField[]; version?: number }

export const FIELD_TYPES: readonly FieldType[] = ["counter", "toggle", "choice", "rating", "text"];
export const MATCH_PHASES: readonly FieldPhase[] = ["auto", "teleop", "endgame", "overall"];
export const PIT_PHASES: readonly FieldPhase[] = ["pit"];
export const ALL_PHASES: readonly FieldPhase[] = [...MATCH_PHASES, ...PIT_PHASES];
export const phasesFor = (kind: TemplateKind) => (kind === "pit" ? PIT_PHASES : MATCH_PHASES);
export const phaseLabel = (p: FieldPhase) => (p === "teleop" ? "TeleOp" : p[0].toUpperCase() + p.slice(1));
export const FIELD_TYPE_LABEL: Record<FieldType, string> = { counter: "Counter", toggle: "Yes / no", choice: "Choice", rating: "Rating", text: "Text" };

/** Limits a stored template keeps to (the editor uses the same ones). */
export const TEMPLATE_LIMITS = {
  fields: 60, label: 60, id: 40, options: 12, option: 40,
  counterMax: 999, counterDefaultMax: 99, ratingMin: 2, ratingMax: 10, ratingDefault: 5,
} as const;

const FIELD_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The id of a workspace's template for one season and kind (what entries record). */
export const workspaceTemplateId = (workspaceId: string, season: number, kind: TemplateKind) => `ws:${workspaceId}:${season}:${kind}`;
/** The workspace a template id belongs to, or null for a built-in one. */
export function parseWorkspaceTemplateId(id: unknown): { workspaceId: string; season: number; kind: TemplateKind } | null {
  if (typeof id !== "string") return null;
  const m = /^ws:([A-Za-z0-9_-]{1,64}):(\d{4}):(match|pit)$/.exec(id);
  return m ? { workspaceId: m[1], season: Number(m[2]), kind: m[3] as TemplateKind } : null;
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Why a field was dropped (said back to the admin who saved it). */
export interface DroppedField { index: number; id?: string; reason: string }

/**
 * One field, cleaned for a template of `kind`: null if it can't be used at
 * all (no usable id, label or type, a phase that doesn't belong to the kind, a
 * choice with fewer than two options). Everything else is fixed up: numbers
 * clamped, text trimmed, unknown properties dropped.
 */
export function cleanField(x: unknown, kind: TemplateKind): { field: ScoutField } | { reason: string } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { reason: "not a field" };
  const f = x as Record<string, unknown>;
  const id = typeof f.id === "string" ? f.id.trim() : "";
  if (!id || id.length > TEMPLATE_LIMITS.id || !FIELD_ID.test(id)) return { reason: "bad id" };
  const label = cleanText(f.label, TEMPLATE_LIMITS.label);
  if (!label) return { reason: "no label" };
  if (!FIELD_TYPES.includes(f.type as FieldType)) return { reason: "unknown type" };
  const type = f.type as FieldType;
  if (!phasesFor(kind).includes(f.phase as FieldPhase)) return { reason: "phase doesn't fit this kind" };
  const phase = f.phase as FieldPhase;
  const out: ScoutField = { id, label, type, phase };
  if (type === "counter") {
    const max = clampInt(f.max, 1, TEMPLATE_LIMITS.counterMax, TEMPLATE_LIMITS.counterDefaultMax);
    const min = clampInt(f.min, 0, max - 1, 0);
    out.max = max;
    if (min > 0) out.min = min;
  } else if (type === "rating") {
    out.max = clampInt(f.max, TEMPLATE_LIMITS.ratingMin, TEMPLATE_LIMITS.ratingMax, TEMPLATE_LIMITS.ratingDefault);
  } else if (type === "choice") {
    const seen = new Set<string>();
    const options = (Array.isArray(f.options) ? f.options : [])
      .map((o) => cleanText(o, TEMPLATE_LIMITS.option))
      .filter((o) => o && !seen.has(o.toLowerCase()) && !!seen.add(o.toLowerCase()))
      .slice(0, TEMPLATE_LIMITS.options);
    if (options.length < 2) return { reason: "a choice needs at least two options" };
    out.options = options;
  }
  return { field: out };
}

/**
 * A whole field list, cleaned field by field: bad fields are dropped (and
 * reported), a repeated id keeps its first field, and the list is cut at
 * TEMPLATE_LIMITS.fields. Never throws; anything that isn't a list is empty.
 */
export function cleanFields(raw: unknown, kind: TemplateKind): { fields: ScoutField[]; dropped: DroppedField[] } {
  const fields: ScoutField[] = [];
  const dropped: DroppedField[] = [];
  if (!Array.isArray(raw)) return { fields, dropped };
  const ids = new Set<string>();
  raw.forEach((x, index) => {
    const id = typeof (x as { id?: unknown })?.id === "string" ? (x as { id: string }).id : undefined;
    if (fields.length >= TEMPLATE_LIMITS.fields) { dropped.push({ index, id, reason: `more than ${TEMPLATE_LIMITS.fields} fields` }); return; }
    const r = cleanField(x, kind);
    if ("reason" in r) { dropped.push({ index, id, reason: r.reason }); return; }
    if (ids.has(r.field.id)) { dropped.push({ index, id, reason: "repeated id" }); return; }
    ids.add(r.field.id);
    fields.push(r.field);
  });
  return { fields, dropped };
}

/**
 * A workspace's template for one season, as the API sends it. `match`/`pit`
 * null: that kind uses the built-in default. `version` 0: never customised.
 * `settingsVersion`: the workspace's settings version (bumped by every admin
 * change to any season), for caches.
 */
export interface WorkspaceTemplate {
  workspaceId: string;
  season: number;
  version: number;
  settingsVersion: number;
  match: ScoutField[] | null;
  pit: ScoutField[] | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A field id for a new field: not one of `taken`. */
export function newFieldId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (let i = 0; ; i++) {
    const id = `f${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}${i >= 20 ? i : ""}`;
    if (!used.has(id)) return id;
  }
}
