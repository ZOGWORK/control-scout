// The owner's feedback inbox: messages sent from the /contact page (contact_messages), each
// open, resolved or archived. Resolving and archiving only move a message between lists; nothing
// is deleted here.
import { all, get } from "../db.js";
import type { FeedbackList, FeedbackMessage, FeedbackStatus } from "../../src/shared/owner.js";

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "resolved", "archived"];
export const isFeedbackStatus = (x: unknown): x is FeedbackStatus => typeof x === "string" && (FEEDBACK_STATUSES as string[]).includes(x);

const toMessage = (r: any): FeedbackMessage => ({
  id: Number(r.id), createdAt: r.created_at, topic: r.topic, name: r.name ?? null, email: r.email, message: r.message,
  emailed: Number(r.emailed) === 1, status: isFeedbackStatus(r.status) ? r.status : "open", statusAt: r.status_at ?? null,
});

/**
 * Newest first, one page of one list (or every list with "all"), plus how many each list holds.
 * `before`: a message id from the previous page, for the next (older) one; `more` says whether there is one.
 */
export async function listFeedback(status: FeedbackStatus | "all" = "open", limit = 100, before: number | null = null): Promise<FeedbackList> {
  const n = Math.min(500, Math.max(1, Math.floor(limit) || 100));
  const where = [status === "all" ? null : "status = ?", before ? "id < ?" : null].filter(Boolean);
  const args = [...(status === "all" ? [] : [status]), ...(before ? [before] : []), n + 1];
  // Ids grow with time, so id order is newest first and a stable cursor.
  const rows = await all(`SELECT * FROM contact_messages${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, args);
  const counts = { open: 0, resolved: 0, archived: 0 } as Record<FeedbackStatus, number>;
  for (const r of await all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM contact_messages GROUP BY status")) {
    if (isFeedbackStatus(r.status)) counts[r.status] = Number(r.n);
  }
  return { messages: rows.slice(0, n).map(toMessage), counts, more: rows.length > n };
}

/** Which list a message is in now (null: no such message). */
export async function feedbackStatus(id: number): Promise<FeedbackStatus | null> {
  const r = await get<{ status: string }>("SELECT status FROM contact_messages WHERE id = ?", [id]);
  return r ? (isFeedbackStatus(r.status) ? r.status : "open") : null;
}

/** Move a message to another list; the updated message, or null when there's no such message. */
export async function setFeedbackStatus(id: number, status: FeedbackStatus, now = new Date()): Promise<FeedbackMessage | null> {
  const row = await get("UPDATE contact_messages SET status = ?, status_at = ? WHERE id = ? RETURNING *", [status, now.toISOString(), id]);
  return row ? toMessage(row) : null;
}
