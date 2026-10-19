// The one place that says what a scouting entry's fields may hold (audit PRIVATE-F01, PRIVATE-F02).
// Used at every boundary, on the device and on the server:
//
// - validateScoutEntry: a write. The server sync (/api/me/scout/sync, personal and workspace) and the
//   Settings import accept a row only if every field is the right type and in bounds; a refused row comes
//   back with the reason, nothing of it is stored.
// - repairScoutEntry: a read of a row already stored (localStorage on the device, SQLite on the server),
//   written before these checks existed. It never throws: each bad field is repaired on its own (notes
//   that aren't text become text, answers that aren't values become text, a timestamp nothing could ever
//   supersede becomes 0, so any ordinary edit wins over it) and listed in `repaired`; only a row with no
//   usable identity (uuid, team, season, kind) is skipped, and even that one is left where it is.
//
// Timestamps (updatedAt, baseUpdatedAt, restoredFrom) are milliseconds since 1970: safe integers, never
// negative, and no later than `now` plus CLOCK_SKEW_MS, so a device whose clock runs a little ahead still
// syncs (newer wins) while a value from far in the future (1e300 in the audit) can't lock an entry forever
// or break a date conversion (new Date(1e300).toISOString() throws).

/** How far ahead of the checker's clock a timestamp may be: devices' clocks drift. */
export const CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;
/** Longest notes kept (longer ones are cut, as the server always has). */
export const NOTES_MAX = 4000;
/** Longest an entry's answers may be, as JSON. */
export const DATA_MAX_CHARS = 20_000;
/** Longest event code and match label kept. */
export const LABEL_MAX = 24;
export const SEASON_MIN = 2000;
export const SEASON_MAX = 2100;
export const TEAM_MAX = 999_999;
export const UUID = /^[A-Za-z0-9_-]{8,64}$/;
const TEMPLATE_ID = /^[A-Za-z0-9:_-]{1,100}$/;

export type ScoutAnswer = number | boolean | string;

/** The checked fields of an entry. */
export interface CheckedScoutEntry {
  uuid: string; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit";
  data: Record<string, ScoutAnswer>; notes: string; updatedAt: number; deleted: boolean;
  templateId?: string; templateVersion?: number; baseUpdatedAt?: number; restoredFrom?: number;
}

/** A timestamp an entry may carry: a whole number of milliseconds, never negative, no later than `latest`. */
export function isTimestampUpTo(v: unknown, latest: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= latest;
}

/** Is this a timestamp an entry may be written with, checked at `now` (the allowed clock skew ahead, at most)? */
export const isEntryTimestamp = (v: unknown, now: number): v is number => isTimestampUpTo(v, now + CLOCK_SKEW_MS);

/**
 * The latest timestamp a device accepts when reading what it stored: far enough ahead that a wrong device clock
 * never "repairs" good rows, near enough that 1e300 is caught. The server, whose clock is the reference, reads
 * with now + CLOCK_SKEW_MS (supersedeBound) instead.
 */
export const DEVICE_LATEST = Date.UTC(2100, 0, 1);

const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isAnswer = (v: unknown): v is ScoutAnswer => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const optionalLabel = (v: unknown): string | null | undefined => (v == null ? null : typeof v === "string" ? v.slice(0, LABEL_MAX) : undefined);

/** A short reason per problem, worded for a person (the import lists them). */
export type EntryProblem =
  | "not an entry" | "no valid id" | "bad season" | "bad team number" | "bad kind"
  | "bad timestamp" | "notes not text" | "answers not values" | "answers too long" | "bad event or match";

type Check = { ok: true; entry: CheckedScoutEntry } | { ok: false; uuid: string; problem: EntryProblem };

/**
 * Check an entry being written (a sync push, an import). Every field must already be the right type:
 * nothing is guessed. Absent optional fields take their defaults (no notes: "", no answers: {}).
 */
export function validateScoutEntry(x: unknown, now: number): Check {
  if (!plainObject(x)) return { ok: false, uuid: "", problem: "not an entry" };
  const uuid = typeof x.uuid === "string" ? x.uuid : "";
  const fail = (problem: EntryProblem): Check => ({ ok: false, uuid, problem });
  if (!UUID.test(uuid)) return fail("no valid id");
  const season = intIn(x.season, SEASON_MIN, SEASON_MAX);
  if (season == null) return fail("bad season");
  const team = intIn(x.team, 1, TEAM_MAX);
  if (team == null) return fail("bad team number");
  if (x.kind !== "match" && x.kind !== "pit") return fail("bad kind");
  if (!isEntryTimestamp(x.updatedAt, now)) return fail("bad timestamp");
  if (x.notes != null && typeof x.notes !== "string") return fail("notes not text");
  const eventCode = optionalLabel(x.eventCode), matchLabel = optionalLabel(x.matchLabel);
  if (eventCode === undefined || matchLabel === undefined) return fail("bad event or match");
  const data = x.data == null ? {} : x.data;
  if (!plainObject(data) || !Object.values(data).every((v) => v === null || isAnswer(v))) return fail("answers not values");
  const answers = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as Record<string, ScoutAnswer>;
  if (JSON.stringify(answers).length > DATA_MAX_CHARS) return fail("answers too long");
  return {
    ok: true,
    entry: {
      uuid, season, team, eventCode, matchLabel, kind: x.kind, data: answers, notes: typeof x.notes === "string" ? x.notes.slice(0, NOTES_MAX) : "",
      updatedAt: x.updatedAt, deleted: !!x.deleted,
      ...(typeof x.templateId === "string" && TEMPLATE_ID.test(x.templateId)
        ? { templateId: x.templateId, templateVersion: Number.isSafeInteger(x.templateVersion) && (x.templateVersion as number) >= 0 ? x.templateVersion as number : 0 }
        : {}),
      // References to other versions: one that isn't a real timestamp is let go (the write itself is fine).
      ...(isEntryTimestamp(x.baseUpdatedAt, now) ? { baseUpdatedAt: x.baseUpdatedAt } : {}),
      ...(isEntryTimestamp(x.restoredFrom, now) ? { restoredFrom: x.restoredFrom } : {}),
    },
  };
}

/** A stored value as text, keeping what it said (an object as its JSON). */
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

/** Which fields a read had to repair (empty: the row was fine). */
export type Repaired = ("updatedAt" | "notes" | "data" | "eventCode" | "matchLabel" | "names" | "baseUpdatedAt" | "restoredFrom")[];

/**
 * Read a stored entry (any shape, from an older build or edited by hand) without ever throwing. Returns
 * the row with each bad field repaired, and which ones were, or null when the row has no usable identity
 * (uuid, season, team, kind): the caller skips it and leaves it stored. Fields this doesn't know are kept
 * as they are, so a row that's fine comes back unchanged (the same object shape).
 */
export function repairScoutEntry<T extends Record<string, unknown>>(raw: unknown, latest: number): { entry: T; repaired: Repaired } | null {
  if (!plainObject(raw)) return null;
  const season = intIn(raw.season, SEASON_MIN, SEASON_MAX), team = intIn(raw.team, 1, TEAM_MAX);
  if (typeof raw.uuid !== "string" || !raw.uuid || season == null || team == null || (raw.kind !== "match" && raw.kind !== "pit")) return null;
  const out: Record<string, unknown> = { ...raw };
  const repaired: Repaired = [];
  if (raw.season !== season) out.season = season;
  if (raw.team !== team) out.team = team;
  // A timestamp nothing could supersede, or no date at all: 0, so any real edit (or the server's copy) wins.
  if (!isTimestampUpTo(raw.updatedAt, latest)) { out.updatedAt = 0; repaired.push("updatedAt"); }
  if (typeof raw.notes !== "string") {
    out.notes = raw.notes == null ? "" : asText(raw.notes).slice(0, NOTES_MAX);
    if (raw.notes != null) repaired.push("notes");
  }
  if (!plainObject(raw.data)) {
    // A tombstone may carry no answers at all; anything else that isn't an object is unreadable.
    out.data = {};
    if (raw.data != null) repaired.push("data");
  } else if (!Object.values(raw.data).every((v) => v === null || isAnswer(v))) {
    // Each answer that isn't a value is kept as its text; the rest stay as they are.
    out.data = Object.fromEntries(Object.entries(raw.data).map(([k, v]) => [k, v === null || isAnswer(v) ? v : asText(v)]));
    repaired.push("data");
  }
  for (const k of ["eventCode", "matchLabel"] as const) {
    if (raw[k] != null && typeof raw[k] !== "string") { out[k] = asText(raw[k]).slice(0, LABEL_MAX) || null; repaired.push(k); }
  }
  // Names shown beside an entry (workspace entries): text, or nothing.
  for (const k of ["authorDisplayName", "editorDisplayName"] as const) {
    if (k in raw && raw[k] != null && typeof raw[k] !== "string") { out[k] = asText(raw[k]); if (!repaired.includes("names")) repaired.push("names"); }
  }
  for (const k of ["baseUpdatedAt", "restoredFrom"] as const) {
    if (raw[k] != null && !isTimestampUpTo(raw[k], latest)) { delete out[k]; repaired.push(k); }
  }
  return { entry: out as T, repaired };
}

/** A date for a timestamp, as ISO text, or "" for one no date can show (never throws). */
export function isoOrBlank(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const PROBLEM_ORDER: EntryProblem[] = [
  "not an entry", "no valid id", "bad season", "bad team number", "bad kind", "bad timestamp",
  "notes not text", "answers not values", "answers too long", "bad event or match",
];

/** "notes not text (3), bad team number (1)": the reasons rows were refused, most common first. */
export function problemSummary(problems: EntryProblem[]): string {
  const counts = new Map<EntryProblem, number>();
  for (const p of problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || PROBLEM_ORDER.indexOf(a[0]) - PROBLEM_ORDER.indexOf(b[0]))
    .map(([p, n]) => `${p} (${n})`).join(", ");
}
