// The clip autopilot's rows (scripts/clip-autopilot.ts): the rules a row the frame reader writes must keep before it
// goes live (rowProblems, defined once in server/data/frameRowRules.ts, where the server checks each read the autopilot
// hands it), and how rows sit in a season (or clip checks) file: the autopilot writes the rows the live site serves
// from its database over main's file, so the reader sees what's live.
import type { FrameTiming } from "../../server/data/frameTimings.js";
import { dataRows } from "./videoFrames.js";
export { rowProblems } from "../../server/data/frameRowRules.js";

export type Row = FrameTiming;
/** Any data row keyed by its video and event: a frame timing, or a first-frame clip check (server/data/clipChecks.ts). */
export type Keyed = { videoId: string; code: string };
export const rowKey = (r: Keyed) => `${r.videoId}|${r.code}`;
/** A row as its file holds it: one line. */
export const rowLine = (r: Keyed) => `  ${JSON.stringify(r)},`;

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

const splitAt = (s: string, mark: string): [string, string] => { const i = s.indexOf(mark); if (i < 0) throw new Error(`no "${mark}" mark`); return [s.slice(0, i), s.slice(i)]; };
