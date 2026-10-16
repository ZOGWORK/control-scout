// A workspace's scout entries as CSV (Task 18): GET /api/scout/workspaces/:workspaceId/export.csv.
// Filters: src/shared/scoutExport.ts. Docs: docs/shared-accounts.md, "Exporting entries (CSV)".
//
// - Any member of the workspace may export (workspaceAccess); anyone else gets 403, signed out 401,
//   and 503 while workspace scouting is paused. The server applies the filters itself: a client never
//   sends a list of entries. Deleted entries are never in it.
// - Columns: Entry ID, Team, Event, Match, Kind, Author, Updated at, Notes, then one column per field
//   of the workspace's *current* template for the season (the built-in default for a kind the workspace
//   hasn't customised): match fields, then pit fields (only the filtered kind's when `kind` is given).
//   Headers are the field labels; a label both kinds use is prefixed "Match: " / "Pit: ", and one that
//   still repeats gets its field id in brackets.
// - An entry made with an older template version is read by field id onto the current columns; an answer
//   whose field the current template no longer has goes, by field id, into the last column ("Other fields",
//   a JSON object), so nothing is lost silently.
// - Streamed (the shared CSV writer of the records export, server/api/records.ts): the header row goes out
//   first, then the entries in chunks, so a big workspace never sits in memory. UTF-8 with a BOM (Excel
//   reads it as UTF-8), RFC 4180 quoting, and cells starting with = + - @ (or a tab / CR) prefixed with '.
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { all, get } from "../db.js";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { csvCell, streamedBody } from "../api/records.js";
import { builtinTemplate } from "../../src/shared/scoutDefaults.js";
import { exportFilename } from "../../src/shared/scoutExport.js";
import type { ScoutField, TemplateKind } from "../../src/shared/scoutTemplate.js";
import { currentTemplate } from "./templates.js";
import { workspaceAccess, workspacePaused } from "./entries.js";

/** The filters, as the server applies them (parsed from the query by parseExportFilters). */
export interface ExportFilters {
  season: number;
  team?: number[];
  event?: string[];
  kind?: TemplateKind;
  author?: number[];
  match?: string[];
  /** Words that must each appear somewhere in the entry. */
  q?: string[];
}

const MAX_LIST = 50;

/** A list parameter: comma-separated, or repeated. */
function listOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return raw.flatMap((x) => (typeof x === "string" ? x.split(",") : [])).map((x) => x.trim()).filter(Boolean);
}

/** The export's filters from a query string, or what's wrong with them (a 400). */
export function parseExportFilters(query: Record<string, unknown>): { ok: true; filters: ExportFilters } | { ok: false; error: string } {
  const season = Number(query.season);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return { ok: false, error: "season required" };
  const f: ExportFilters = { season };
  const lists = { team: listOf(query.team), event: listOf(query.event), author: listOf(query.author), match: listOf(query.match) };
  for (const [k, v] of Object.entries(lists)) if (v.length > MAX_LIST) return { ok: false, error: `at most ${MAX_LIST} values for ${k}` };
  if (lists.team.length) {
    const teams = lists.team.map(Number);
    if (teams.some((t) => !Number.isInteger(t) || t < 1 || t > 999999)) return { ok: false, error: "team must be team numbers" };
    f.team = teams;
  }
  if (lists.event.length) {
    if (lists.event.some((e) => !/^[A-Za-z0-9_-]{1,24}$/.test(e))) return { ok: false, error: "event must be event codes" };
    f.event = lists.event.map((e) => e.toUpperCase());
  }
  if (lists.author.length) {
    const ids = lists.author.map(Number);
    if (ids.some((a) => !Number.isSafeInteger(a) || a < 1)) return { ok: false, error: "author must be account ids" };
    f.author = ids;
  }
  if (lists.match.length) {
    if (lists.match.some((m) => m.length > 24)) return { ok: false, error: "match must be match labels" };
    f.match = lists.match.map((m) => m.toUpperCase());
  }
  if (query.kind !== undefined && query.kind !== "") {
    if (query.kind !== "match" && query.kind !== "pit") return { ok: false, error: "kind must be match or pit" };
    f.kind = query.kind;
  }
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || query.q.length > 200) return { ok: false, error: "q must be up to 200 characters" };
    const words = query.q.toLowerCase().split(/\s+/).filter(Boolean); // every word applies (200 characters bound them)
    if (words.length) f.q = words;
  }
  return { ok: true, filters: f };
}

/** The WHERE clause for a workspace (its mirror row id) and filters; deleted entries never match. */
export function exportWhere(workspaceRowId: number, f: ExportFilters): { sql: string; args: (string | number)[] } {
  const parts = ["w.workspace_id = ?", "w.deleted = 0", "w.season = ?"];
  const args: (string | number)[] = [workspaceRowId, f.season];
  const anyOf = (col: string, vals: (string | number)[] | undefined) => {
    if (!vals?.length) return;
    parts.push(`${col} IN (${vals.map(() => "?").join(", ")})`);
    args.push(...vals);
  };
  anyOf("w.team", f.team);
  anyOf("UPPER(w.event_code)", f.event);
  anyOf("w.author_account_id", f.author);
  anyOf("UPPER(w.match_label)", f.match);
  if (f.kind) { parts.push("w.kind = ?"); args.push(f.kind); }
  // Free text: plain substring (instr, so % and _ are just characters), each word somewhere in the entry: its
  // columns, or one of its answers as decoded values (json_each: never the stored JSON's keys, quotes or escapes).
  const columns = "LOWER(w.team || ' ' || COALESCE(w.event_code, '') || ' ' || COALESCE(w.match_label, '') || ' ' || w.notes || ' ' || w.author_name || ' ' || w.editor_name)";
  const answers = "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(w.data) THEN w.data ELSE '{}' END) a WHERE instr(LOWER(CAST(a.value AS TEXT)), ?) > 0)";
  for (const word of f.q ?? []) { parts.push(`(instr(${columns}, ?) > 0 OR ${answers})`); args.push(word, word); }
  return { sql: parts.join(" AND "), args };
}

/** One template column: a field of one kind. */
export interface ExportColumn { header: string; kind: TemplateKind; id: string }

export const FIXED_HEADERS = ["Entry ID", "Team", "Event", "Match", "Kind", "Author", "Updated at", "Notes"] as const;
export const OTHER_FIELDS_HEADER = "Other fields";

/**
 * The template columns: match fields, then pit fields (the kinds in `kinds`). Headers are the labels; a
 * label both kinds use gets "Match: " / "Pit: " in front, and one that still repeats (two fields of one
 * kind with the same label, or a label equal to a fixed column) gets its field id in brackets.
 */
export function exportColumns(fields: Partial<Record<TemplateKind, ScoutField[]>>, kinds: TemplateKind[]): ExportColumn[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const labelsOf = (k: TemplateKind) => new Set((fields[k] ?? []).map((f) => norm(f.label)));
  const both = kinds.length > 1 ? new Set([...labelsOf("match")].filter((l) => labelsOf("pit").has(l))) : new Set<string>();
  const cols: ExportColumn[] = kinds.flatMap((kind) => (fields[kind] ?? []).map((f) => ({
    kind, id: f.id, header: both.has(norm(f.label)) ? `${kind === "match" ? "Match" : "Pit"}: ${f.label}` : f.label,
  })));
  const count = new Map<string, number>();
  for (const h of [...FIXED_HEADERS, OTHER_FIELDS_HEADER, ...cols.map((c) => c.header)]) count.set(norm(h), (count.get(norm(h)) ?? 0) + 1);
  // Final names are reserved as they're given, so a suffixed name can't land on another (a field labelled
  // "Speed [c]" beside two "Speed"s): whatever still collides gets a number until every header is unique.
  const used = new Set<string>([...FIXED_HEADERS, OTHER_FIELDS_HEADER].map(norm));
  const wanted = cols.map((c) => (count.get(norm(c.header))! > 1 ? `${c.header} [${c.id}]` : c.header));
  // Plain labels first, so a field keeps its own label when only a suffixed name would clash with it.
  const order = [...cols.keys()].sort((a, b) => Number(wanted[a] !== cols[a].header) - Number(wanted[b] !== cols[b].header));
  for (const i of order) {
    let h = wanted[i];
    for (let k = 2; used.has(norm(h)); k++) h = `${wanted[i]} (${k})`;
    used.add(norm(h));
    cols[i].header = h;
  }
  return cols;
}

/** A field's answer as a cell: TRUE/FALSE for a toggle (what spreadsheets read as booleans), else as given. */
export function answerCell(v: unknown): unknown {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** One stored row as CSV cells under `cols` (the answers it has that no column takes go to Other fields). */
export function exportRow(r: any, cols: ExportColumn[]): unknown[] {
  let data: Record<string, unknown> = {};
  try { const d = JSON.parse(r.data); if (d && typeof d === "object" && !Array.isArray(d)) data = d; } catch { /* unreadable: no answers */ }
  const kind = r.kind as TemplateKind;
  const taken = new Set(cols.filter((c) => c.kind === kind).map((c) => c.id));
  const other = Object.fromEntries(Object.entries(data).filter(([k]) => !taken.has(k)));
  return [
    r.uuid, Number(r.team), r.event_code ?? "", r.match_label ?? "", kind, r.author_name, new Date(Number(r.updated_at)).toISOString(), r.notes ?? "",
    ...cols.map((c) => (c.kind === kind ? answerCell(data[c.id]) : "")),
    Object.keys(other).length ? JSON.stringify(other) : "",
  ];
}

/** Entries per read while streaming. */
export const EXPORT_CHUNK = 500;

/**
 * Stream the export (membership already checked). Which entries, in which order (newest edit first), is
 * fixed by one query of their ids up front; the rows are then read in chunks of EXPORT_CHUNK (filters
 * applied again, so one deleted or changed meanwhile drops out rather than going out stale).
 */
export async function streamWorkspaceCsv(workspaceId: string, workspaceName: string, f: ExportFilters, res: Response): Promise<void> {
  const t = await currentTemplate(workspaceId, f.season);
  const kinds: TemplateKind[] = f.kind ? [f.kind] : ["match", "pit"];
  const cols = exportColumns({
    match: t.match ?? builtinTemplate(f.season, "match").fields,
    pit: t.pit ?? builtinTemplate(f.season, "pit").fields,
  }, kinds);
  const line = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(workspaceName, workspaceId, f.season)}"`);
  res.setHeader("Cache-Control", "no-store");
  const body = streamedBody(res);
  if (!(await body.send(`﻿${line([...FIXED_HEADERS, ...cols.map((c) => c.header), OTHER_FIELDS_HEADER])}`))) return;
  try {
    const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
    if (ws) {
      const w = exportWhere(Number(ws.id), f);
      const keys = (await all<{ uuid: string }>(`SELECT w.uuid FROM workspace_scout_entries w WHERE ${w.sql} ORDER BY w.updated_at DESC, w.uuid`, w.args)).map((r) => String(r.uuid));
      for (let i = 0; i < keys.length; i += EXPORT_CHUNK) {
        const chunk = keys.slice(i, i + EXPORT_CHUNK);
        const rows = await all<any>(`SELECT w.* FROM workspace_scout_entries w WHERE ${w.sql} AND w.uuid IN (${chunk.map(() => "?").join(", ")})`, [...w.args, ...chunk]);
        const byId = new Map(rows.map((r) => [String(r.uuid), r]));
        let out = "";
        for (const k of chunk) { const r = byId.get(k); if (r) out += line(exportRow(r, cols)); }
        if (out && !(await body.send(out))) return;
      }
    }
    body.end();
  } catch (e) {
    body.abort(); // headers are out: cut the download off (never a complete-looking partial file), then report
    throw e;
  }
}

/** /api/scout/workspaces/:workspaceId/export.csv, behind `limit` (server/app.ts gives it a per-IP rate limit). */
export function exportRouter(limit: RequestHandler = (_req, _res, next) => next()): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/export.csv", limit, (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
      if (await workspacePaused(res)) return;
      const workspaceId = req.params.workspaceId;
      if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
      const parsed = parseExportFilters(req.query as Record<string, unknown>);
      if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
      const access = await workspaceAccess(user, workspaceId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
      await streamWorkspaceCsv(workspaceId, access.membership.workspaceName, parsed.filters, res);
    })().catch(next);
  });
  return r;
}
