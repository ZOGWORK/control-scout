// The owner's feedback inbox: messages sent from the /contact page (contact_messages), each
// open, resolved or archived. Resolving and archiving only move a message between lists; nothing
// is deleted here.
//
// Triage (migration 56): a bug report, data correction or feature idea is also accepted, rejected or
// marked fixed. Triage files the message with it (fixed or rejected: resolved; accepted or undone: open),
// so the inbox and the Moderation tab's queue are one list seen two ways, never a second inbox. Accepting a
// data correction changes no match record: the fix comes from FIRST through a re-sync.
import { all, get } from "../db.js";
import { TRIAGE_NEXT, TRIAGE_TOPICS, type FeedbackList, type FeedbackMessage, type FeedbackStatus, type TriageQueue, type TriageState } from "../../src/shared/owner.js";

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "resolved", "archived"];
export const isFeedbackStatus = (x: unknown): x is FeedbackStatus => typeof x === "string" && (FEEDBACK_STATUSES as string[]).includes(x);
export const TRIAGE_STATES: TriageState[] = ["accepted", "rejected", "fixed"];
export const isTriageState = (x: unknown): x is TriageState => typeof x === "string" && (TRIAGE_STATES as string[]).includes(x);
export const isTriageTopic = (topic: string) => TRIAGE_TOPICS.includes(topic);

/** Is this move allowed (TRIAGE_NEXT, shared with the console)? */
export const canTriage = (from: TriageState | null, to: TriageState | null) => TRIAGE_NEXT[from ?? "untriaged"].includes(to);
/** The inbox list a triage decision files the message under. */
export const statusForTriage = (t: TriageState | null): FeedbackStatus => (t === "fixed" || t === "rejected" ? "resolved" : "open");

const toMessage = (r: any): FeedbackMessage => ({
  id: Number(r.id), createdAt: r.created_at, topic: r.topic, name: r.name ?? null, email: r.email, message: r.message,
  emailed: Number(r.emailed) === 1, status: isFeedbackStatus(r.status) ? r.status : "open", statusAt: r.status_at ?? null,
  triage: isTriageState(r.triage) ? r.triage : null, triageAt: r.triage_at ?? null,
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

const TOPIC_SQL = `topic IN (${TRIAGE_TOPICS.map(() => "?").join(", ")})`;

/** The triage queue: bug reports, data corrections and ideas not decided yet (first) or accepted and not fixed, newest first; plus counts per state. */
export async function triageQueue(limit = 100): Promise<TriageQueue> {
  const n = Math.min(500, Math.max(1, Math.floor(limit) || 100));
  const rows = await all(
    `SELECT * FROM contact_messages WHERE ${TOPIC_SQL} AND status <> 'archived' AND (triage IS NULL OR triage = 'accepted')
     ORDER BY (triage IS NOT NULL), id DESC LIMIT ?`, [...TRIAGE_TOPICS, n]);
  const counts: TriageQueue["counts"] = { untriaged: 0, accepted: 0, rejected: 0, fixed: 0 };
  for (const r of await all<{ triage: string | null; n: number }>(
    `SELECT triage, COUNT(*) n FROM contact_messages WHERE ${TOPIC_SQL} AND status <> 'archived' GROUP BY triage`, [...TRIAGE_TOPICS])) {
    if (r.triage == null) counts.untriaged += Number(r.n);
    else if (isTriageState(r.triage)) counts[r.triage] += Number(r.n);
  }
  return { messages: rows.map(toMessage), counts };
}

/** One message (null: no such message). */
export async function feedbackMessage(id: number): Promise<FeedbackMessage | null> {
  const r = await get("SELECT * FROM contact_messages WHERE id = ?", [id]);
  return r ? toMessage(r) : null;
}

/** Which list a message is in now (null: no such message). */
export async function feedbackStatus(id: number): Promise<FeedbackStatus | null> {
  return (await feedbackMessage(id))?.status ?? null;
}

/** Move a message to another list; the updated message, or null when there's no such message. */
export async function setFeedbackStatus(id: number, status: FeedbackStatus, now = new Date()): Promise<FeedbackMessage | null> {
  const row = await get("UPDATE contact_messages SET status = ?, status_at = ? WHERE id = ? RETURNING *", [status, now.toISOString(), id]);
  return row ? toMessage(row) : null;
}

export class TriageError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

/**
 * Triage one message: `to` is accepted, rejected, fixed, or null to undo. Refused (TriageError) for an
 * unknown message, a topic that isn't triaged, or a move TRIAGE_NEXT doesn't allow. Returns the message
 * before and after, for the audit log.
 */
export async function setTriage(id: number, to: TriageState | null, now = new Date()): Promise<{ before: FeedbackMessage; after: FeedbackMessage }> {
  const before = await feedbackMessage(id);
  if (!before) throw new TriageError(404, "No such message");
  if (!isTriageTopic(before.topic)) throw new TriageError(400, "Only bug reports, data corrections and feature ideas are triaged");
  if (!canTriage(before.triage, to)) throw new TriageError(409, `Can't go from ${before.triage ?? "not triaged"} to ${to ?? "not triaged"}`);
  const status = statusForTriage(to);
  const at = now.toISOString();
  // Guarded on the state just read: two decisions sent at once can't both land.
  const row = await get(
    `UPDATE contact_messages SET triage = ?, triage_at = ?, status = ?, status_at = CASE WHEN status = ? THEN status_at ELSE ? END
     WHERE id = ? AND triage IS ? RETURNING *`,
    [to, to ? at : null, status, status, at, id, before.triage],
  );
  if (!row) throw new TriageError(409, "This message was triaged a moment ago. Reload to see where it is now.");
  return { before, after: toMessage(row) };
}
