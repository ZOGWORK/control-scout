// The clip autopilot's checks on the rows the frame reader writes (scripts/clip-autopilot.ts): no row ships unless it
// keeps the reader's strict rules, read off the row itself against the one the live site serves now. And how the rows
// that pass go out: applied to main's season file, in data PRs of at most 15 KB each.
//
// The rules (docs/frame-timings.md):
//   - every start is plausible: inside the order, a match apart (plausibleStarts, the server's own reading);
//   - every start the read placed or moved has its opening checked: the clip opens 20, 12, 5, 2 or 0 s before it,
//     where a paused frame named the match (`opens`). A live clip whose opening frame named nothing may stay
//     `unconfirmed`, never a new one;
//   - a clip the live site plays leaves only when a frame names another match there ("its clip's first frame shows
//     Q7, not Q6", the reader's review): a frame that names nothing never pulls one;
//   - a re-read row carries a newer `checked` date than the live one.
import { plausibleStarts, playableStarts, type FrameTiming } from "../../server/data/frameTimings.js";
import { OPEN_LEADS, SAME_S, dataRows } from "./videoFrames.js";

export type Row = FrameTiming;
export const rowKey = (r: Pick<Row, "videoId" | "code">) => `${r.videoId}|${r.code}`;
/** A row as its file holds it: one line. */
export const rowLine = (r: Row) => `  ${JSON.stringify(r)},`;

/** The review reason that pulls a live clip: a frame at its opening names another match. */
const NAMES_ANOTHER = /^its clip's first frame shows .+, not /;
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
      if (!OPEN_LEADS.includes(t - open)) out.push(`${l}: opens ${t - open} s before its start, not ${OPEN_LEADS.join("/")}`);
    } else if (next.unconfirmed?.includes(l)) {
      if (was[l] == null || Math.abs(was[l] - t) > SAME_S) out.push(`${l}: unconfirmed, but not a live clip at that second`);
    } else out.push(`${l}: no opening frame checked for it`);
  }
  // Live clips: kept (anywhere in starts, a read's slack from where they were), or pulled by a frame naming another match.
  if (live) {
    for (const [l, t] of Object.entries(playableStarts(live))) {
      const now = next.starts[l];
      if (now != null && Math.abs(now - t) <= SAME_S) continue;
      if (!NAMES_ANOTHER.test(next.review?.[l]?.why ?? "")) out.push(`${l}: a live clip ${now == null ? "dropped" : "moved"} without a frame naming another match`);
    }
  }
  for (const [l, e] of Object.entries(next.earlyStart ?? {})) if (!(e.previousEnds > e.t)) out.push(`${l}: early start ${e.t} isn't before the previous match's end ${e.previousEnds}`);
  return out;
}

/** The rows of a frame timings file (one per line under its "// --- Data" mark), in file order. */
export const fileRows = (text: string): Row[] => dataRows<Row>(text);

/** The rows `after` holds that `before` doesn't hold the same (new or changed). */
export function changedRows(before: string, after: string): Row[] {
  const was = new Map(fileRows(before).map((r) => [rowKey(r), JSON.stringify(r)]));
  return fileRows(after).filter((r) => was.get(rowKey(r)) !== JSON.stringify(r));
}

/** A frame timings file with these rows in it (each replacing the row of its video and event, or added), every other
 *  row and line as it was, sorted as the reader sorts them (event, then video). */
export function applyRows(text: string, rows: Row[]): string {
  const [head, rest] = splitAt(text, "// --- Data");
  const open = rest.indexOf("[\n"), close = rest.lastIndexOf("\n];");
  if (open < 0 || close < 0) throw new Error("no rows array under the data mark");
  const byKey = new Map(fileRows(text).map((r) => [rowKey(r), r]));
  for (const r of rows) byKey.set(rowKey(r), r);
  if (!byKey.size) return text;
  const list = [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId));
  return `${head}${rest.slice(0, open + 2)}${list.map(rowLine).join("\n")}${rest.slice(close)}`;
}
const splitAt = (s: string, mark: string): [string, string] => { const i = s.indexOf(mark); if (i < 0) throw new Error(`no "${mark}" mark`); return [s.slice(0, i), s.slice(i)]; };

/** Rows in PRs of at most `max` bytes of row lines each: an event's rows stay together (the owner reads them as one),
 *  most first; an event bigger than `max` goes in parts by video, a row bigger than `max` alone. */
export function chunkRows(rows: Row[], max = 15_000): Row[][] {
  const size = (rs: Row[]) => rs.reduce((s, r) => s + Buffer.byteLength(rowLine(r)) + 1, 0);
  const events = new Map<string, Row[]>();
  for (const r of rows) (events.get(r.code) ?? events.set(r.code, []).get(r.code)!).push(r);
  const groups = [...events.values()].flatMap((rs) => (size(rs) <= max ? [rs] : rs.map((r) => [r]))).sort((a, b) => size(b) - size(a));
  const out: Row[][] = [];
  for (const g of groups) {
    const fit = out.find((c) => size(c) + size(g) <= max);
    if (fit) fit.push(...g); else out.push([...g]);
  }
  return out;
}

/** The mark an autopilot PR carries in its description: its season and rows (video|event), for the runner's next pass
 *  (an event already in an open PR isn't read again; the PR is rebuilt on main when main moves). */
export const prMarker = (season: number, rows: Row[]) => `<!-- clip-autopilot ${JSON.stringify({ season, rows: rows.map(rowKey) })} -->`;
export function readMarker(body: string): { season: number; rows: string[] } | null {
  const m = /<!-- clip-autopilot (\{.*?\}) -->/.exec(body);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return Number.isInteger(v.season) && Array.isArray(v.rows) ? { season: v.season, rows: v.rows.map(String) } : null;
  } catch { return null; }
}
