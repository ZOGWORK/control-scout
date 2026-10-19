// A workspace's shared pick list (Task 11; docs/picklist.md), shared by the server and the web app:
// the shapes, the operations and the one function that applies an operation to a list, so the server
// (which decides) and the device (which shows its own changes at once) order teams exactly alike.
//
// Ordering: the server applies operations one at a time per workspace, in the order they arrive, and
// numbers the list 1..n after each. Operations say what the member meant, not where things were on
// their screen: "move 18360 to just before 7393" or "just after 7393", never "to index 3". A team dragged
// up is anchored to the team it now sits above (beforeTeam); one dragged down, to the team it now sits
// below (afterTeam): the last team it passed, which is what the member was looking at. So two members
// reordering at once both get their move, in arrival order, instead of one of them being bounced; moves
// of different teams usually give the same list whichever arrives first; and every device that applies
// the same operations in the same order gets the same list. An operation that names a team that's no
// longer on the list (removed meanwhile) can't mean anything: the server answers 409 with the current
// list, and the device drops it and fetches the list again.

/** The most teams one list holds (the stats request for the rows covers up to 100 teams). */
export const MAX_PICKS = 100;
export const MAX_PICK_NOTE = 500;
/** How many teams one "copy from my shortlist" may bring. */
export const MAX_IMPORT = MAX_PICKS;

export interface PickPerson { accountId: number | null; name: string }

export interface Pick {
  team: number;
  /** 1-based place in the list. */
  rank: number;
  addedBy: PickPerson;
  /** ms */
  addedAt: number;
  /** The shared note ("" when none): last write wins. */
  note: string;
  noteBy: PickPerson | null;
  /** ms; null when no note was ever written. */
  noteUpdatedAt: number | null;
}

export interface PickList {
  workspaceId: string;
  season: number;
  /** Bumped by every change; a newer version always replaces an older one on the device. */
  version: number;
  picks: Pick[];
}

export type PickOp =
  /** restore: an Undo of a remove; the server brings back the pick as it was (who added it, its note). */
  | { op: "add"; team: number; beforeTeam?: number | null; restore?: boolean }
  | { op: "remove"; team: number }
  /** Just before beforeTeam (null: to the end), or just after afterTeam when that's given instead. */
  | { op: "move"; team: number; beforeTeam: number | null; afterTeam?: number }
  /**
   * base: the note's time (noteUpdatedAt; null: never noted) this note was written over. Given (a note
   * a device kept across a reload, or a retry of one), the server refuses it (409) when the note has
   * changed since and says something else, so an older note never replaces a teammate's newer one.
   * Left out: last write wins.
   */
  | { op: "note"; team: number; note: string; base?: number | null }
  | { op: "import"; teams: number[] };

/** The server's 409 message for a based note op refused because the note changed since (noteConflicts). */
export const NOTE_CHANGED = "A teammate changed this note since yours was written, so yours wasn't saved over it.";

/** The note a based note op (see PickOp) would replace has changed since: the server keeps the newer one. */
export const noteConflicts = (pick: Pick, op: { note: string; base?: number | null }) =>
  op.base !== undefined && pick.note !== op.note && (pick.noteUpdatedAt ?? null) !== op.base;

const isTeam = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 1_000_000;

/** A note as the server stores it (cleanPickOp): trimmed, at most MAX_PICK_NOTE characters. */
export const cleanNote = (note: string) => note.trim().slice(0, MAX_PICK_NOTE);

/** An operation from a request body, or the reason it's not one. */
export function cleanPickOp(x: unknown): PickOp | { error: string } {
  const b = x && typeof x === "object" ? x as Record<string, unknown> : {};
  const before = b.beforeTeam;
  if (before !== undefined && before !== null && !isTeam(before)) return { error: "beforeTeam must be a team number or null" };
  if (b.op === "import") {
    if (!Array.isArray(b.teams) || !b.teams.length || b.teams.length > MAX_IMPORT || !b.teams.every(isTeam)) return { error: `teams must be 1 to ${MAX_IMPORT} team numbers` };
    return { op: "import", teams: [...new Set(b.teams as number[])] };
  }
  if (!isTeam(b.team)) return { error: "team must be a team number" };
  switch (b.op) {
    case "add": return { op: "add", team: b.team, beforeTeam: (before as number | null | undefined) ?? null, ...(b.restore === true ? { restore: true } : {}) };
    case "remove": return { op: "remove", team: b.team };
    case "move": {
      const after = b.afterTeam;
      if (after !== undefined) {
        if (!isTeam(after)) return { error: "afterTeam must be a team number" };
        if (before != null) return { error: "give beforeTeam or afterTeam, not both" };
        if (after === b.team) return { error: "a team can't move after itself" };
        return { op: "move", team: b.team, beforeTeam: null, afterTeam: after };
      }
      if (before === undefined) return { error: "beforeTeam (null: to the end) or afterTeam is required" };
      if (before === b.team) return { error: "a team can't move before itself" };
      return { op: "move", team: b.team, beforeTeam: before as number | null };
    }
    case "note":
      if (typeof b.note !== "string") return { error: "note must be text" };
      if (b.base !== undefined && b.base !== null && !(typeof b.base === "number" && Number.isSafeInteger(b.base) && b.base >= 0)) return { error: "base must be a note time or null" };
      return { op: "note", team: b.team, note: cleanNote(b.note), ...(b.base !== undefined ? { base: b.base as number | null } : {}) };
    default: return { error: "op must be add, remove, move, note or import" };
  }
}

/** What applying an operation did. */
export type ApplyResult =
  | { ok: true; picks: Pick[]; changed: boolean; from?: number; to?: number; added?: number[] }
  | { ok: false; reason: "missing" | "full" };

const renumber = (picks: Pick[]) => picks.map((p, i) => (p.rank === i + 1 ? p : { ...p, rank: i + 1 }));

/**
 * Apply one operation to a list (in rank order). `by` and `at` stamp who added a team or wrote a note.
 * Never mutates its input. Idempotent where that's what the member meant: adding a team already on the
 * list or removing one that's gone changes nothing; moving or noting a team that's gone is "missing".
 */
export function applyPickOp(list: readonly Pick[], op: PickOp, by: PickPerson, at: number,
  /** For a restoring add: the pick as it was before its removal (its attribution and note come back with it). */
  previous?: Pick | null): ApplyResult {
  const picks = [...list];
  const idx = (t: number) => picks.findIndex((p) => p.team === t);
  const fresh = (team: number): Pick => ({ team, rank: 0, addedBy: by, addedAt: at, note: "", noteBy: null, noteUpdatedAt: null });
  switch (op.op) {
    case "add": {
      if (idx(op.team) >= 0) return { ok: true, picks: list as Pick[], changed: false };
      if (picks.length >= MAX_PICKS) return { ok: false, reason: "full" };
      // An anchor removed meanwhile: the end (adding is never refused for where it was going).
      const at2 = op.beforeTeam == null ? -1 : idx(op.beforeTeam);
      const pos = at2 < 0 ? picks.length : at2;
      picks.splice(pos, 0, op.restore && previous?.team === op.team ? { ...previous, rank: 0 } : fresh(op.team));
      return { ok: true, picks: renumber(picks), changed: true, to: pos + 1, added: [op.team] };
    }
    case "import": {
      const have = new Set(picks.map((p) => p.team));
      const added: number[] = [];
      for (const t of op.teams) {
        if (have.has(t)) continue;
        if (picks.length >= MAX_PICKS) break;
        picks.push(fresh(t)); have.add(t); added.push(t);
      }
      return { ok: true, picks: renumber(picks), changed: added.length > 0, added };
    }
    case "remove": {
      const i = idx(op.team);
      if (i < 0) return { ok: true, picks: list as Pick[], changed: false };
      picks.splice(i, 1);
      return { ok: true, picks: renumber(picks), changed: true, from: i + 1 };
    }
    case "move": {
      const i = idx(op.team);
      const anchor = op.afterTeam ?? op.beforeTeam;
      if (i < 0 || (anchor != null && idx(anchor) < 0)) return { ok: false, reason: "missing" };
      const [p] = picks.splice(i, 1);
      const j = op.afterTeam != null ? idx(op.afterTeam) + 1 : op.beforeTeam == null ? picks.length : idx(op.beforeTeam);
      picks.splice(j, 0, p);
      return { ok: true, picks: renumber(picks), changed: i !== j, from: i + 1, to: j + 1 };
    }
    case "note": {
      const i = idx(op.team);
      if (i < 0) return { ok: false, reason: "missing" };
      if (picks[i].note === op.note) return { ok: true, picks: list as Pick[], changed: false };
      picks[i] = { ...picks[i], note: op.note, noteBy: by, noteUpdatedAt: at };
      return { ok: true, picks, changed: true };
    }
  }
}

/**
 * The move that turns `before` into `after` for `team` (as a drag or an arrow key produced it): moved up,
 * just before the team now below it; moved down, just after the team now above it.
 */
export function moveOpFor(before: readonly number[], after: readonly number[], team: number): PickOp {
  const from = before.indexOf(team), to = after.indexOf(team);
  if (to > from && to > 0) return { op: "move", team, beforeTeam: null, afterTeam: after[to - 1] };
  return { op: "move", team, beforeTeam: to + 1 < after.length ? after[to + 1] : null };
}

/** A valid-looking list (the stream and the API are ours, but a bad one must never break the page). */
export function isPickList(x: unknown): x is PickList {
  const l = x as PickList;
  return !!l && typeof l.workspaceId === "string" && Number.isSafeInteger(l.season) && Number.isSafeInteger(l.version) && Array.isArray(l.picks)
    && l.picks.every((p) => !!p && isTeam(p.team) && typeof p.note === "string" && !!p.addedBy);
}
