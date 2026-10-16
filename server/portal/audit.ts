// The owner audit log: every action taken in the owner portal (and, later, other owner-level
// actions such as a workspace member removal) gets a row: who, what, when, details.
// Append-only; an action that finishes after its request (a data job) fills in `result` once done.
import { all, get, run } from "../db.js";
import type { AuditEntry } from "../../src/shared/owner.js";

const DETAILS_MAX = 2000;

/** Record one action; returns its id. `details` is stored as JSON (kept short). */
export async function recordAudit(actor: string, action: string, details?: Record<string, unknown> | null, result?: string | null): Promise<number> {
  const json = details ? JSON.stringify(details).slice(0, DETAILS_MAX) : null;
  const row = await get<{ id: number }>(
    "INSERT INTO owner_audit (at, actor, action, details, result) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [new Date().toISOString(), actor.slice(0, 200), action.slice(0, 80), json, result ?? null],
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
  const rows = await all<{ id: number; at: string; actor: string; action: string; details: string | null; result: string | null }>(
    "SELECT * FROM owner_audit ORDER BY id DESC LIMIT ?", [n],
  );
  return rows.map((r) => {
    let details: Record<string, unknown> | null = null;
    try { details = r.details ? JSON.parse(r.details) : null; } catch { details = { raw: r.details }; }
    return { id: Number(r.id), at: r.at, actor: r.actor, action: r.action, details, result: r.result };
  });
}
