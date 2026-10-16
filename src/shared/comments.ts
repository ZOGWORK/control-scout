// Comments on workspace scout entries (Task 15), shared by the server
// (server/scout/comments.ts) and the app (src/lib/scoutComments.ts).
//
// A flat thread per entry, oldest first. Plain text only: the app renders the
// body as text (never HTML) and links nothing. A deleted comment disappears
// from the thread for everyone (the server keeps an empty row so the count
// and ids stay right); an edited one says "edited".

/** Longest comment, in characters, after trimming. */
export const COMMENT_MAX = 2000;
/** How much of a comment the activity feed and the notification inbox carry. */
export const COMMENT_EXCERPT = 140;

export interface EntryComment {
  id: number;
  workspaceId: string;
  entryUuid: string;
  authorAccountId: number;
  authorName: string;
  body: string;
  createdAt: number;
  /** When its author last changed it; null if never. */
  editedAt: number | null;
}

/**
 * A change to a thread, as the workspace's live stream sends it (`event: comment`, no id) and as
 * the write routes answer. `count`: the entry's comments after the change (for the count on its card).
 * `comment`: the comment as it is now (created, edited); absent for a deletion.
 */
export interface CommentEvent {
  action: "created" | "edited" | "deleted";
  workspaceId: string;
  entryUuid: string;
  commentId: number;
  count: number;
  comment?: EntryComment;
}

/**
 * A comment's text as stored: line endings made \n, control characters other than newline and tab
 * dropped, trimmed. Null when there's nothing left or it's too long (the caller says which).
 */
export function cleanCommentBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write a comment first." };
  // eslint-disable-next-line no-control-regex
  const body = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (!body) return { ok: false, error: "Write a comment first." };
  if ([...body].length > COMMENT_MAX) return { ok: false, error: `Comments can be up to ${COMMENT_MAX.toLocaleString("en-US")} characters.` };
  return { ok: true, body };
}

/** The first COMMENT_EXCERPT characters of a comment on one line, with an ellipsis when cut. */
export function commentExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > COMMENT_EXCERPT ? `${chars.slice(0, COMMENT_EXCERPT - 1).join("").trimEnd()}…` : flat;
}

export function isEntryComment(x: unknown): x is EntryComment {
  const c = x as EntryComment;
  return !!c && Number.isSafeInteger(c.id) && typeof c.workspaceId === "string" && typeof c.entryUuid === "string"
    && Number.isSafeInteger(c.authorAccountId) && typeof c.authorName === "string" && typeof c.body === "string"
    && Number.isFinite(c.createdAt) && (c.editedAt === null || Number.isFinite(c.editedAt));
}

export function isCommentEvent(x: unknown): x is CommentEvent {
  const e = x as CommentEvent;
  return !!e && (e.action === "created" || e.action === "edited" || e.action === "deleted") && typeof e.workspaceId === "string"
    && typeof e.entryUuid === "string" && Number.isSafeInteger(e.commentId) && Number.isSafeInteger(e.count) && e.count >= 0
    && (e.comment === undefined || isEntryComment(e.comment));
}
