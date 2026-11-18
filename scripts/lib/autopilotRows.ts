// The clip autopilot's checks on the rows the frame reader writes (scripts/clip-autopilot.ts): no row ships unless it
// keeps the reader's strict rules, read off the row itself against the one the live site serves now. And how the rows
// that pass go out: applied to main's season file, in data PRs of at most 15 KB each.
//
// The rules (docs/frame-timings.md):
//   - every start is plausible: inside the order, a match apart (plausibleStarts, the server's own reading);
//   - every start the read placed or moved has its opening checked: the clip opens 20, 12, 5, 2 or 0 s before it (or 2 or 4 s after it),
//     where a paused frame named the match (`opens`). A live clip whose opening frame named nothing may stay
//     `unconfirmed`, never a new one;
//   - a clip the live site plays leaves only when a frame names another match there ("its clip's first frame shows
//     Q7, not Q6", the reader's review): a frame that names nothing never pulls one;
//   - a re-read row carries a newer `checked` date than the live one.
import { plausibleStarts, playableStarts, type FrameTiming } from "../../server/data/frameTimings.js";
import { OPEN_LEADS, OPEN_LEADS_TEXT, SAME_S, dataRows, leadText } from "./videoFrames.js";

export type Row = FrameTiming;
/** Any data row keyed by its video and event: a frame timing, or a first-frame clip check (server/data/clipChecks.ts). */
export type Keyed = { videoId: string; code: string };
export const rowKey = (r: Keyed) => `${r.videoId}|${r.code}`;
/** A row as its file holds it: one line. */
export const rowLine = (r: Keyed) => `  ${JSON.stringify(r)},`;

/** The review reason that pulls a live clip: a frame at its opening names another match. */
const PULLED = /^its clip's first frame shows (.+), not (.+)$/;
/** Whether a review reason is the reader's pull of this match: its opening frame names a different match. */
const namesAnother = (label: string, why: string | undefined) => { const m = PULLED.exec(why ?? ""); return !!m && m[2] === label && m[1] !== label; };
/** A calendar date, YYYY-MM-DD, that exists ("2026-02-30" doesn't). */
const isDate = (s: string) => {
  const t = /^\d{4}-\d\d-\d\d$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** What's wrong with a row the reader wrote, against the row the live site serves for that video and event (none: a
 *  new one). `order`: the event's played matches in the order they were played (by their real starts), for the order
 *  check. Empty: it can ship. */
export function rowProblems(next: Row, live?: Row, order?: string[]): string[] {
  const out: string[] = [];
  if (!isDate(next.checked)) out.push(`checked "${next.checked}" isn't a date`);
  if (live && JSON.stringify(live) !== JSON.stringify(next) && !(next.checked > live.checked)) out.push(`changed without a newer checked date than the live row's (${live.checked})`);
  for (const [l, t] of Object.entries(next.starts)) if (!Number.isInteger(t) || t < 0) out.push(`${l}: start ${t} isn't a second in the video`);
  for (const [l, t] of Object.entries(next.opens ?? {})) if (!Number.isInteger(t) || t < 0) out.push(`${l}: opening ${t} isn't a second in the video`);
  const plausible = plausibleStarts(next.starts, next.opens);
  for (const l of Object.keys(next.starts)) if (plausible[l] == null) out.push(`${l}: its start overlaps another match's`);
  // In the order the matches were played (their real starts: a match played late, a replay, keeps its place in time,
  // not its number's), as the reader judges them.
  if (order) {
    const at = new Map(order.map((l, i) => [l, i]));
    for (const l of Object.keys(next.starts)) if (!at.has(l)) out.push(`${l}: not a match the event played`);
    const byOrder = Object.entries(next.starts).filter(([l]) => at.has(l)).sort((a, b) => at.get(a[0])! - at.get(b[0])!);
    for (let i = 1; i < byOrder.length; i++) if (byOrder[i][1] <= byOrder[i - 1][1]) out.push(`${byOrder[i][0]}: starts before ${byOrder[i - 1][0]}, out of the order they were played`);
  }
  const was = live ? live.starts : {};
  if (live?.opens && !next.opens) out.push("openings the live row checked are gone");
  for (const [l, t] of Object.entries(next.starts)) {
    // A start the live site already plays where it was, its opening as the live row has it (none, on an older row):
    // stands. A new or moved opening is checked like any other.
    const open = next.opens?.[l];
    if (was[l] != null && Math.abs(was[l] - t) <= SAME_S && (open == null || open === live?.opens?.[l])) {
      if (next.opens && open == null && !next.unconfirmed?.includes(l)) out.push(`${l}: a live clip left with no opening and not unconfirmed`);
      continue;
    }
    if (open != null) {
      if (!OPEN_LEADS.includes(t - open)) out.push(`${l}: opens ${leadText(t - open)}, not ${OPEN_LEADS_TEXT}`);
    } else if (!next.unconfirmed?.includes(l)) out.push(`${l}: no opening frame checked for it`);
  }
  // Unconfirmed only ever a live clip, at its live second, whose opening named nothing (so none checked for it).
  for (const l of next.unconfirmed ?? []) {
    const t = next.starts[l];
    if (t == null || was[l] == null || Math.abs(was[l] - t) > SAME_S) out.push(`${l}: unconfirmed, but not a live clip at that second`);
    else if (next.opens?.[l] != null) out.push(`${l}: unconfirmed, yet its opening is checked`);
  }
  // Live clips: kept (anywhere in starts, a read's slack from where they were), or pulled by a frame naming another match.
  if (live) {
    for (const [l, t] of Object.entries(playableStarts(live))) {
      const now = next.starts[l];
      if (now != null && Math.abs(now - t) <= SAME_S) continue;
      // Pulled at its own live second: the frame read there, not where a re-read placed it.
      const pull = next.review?.[l];
      if (!pull || !Number.isFinite(pull.t) || Math.abs(pull.t - t) > SAME_S || !namesAnother(l, pull.why)) out.push(`${l}: a live clip ${now == null ? "dropped" : "moved"} without a frame naming another match`);
    }
  }
  for (const [l, e] of Object.entries(next.earlyStart ?? {})) if (!(e.previousEnds > e.t)) out.push(`${l}: early start ${e.t} isn't before the previous match's end ${e.previousEnds}`);
  return out;
}

/** The rows of a frame timings file (one per line under its "// --- Data" mark), in file order. */
export const fileRows = <T extends Keyed = Row>(text: string): T[] => dataRows<T>(text);

/** The rows `after` holds that `before` doesn't hold the same (new or changed). */
export function changedRows<T extends Keyed = Row>(before: string, after: string): T[] {
  const was = new Map(fileRows<T>(before).map((r) => [rowKey(r), JSON.stringify(r)]));
  return fileRows<T>(after).filter((r) => was.get(rowKey(r)) !== JSON.stringify(r));
}

/** A season (or clip checks) file with these rows in it: a row of the same video and event replaced on its own line, a
 *  new row put just before the first row whose event code sorts after its own (at the end only when none does), every
 *  other line as it was. Never re-sorted or appended: PRs from different sources each touch only their own rows' lines,
 *  so they don't conflict (owner's rule, 2026-11-17). */
export function applyRows<T extends Keyed>(text: string, rows: T[]): string {
  if (!rows.length) { dataLines(text); return text; }
  const { head, rest, open, close, lines } = dataLines(text);
  const before = new Map<number, T[]>();
  for (const p of rowPlaces(lines, rows)) {
    if (p.replaces) lines[p.at] = rowLine(p.row);
    else (before.get(p.at) ?? before.set(p.at, []).get(p.at)!).push(p.row);
  }
  // Rows put after the last line: that line needs its comma (rowLine writes one; a hand-written last row may lack it).
  let lastRow = lines.length - 1;
  while (lastRow >= 0 && rowOf(lines[lastRow]) == null) lastRow--;
  if (before.has(lines.length) && lastRow >= 0 && !lines[lastRow].trimEnd().endsWith(",")) lines[lastRow] = `${lines[lastRow].trimEnd()},`;
  const out: string[] = [];
  for (let i = 0; i <= lines.length; i++) { for (const r of before.get(i) ?? []) out.push(rowLine(r)); if (i < lines.length) out.push(lines[i]); }
  return `${head}${rest.slice(0, open + 2)}${out.join("\n")}${rest.slice(close)}`;
}
/** A data file split around its rows array: the lines between "[" and "];" ("[\n];", a season not read yet, has none). */
function dataLines(text: string): { head: string; rest: string; open: number; close: number; lines: string[] } {
  const [head, rest] = splitAt(text, "// --- Data");
  const open = rest.indexOf("[\n"), close = rest.lastIndexOf("\n];");
  if (open < 0 || close < 0) throw new Error("no rows array under the data mark");
  const lines = close >= open + 2 ? rest.slice(open + 2, close).split("\n") : [];
  // Only blank lines ("[\n\n];", a season not read yet): none, so the first rows don't sit under a blank line.
  return { head, rest, open, close, lines: lines.every((l) => l.trim() === "") ? [] : lines };
}
const rowOf = (line: string): Keyed | null => { const m = /^\s*(\{.*\}),?\s*$/.exec(line); return m ? (JSON.parse(m[1]) as Keyed) : null; };
/** Where each row goes among the file's lines as they are: replacing its own row's line (`at` that line), or new, in
 *  the gap before the first row whose code sorts after its own (`at` that line; the end when none does). New rows in
 *  the same gap in code, then video, order. One row a key: of rows given twice the last counts; a file holding a key
 *  twice is refused (which copy to replace would be a guess). */
function rowPlaces<T extends Keyed>(lines: string[], rows: T[]): { row: T; at: number; replaces: boolean }[] {
  const at = new Map<string, number>();
  lines.forEach((l, i) => {
    const r = rowOf(l);
    if (!r) return;
    if (at.has(rowKey(r))) throw new Error(`${rowKey(r)} is in the file twice`);
    at.set(rowKey(r), i);
  });
  return [...new Map(rows.map((r) => [rowKey(r), r])).values()].sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId)).map((row) => {
    const i = at.get(rowKey(row));
    if (i != null) return { row, at: i, replaces: true };
    const gap = lines.findIndex((l) => { const o = rowOf(l); return o != null && o.code.localeCompare(row.code) > 0; });
    return { row, at: gap < 0 ? lines.length : gap, replaces: false };
  });
}

/** Rows that must ship in one PR: git conflicts where two branches change lines that overlap or touch, so rows whose
 *  changes on `text` do (a replaced line is lines [i, i+1); a new row before line g, the empty [g, g)) go together.
 *  Groups in file order. Two PRs adding rows into the same gap would conflict; one PR holding them doesn't. */
export function rowGroups<T extends Keyed>(text: string, rows: T[]): T[][] {
  const spans = rowPlaces(dataLines(text).lines, rows).map((p) => ({ row: p.row, start: p.at, end: p.at + (p.replaces ? 1 : 0) })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { end: number; rows: T[] }[] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s.start <= last.end) { last.rows.push(s.row); last.end = Math.max(last.end, s.end); } else out.push({ end: s.end, rows: [s.row] });
  }
  return out.map((g) => g.rows);
}
const splitAt = (s: string, mark: string): [string, string] => { const i = s.indexOf(mark); if (i < 0) throw new Error(`no "${mark}" mark`); return [s.slice(0, i), s.slice(i)]; };

/** Rows in PRs of at most `max` bytes of row lines each: an event's rows stay together (the owner reads them as one),
 *  most first; an event bigger than `max` goes in parts by video, a row bigger than `max` alone. */
export function chunkRows<T extends Keyed>(rows: T[], max = 15_000): T[][] {
  const size = (rs: T[]) => rs.reduce((s, r) => s + Buffer.byteLength(rowLine(r)) + 1, 0);
  const events = new Map<string, T[]>();
  for (const r of rows) (events.get(r.code) ?? events.set(r.code, []).get(r.code)!).push(r);
  const groups = [...events.values()].flatMap((rs) => (size(rs) <= max ? [rs] : rs.map((r) => [r]))).sort((a, b) => size(b) - size(a));
  const out: T[][] = [];
  for (const g of groups) {
    const fit = out.find((c) => size(c) + size(g) <= max);
    if (fit) fit.push(...g); else out.push([...g]);
  }
  return out;
}

/** A diff's file header ("diff --git", index, ---/+++) and each hunk's "@@ -a,b +c,d @@" line, about. */
const FILE_HEADER = 160, HUNK_HEADER = 32;
/** About how big a PR's diff is from `before` to `after` (bytes): every line added or removed, `context` lines either
 *  side of each added one, as git shows them (lines are whole rows, so context counts), each hunk's header and the
 *  file's. 0: no change. */
export function diffBytes(before: string, after: string, context = 3): number {
  const a = before.split("\n"), b = after.split("\n"), had = new Set(a), has = new Set(b);
  const shown = new Set<number>();
  b.forEach((l, i) => { if (!had.has(l)) for (let j = Math.max(0, i - context); j <= Math.min(b.length - 1, i + context); j++) shown.add(j); });
  const removed = a.filter((l) => !has.has(l));
  if (!shown.size && !removed.length) return 0;
  // Hunks: runs of shown lines (a removal sits beside the lines it was replaced by, inside their hunk).
  const idx = [...shown].sort((x, y) => x - y), hunks = Math.max(1, idx.filter((v, k) => k === 0 || v !== idx[k - 1] + 1).length);
  return FILE_HEADER + hunks * HUNK_HEADER + idx.reduce((n, i) => n + Buffer.byteLength(b[i]) + 2, 0) + removed.reduce((n, l) => n + Buffer.byteLength(l) + 2, 0);
}

/** A PR diff Loopy can't review at all: a row whose own diff is bigger never ships (it would never merge, and would hold
 *  its lines from every other PR). */
export const LOOPY_DIFF_MAX = 16_000;

/** A season's rows as data PRs to open now (`ship`), each diff on `text` (main's file) at most `maxDiff` bytes (Loopy
 *  can't review a diff much over 16 KB), none conflicting with another or with an open PR; the rest wait (`later`) for
 *  the next run, on the main those PRs leave. Rows that must go together (rowGroups: changes that touch) never go in
 *  two PRs at once:
 *  - a group touching an open PR's rows (`held`, as main's file would get them) waits whole, a row the open PR also
 *    changes included;
 *  - a group whose diff is over the cap (new rows sharing one gap in a sparse file) ships its first whole events, in
 *    file order, up to the first that doesn't fit (or, when its first event alone doesn't, that event's first rows up to
 *    the first that doesn't), and the rest wait;
 *  - other groups are packed in file order while the PR's diff fits.
 *  A row over the cap alone ships alone (nothing smaller can carry it), unless its own diff is over LOOPY_DIFF_MAX: then
 *  it never ships (`tooBig`, for the owner), and is set aside before the groups are made, so it holds no lines and
 *  never stops the rows sharing its gap. */
export function prChunks<T extends Keyed>(text: string, rows: T[], maxDiff = 12_000, held: Keyed[] = []): { ship: T[][]; later: T[]; tooBig: T[] } {
  const heldKeys = new Set(held.map(rowKey)), ship: T[][] = [], later: T[] = [], tooBig: T[] = [];
  const size = (rs: T[]) => diffBytes(text, applyRows(text, rs)), fits = (rs: T[]) => size(rs) <= maxDiff;
  later.push(...rows.filter((r) => heldKeys.has(rowKey(r))));
  // A row Loopy can't review on its own never ships, so it takes no part in the groups: otherwise it would join the
  // new rows of its gap and, first in an over-cap group, leave the rest waiting behind it on every run.
  const free: T[] = [];
  for (const r of rows) if (!heldKeys.has(rowKey(r))) (size([r]) > LOOPY_DIFF_MAX ? tooBig : free).push(r);
  for (const group of rowGroups(text, [...free, ...held] as T[])) {
    const g = group.filter((r) => !heldKeys.has(rowKey(r)));
    if (g.length < group.length) { later.push(...g); continue; }
    if (!fits(g)) {
      // Whole events while they fit; else the first event's rows while they fit. Never past the first that doesn't.
      const events: T[][] = [];
      for (const r of g) { const last = events.at(-1); if (last && last[0].code === r.code) last.push(r); else events.push([r]); }
      const piece: T[] = [];
      for (const e of events) { if (fits([...piece, ...e])) piece.push(...e); else break; }
      if (!piece.length) for (const r of events[0]) { if (!piece.length || fits([...piece, r])) piece.push(r); else break; }
      const shipped = new Set(piece.map(rowKey));
      later.push(...g.filter((r) => !shipped.has(rowKey(r))));
      ship.push(piece);
      continue;
    }
    const cur = ship.at(-1);
    if (cur && fits([...cur, ...g])) cur.push(...g); else ship.push([...g]);
  }
  return { ship, later, tooBig };
}

/** The mark an autopilot PR carries in its description: its season, rows (video|event) and, for a file other than the
 *  season's frame timings (the first-frame sweep's server/data/clipChecks.ts), that file. For the runner's next pass: an
 *  event already in an open PR isn't read again, and the PR is rebuilt on main when main moves. */
export const prMarker = (season: number, rows: Keyed[], file?: string) => `<!-- clip-autopilot ${JSON.stringify({ season, rows: rows.map(rowKey), ...(file ? { file } : {}) })} -->`;
export function readMarker(body: string): { season: number; rows: string[]; file?: string } | null {
  const m = /<!-- clip-autopilot (\{.*?\}) -->/.exec(body);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return Number.isInteger(v.season) && Array.isArray(v.rows) ? { season: v.season, rows: v.rows.map(String), ...(typeof v.file === "string" ? { file: v.file } : {}) } : null;
  } catch { return null; }
}
