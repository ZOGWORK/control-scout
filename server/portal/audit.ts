// The owner audit log: every action taken in the owner portal (and, later, other owner-level
// actions such as a workspace member removal) gets a row: who, what, when, details, and for a change
// the value it replaced and the value it set (`change`).
// Append-only, enforced by the database (migration 52's triggers): no row is ever deleted, and the one
// update a row takes is its `result`, filled in once an action that finishes after its request (a data
// job) is done. Nothing in the console edits or deletes a row.
import { all, get, run } from "../db.js";
import type { AuditEntry } from "../../src/shared/owner.js";

const DETAILS_MAX = 2000;

/** What a change replaced and what it set (any JSON value; null for "nothing"). */
export interface AuditChange { from: unknown; to: unknown }

const valueJson = (v: unknown) => JSON.stringify(v ?? null).slice(0, DETAILS_MAX);
const parse = (s: string | null): unknown => {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return s; }
};

/** Record one action; returns its id. `details` is stored as JSON (kept short); `change` as old_value / new_value. */
export async function recordAudit(actor: string, action: string, details?: Record<string, unknown> | null, result?: string | null, change?: AuditChange): Promise<number> {
  const json = details ? JSON.stringify(details).slice(0, DETAILS_MAX) : null;
  const row = await get<{ id: number }>(
    "INSERT INTO owner_audit (at, actor, action, details, result, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [new Date().toISOString(), actor.slice(0, 200), action.slice(0, 80), json, result ?? null, change ? valueJson(change.from) : null, change ? valueJson(change.to) : null],
  );
  return Number(row!.id);
}

/** How a long-running action ended ("done", "failed: …"). */
export async function setAuditResult(id: number, result: string): Promise<void> {
  await run("UPDATE owner_audit SET result = ? WHERE id = ?", [result.slice(0, 500), id]);
}

/** Newest first. */
export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const n = Math.min(500, Math.max(1, Math.floor(limit) || 100));
  const rows = await all<{ id: number; at: string; actor: string; action: string; details: string | null; result: string | null; old_value: string | null; new_value: string | null }>(
    "SELECT * FROM owner_audit ORDER BY id DESC LIMIT ?", [n],
  );
  return rows.map((r) => {
    let details: Record<string, unknown> | null = null;
    try { details = r.details ? JSON.parse(r.details) : null; } catch { details = { raw: r.details }; }
    const change = r.old_value == null && r.new_value == null ? null : { from: parse(r.old_value), to: parse(r.new_value) };
    return { id: Number(r.id), at: r.at, actor: r.actor, action: r.action, details, result: r.result, change };
  });
}
