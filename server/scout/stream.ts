// GET /api/scout/stream?workspaceId=…: a workspace's entries live, as
// server-sent events, for members looking at its scout space.
//
// On connect the stream catches up from Last-Event-ID (a reconnect) or
// ?since= (the device's pull cursor) with the cursor pull, then goes live.
// It subscribes before catching up: entries written meanwhile are held and
// sent after the catch-up, and anything at or below the stream's cursor was
// already sent, so nothing is sent twice and nothing falls in between. (The
// client also dedupes by uuid + updatedAt.)
//
// Event format, one per written entry, `id:` = the entry's seq (its place in
// the workspace's write order, the same cursor GET /api/scout/sync uses):
//   id: 42
//   event: upsert            (`delete` for a tombstone)
//   data: <the entry, exactly as GET /api/scout/sync returns it>
// and:
//   event: ready             caught up; data {"cursor": n}
//   event: resync            too far behind to stream the catch-up: the server
//                            ends the stream; pull with GET /api/scout/sync,
//                            then reconnect. data {"cursor": n}
//   event: membership_revoked  the member lost access; the stream ends. Sent at once when an admin
//                            removes them (Settings → Workspace → Members) or a membership refresh finds
//                            the workspace gone from Control Point's answer (bus.ts publishRevoked); else
//                            by the periodic re-check (LIMITS.recheckMs).
//   event: template          an admin changed the workspace's template; no id (it isn't an entry,
//                            so it never moves the cursor). data {"season", "version", "settingsVersion"}:
//                            refetch GET /api/scout/workspaces/:id/template. Sent once live (one during the catch-up comes after `ready`).
//   event: settings          an admin changed the workspace's settings (its defaults); no id. data {"settingsVersion"}:
//                            refetch GET /api/scout/workspaces/:id/settings. Sent once live, like `template`.
//   event: activity          an item just logged in the workspace's activity feed (activityLog.ts), exactly as
//                            GET /api/scout/workspaces/:id/activity lists it; no id. Live only: ones logged during
//                            the catch-up follow `ready`; a reader that was away refetches the feed's newest page.
//                            A coalesced edit arrives as a new item whose details.firstId says which older ones it replaces.
//   event: picklist          a shared pick list changed (picklist.ts, Task 11): the whole list as it now is, exactly as
//                            GET /api/scout/workspaces/:id/picklist?season= returns it ({workspaceId, season, version, picks});
//                            no id. Keep the highest version per season. Live only, like `activity`: the latest per
//                            season during the catch-up follows `ready`; a reader that was away refetches the list.
//   event: comment           a comment on one of the workspace's entries was written, edited or deleted (comments.ts); no id
//                            (comments have their own order, so it never moves the entry cursor). data: a CommentEvent
//                            (src/shared/comments.ts) {action, workspaceId, entryUuid, commentId, count, comment?}. Live only,
//                            like `activity` (ones during the catch-up follow `ready`): a device that was away refetches
//                            the threads it has open, and the counts, on `ready`.
//   : ping                   a comment every 25 s (proxies drop silent connections)
//
// Proxy: the response says X-Accel-Buffering: no, and nginx's site gives this
// path its own location without buffering and with a long read timeout
// (deploy/oracle-vm-setup.sh). Compression skips text/event-stream (app.ts).
import express, { type Request, type Response, type Router } from "express";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { subscribe, subscribeActivity, subscribeComments, subscribePicklist, subscribeRevoked, subscribeSettings, subscribeTemplate, type ActivityNotice, type LiveEntry, type PicklistNotice, type SettingsNotice, type TemplateNotice } from "./bus.js";
import { openLiveConnection } from "../liveConnections.js";
import { pullWorkspaceLive, workspaceAccess, type WorkspaceEntryOut } from "./entries.js";
import type { CommentEvent } from "../../src/shared/comments.js";

/**
 * Streams one account may hold at once (tabs and devices) and the whole server, the heartbeat
 * (well under nginx's default proxy_read_timeout of 60 s, should a proxy keep that default), and
 * how often a long stream re-checks the session and the membership. A reader that falls behind
 * (more than maxBufferedBytes waiting to be sent, or maxHeld entries written during its catch-up)
 * is let go: it reconnects from its cursor instead of the server holding its backlog in memory.
 */
export const LIMITS = { perAccount: 8, total: 1000, heartbeatMs: 25_000, recheckMs: 5 * 60_000, maxBufferedBytes: 1 << 20, maxHeld: 2000 };
/** Catch-up pages (of PULL_LIMIT entries) a stream sends on connect before it asks the client to pull instead. */
export const CATCHUP_PAGES = 10;

interface Stream { userId: number; workspaceId: string; end: (closeSocket?: boolean) => void }
const streams = new Set<Stream>();

/**
 * Open streams right now: the whole server's, or one account's. Kept here, in
 * one place, for the owner portal's Usage panel (live connections).
 */
export function activeStreamCount(userId?: number): number {
  if (userId == null) return streams.size;
  let n = 0;
  for (const s of streams) if (s.userId === userId) n++;
  return n;
}

/** End every open stream (on SIGTERM: clients reconnect to the next server at once instead of holding up the drain). */
export function closeAllStreams(): void { for (const s of [...streams]) s.end(true); }

/** Tests: change the limits and timings (for streams opened after); returns the restore. */
export function setStreamLimits(l: Partial<typeof LIMITS>): () => void {
  const before = { ...LIMITS };
  Object.assign(LIMITS, l);
  return () => { Object.assign(LIMITS, before); };
}

const entryFrame = ({ seq, ...e }: LiveEntry) =>
  `id: ${seq}\nevent: ${e.deleted ? "delete" : "upsert"}\ndata: ${JSON.stringify(e satisfies WorkspaceEntryOut)}\n\n`;

/** Where to start: the browser's Last-Event-ID on a reconnect, else ?since= (0 when absent). Null: not a cursor. */
function cursorFrom(req: Request): number | null {
  const raw = req.get("Last-Event-ID") ?? (req.query.since === undefined ? "0" : String(req.query.since));
  const n = Number(raw);
  return raw.trim() !== "" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Resolves once the response can take more, or has closed. */
const drained = (res: Response) => new Promise<void>((resolve) => {
  const done = () => { res.off("drain", done); res.off("close", done); resolve(); };
  res.on("drain", done); res.on("close", done);
});

/** /api/scout/stream. `enabled`: a kill switch (off: 503, and the client falls back to polling). */
export function streamRouter(opts: { enabled?: () => Promise<boolean> } = {}): Router {
  const r = express.Router();
  r.get("/stream", (req, res, next) => { open(req, res, opts).catch(next); });
  return r;
}

async function open(req: Request, res: Response, opts: { enabled?: () => Promise<boolean> }) {
  res.set("Cache-Control", "no-store");
  if (opts.enabled && !(await opts.enabled())) { res.status(503).json({ error: "Live updates are paused. The list still refreshes every few seconds." }); return; }
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to see your workspace's entries live." }); return; }
  const workspaceId = req.query.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
  const since = cursorFrom(req);
  if (since == null) { res.status(400).json({ error: "since must be a cursor from an earlier pull" }); return; }
  const access = await workspaceAccess(user, workspaceId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  // Checked after the last await, so the count can't change before this stream is added.
  if (streams.size >= LIMITS.total || activeStreamCount(user.id) >= LIMITS.perAccount) {
    res.set("Retry-After", "30").status(429).json({ error: "Too many live connections are open. Close a tab or two." });
    return;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no", // nginx: pass each event through as it's written
    Connection: "keep-alive",
  });
  res.flushHeaders();
  req.socket.setNoDelay(true);

  let closed = false;
  let cursor = since;
  let live = false;
  const held: LiveEntry[] = [];
  // Entries are published in seq order (a workspace's writes are serialized, bus.ts), so one at
  // or below the cursor was already sent: by the catch-up, or as an earlier event.
  const write = (chunk: string) => {
    if (closed) return;
    res.write(chunk);
    if (res.writableLength > LIMITS.maxBufferedBytes) end(); // too far behind: it reconnects from its cursor
  };
  const send = (e: LiveEntry) => {
    if (closed || e.seq <= cursor) return;
    write(entryFrame(e));
    cursor = e.seq;
  };
  const unsubscribe = subscribe(workspaceId, (e) => {
    if (live) send(e);
    else if (held.push(e) > LIMITS.maxHeld) end();
  });
  // A template change during the catch-up is held (the latest one) and sent once live.
  let heldTemplate: TemplateNotice | null = null;
  const sendTemplate = (n: TemplateNotice) => write(`event: template\ndata: ${JSON.stringify(n)}\n\n`);
  const unsubscribeTemplate = subscribeTemplate(workspaceId, (n) => { if (live) sendTemplate(n); else heldTemplate = n; });
  // Settings changes likewise (the latest one held during the catch-up).
  let heldSettings: SettingsNotice | null = null;
  const sendSettings = (n: SettingsNotice) => write(`event: settings\ndata: ${JSON.stringify(n)}\n\n`);
  const unsubscribeSettings = subscribeSettings(workspaceId, (n) => { if (live) sendSettings(n); else heldSettings = n; });
  // Activity items logged during the catch-up are held (bounded like entries) and sent once live.
  const heldActivity: ActivityNotice[] = [];
  const sendActivity = (a: ActivityNotice) => write(`event: activity
data: ${JSON.stringify(a)}

`);
  const unsubscribeActivity = subscribeActivity(workspaceId, (a) => {
    if (live) sendActivity(a);
    else if (heldActivity.push(a) > LIMITS.maxHeld) end();
  });
  // Pick list changes during the catch-up: the latest per season is held and sent once live.
  const heldPicklists = new Map<number, PicklistNotice>();
  const sendPicklist = (n: PicklistNotice) => write(`event: picklist\ndata: ${JSON.stringify(n)}\n\n`);
  const unsubscribePicklist = subscribePicklist(workspaceId, (n) => {
    if (live) sendPicklist(n);
    else if ((heldPicklists.get(n.season)?.version ?? -1) < n.version) heldPicklists.set(n.season, n);
  });
  // Removed from the workspace (bus.ts publishRevoked): end now, not at the next re-check.
  const unsubscribeRevoked = subscribeRevoked(workspaceId, (accountId) => {
    if (accountId !== access.membership.accountId || closed) return;
    write("event: membership_revoked\ndata: {}\n\n");
    end();
  });
  // Comment changes likewise (held during the catch-up, bounded, sent once live).
  const heldComments: CommentEvent[] = [];
  const sendComment = (c: CommentEvent) => write(`event: comment
data: ${JSON.stringify(c)}

`);
  const unsubscribeComments = subscribeComments(workspaceId, (c) => {
    if (live) sendComment(c);
    else if (heldComments.push(c) > LIMITS.maxHeld) end();
  });
  const stream: Stream = { userId: user.id, workspaceId, end: (closeSocket) => { end(); if (closeSocket) res.socket?.end(); } };
  streams.add(stream);
  // Counted for the owner portal's Usage panel (live connections), released in end().
  const release = openLiveConnection("scout-stream");
  const heartbeat = setInterval(() => write(": ping\n\n"), LIMITS.heartbeatMs);
  // A check that can't run (the database or Control Point briefly away) keeps the stream, as reads do.
  const recheck = setInterval(() => {
    void (async () => {
      const u = await currentUser(req).catch(() => undefined);
      if (u === undefined || closed) return;
      const a = u ? await workspaceAccess(u, workspaceId).catch(() => undefined) : null;
      if (a === undefined || closed || a?.ok) return;
      write("event: membership_revoked\ndata: {}\n\n");
      end();
    })();
  }, LIMITS.recheckMs);
  function end() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat); clearInterval(recheck);
    unsubscribe(); unsubscribeTemplate(); unsubscribeSettings(); unsubscribeActivity(); unsubscribeRevoked(); unsubscribeComments(); unsubscribePicklist();
    streams.delete(stream);
    release();
    held.length = 0; heldActivity.length = 0; heldComments.length = 0; heldPicklists.clear();
    res.end();
  }
  res.on("close", end);
  res.on("error", end);

  try {
    let pages = 0, more = true;
    while (more && !closed && pages < CATCHUP_PAGES) {
      const page = await pullWorkspaceLive(workspaceId, cursor);
      for (const e of page.entries) {
        send(e);
        // Wait for a slow reader instead of buffering the whole catch-up in memory.
        if (res.writableNeedDrain && !closed) await drained(res);
      }
      if (closed) return;
      cursor = Math.max(cursor, page.cursor); more = page.more; pages++;
    }
    if (closed) return;
    if (more) { write(`event: resync\ndata: ${JSON.stringify({ cursor })}\n\n`); end(); return; }
    live = true;
    for (const e of held.splice(0)) send(e);
    write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`);
    if (heldTemplate) { sendTemplate(heldTemplate); heldTemplate = null; }
    if (heldSettings) { sendSettings(heldSettings); heldSettings = null; }
    for (const a of heldActivity.splice(0)) sendActivity(a);
    for (const n of heldPicklists.values()) sendPicklist(n);
    heldPicklists.clear();
    for (const c of heldComments.splice(0)) sendComment(c);
  } catch (e) {
    console.error("[scout stream] catch-up failed", e);
    end();
  }
}
