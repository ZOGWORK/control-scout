// /api/inbox: the signed-in account's notification inbox (inbox.ts, docs/inbox.md).
//
//   GET  /api/inbox?before=<id>&limit=30&filter=all|followUp
//                                          a page, newest first: { items, more, unread, followUp } (filter followUp:
//                                          flagged items only; the counts are the whole inbox's either way)
//   GET  /api/inbox/unread-count           { unread }
//   POST /api/inbox/read                   { ids: [1, 2] } or { all: true, upTo?: <newest id seen> } → { unread }
//                                          (follow-up flags stay)
//   POST /api/inbox/unread                 { ids: [1, 2] } → { unread }: back in the count
//   POST /api/inbox/follow-up              { ids: [1, 2], on: true|false } → { unread, followUp }: flag or unflag;
//                                          read state is unchanged
//   GET  /api/inbox/stream                 server-sent events for this account, across every workspace:
//        event: inbox   data {"unread": n, "latest": id|null, "followUp": n}
//                                                                on connect, then whenever an item arrives or its
//                                                                read or follow-up state changes (on any device)
//        : ping         every 25 s
//        503 while the owner has live updates switched off (realtime): the app polls unread-count instead.
//
// 401 signed out. Writes are JSON only (CSRF: the session cookie is SameSite=Lax, and a cross-site form
// can't send application/json). Every response is no-store.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { currentUser, type User } from "../auth/session.js";
import { openLiveConnection } from "../liveConnections.js";
import { INBOX_FILTERS, INBOX_PAGE, INBOX_PAGE_MAX, type InboxFilter } from "../../src/shared/inbox.js";
import { inboxCounts, listInbox, markRead, markUnread, setFollowUp, subscribeInbox, unreadCount, type InboxNotice } from "./inbox.js";

/** Streams per account (tabs and devices) and per server, the heartbeat, and how often a stream re-checks its session. */
export const INBOX_LIMITS = { perAccount: 8, total: 2000, heartbeatMs: 25_000, recheckMs: 5 * 60_000, maxBufferedBytes: 64 * 1024 };
const MAX_IDS = 200;

interface Stream { userId: number; end: (closeSocket?: boolean) => void }
const streams = new Set<Stream>();
export const inboxStreamCount = (userId?: number) => (userId == null ? streams.size : [...streams].filter((s) => s.userId === userId).length);
/** End every open inbox stream (SIGTERM). */
export function closeInboxStreams(): void { for (const s of [...streams]) s.end(true); }

const h = (fn: (req: Request, res: Response, user: User) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  (async () => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to see your notifications." }); return; }
    const b = await fn(req, res, user);
    if (!res.headersSent && b !== undefined) res.json(b);
  })().catch(next);
};

const positiveId = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
/** 1 to MAX_IDS item ids, deduplicated; null when that isn't what was sent. */
const idList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length && v.length <= MAX_IDS && v.every((x) => positiveId(x) != null) ? [...new Set(v as number[])] : null;

export function inboxRouter(opts: { streamEnabled?: () => Promise<boolean> } = {}): Router {
  const r = express.Router();
  r.use((req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  });

  r.get("/", h(async (req, res, user) => {
    let before: number | null = null;
    if (req.query.before !== undefined && req.query.before !== "") {
      before = positiveId(Number(req.query.before));
      if (before == null || !/^\d+$/.test(String(req.query.before))) { res.status(400).json({ error: "before must be an inbox item id" }); return; }
    }
    const limit = req.query.limit === undefined ? INBOX_PAGE : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > INBOX_PAGE_MAX) { res.status(400).json({ error: `limit must be 1 to ${INBOX_PAGE_MAX}` }); return; }
    const filter = (req.query.filter === undefined || req.query.filter === "" ? "all" : String(req.query.filter)) as InboxFilter;
    if (!INBOX_FILTERS.includes(filter)) { res.status(400).json({ error: `filter must be one of ${INBOX_FILTERS.join(", ")}` }); return; }
    return listInbox(user.id, before, limit, filter);
  }));

  r.get("/unread-count", h(async (_req, _res, user) => ({ unread: await unreadCount(user.id) })));

  r.post("/read", h(async (req, res, user) => {
    const b = req.body ?? {};
    if (b.all === true) {
      const upTo = b.upTo == null ? null : positiveId(b.upTo);
      if (b.upTo != null && upTo == null) { res.status(400).json({ error: "upTo must be an inbox item id" }); return; }
      return { unread: await markRead(user.id, { all: true, upTo }) };
    }
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > MAX_IDS || b.ids.some((x: unknown) => positiveId(x) == null)) {
      res.status(400).json({ error: `Send { ids: [...] } (1 to ${MAX_IDS} item ids) or { all: true }` });
      return;
    }
    return { unread: await markRead(user.id, { ids: [...new Set(b.ids as number[])] }) };
  }));

  r.post("/unread", h(async (req, res, user) => {
    const ids = idList(req.body?.ids);
    if (!ids) { res.status(400).json({ error: `Send { ids: [...] } (1 to ${MAX_IDS} item ids)` }); return; }
    return { unread: await markUnread(user.id, ids) };
  }));

  r.post("/follow-up", h(async (req, res, user) => {
    const ids = idList(req.body?.ids);
    if (!ids || typeof req.body?.on !== "boolean") { res.status(400).json({ error: `Send { ids: [...] (1 to ${MAX_IDS} item ids), on: true or false }` }); return; }
    const n = await setFollowUp(user.id, ids, req.body.on);
    return { unread: n.unread, followUp: n.followUp };
  }));

  r.get("/stream", (req, res, next) => { openStream(req, res, opts).catch(next); });
  return r;
}

async function openStream(req: Request, res: Response, opts: { streamEnabled?: () => Promise<boolean> }) {
  res.set("Cache-Control", "no-store");
  if (opts.streamEnabled && !(await opts.streamEnabled())) { res.status(503).json({ error: "Live updates are paused. Notifications refresh every minute." }); return; }
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to see your notifications." }); return; }
  // Checked after the last await, so the count can't change before this stream is added.
  if (streams.size >= INBOX_LIMITS.total || inboxStreamCount(user.id) >= INBOX_LIMITS.perAccount) {
    res.set("Retry-After", "60").status(429).json({ error: "Too many live connections are open. Close a tab or two." });
    return;
  }
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.flushHeaders();
  req.socket.setNoDelay(true);

  let closed = false;
  const write = (chunk: string) => {
    if (closed) return;
    res.write(chunk);
    // A reader that stopped reading is let go (it reconnects and gets the count again) instead of the server holding its backlog.
    if (res.writableLength > INBOX_LIMITS.maxBufferedBytes) end();
  };
  const send = (n: InboxNotice) => write(`event: inbox\ndata: ${JSON.stringify(n)}\n\n`);
  const unsubscribe = subscribeInbox(user.id, send);
  const stream: Stream = { userId: user.id, end: (closeSocket) => { end(); if (closeSocket) res.socket?.end(); } };
  streams.add(stream);
  const release = openLiveConnection("inbox-stream");
  const heartbeat = setInterval(() => write(": ping\n\n"), INBOX_LIMITS.heartbeatMs);
  // Signed out elsewhere (or the session expired): the stream ends. A check that can't run keeps it.
  const recheck = setInterval(() => {
    void currentUser(req).then((u) => { if (!closed && (!u || u.id !== user.id)) end(); }, () => undefined);
  }, INBOX_LIMITS.recheckMs);
  function end() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat); clearInterval(recheck);
    unsubscribe(); streams.delete(stream); release();
    res.end();
  }
  res.on("close", end);
  res.on("error", end);
  // Counted after subscribing, so a change in between is sent as an event too (never lost).
  try { send(await inboxCounts(user.id)); } catch (e) { console.error("[inbox stream] first count failed", e); end(); }
}
