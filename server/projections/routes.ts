// GET /api/projections/:season/:code         the stored runs (store.ts); never simulates.
// GET /api/projections/:season/:code/stream  server-sent events for an open event page: one
//   `projections` event each time the job stores a new run of this event (data {computedAt, runs,
//   through}); the page then re-reads the stored runs. Public (no sign-in), like the page itself.
//     event: ready        connected; data {}
//     event: projections  a new run is stored
//     : ping              every 25 s (proxies drop silent connections)
// With the owner's realtime switch off, or too many streams open, it answers 503 and the page falls
// back to re-reading the stored runs whenever the event's own results refresh.
import type { Request, Response } from "express";
import { openLiveConnection } from "../liveConnections.js";
import { onProjections } from "./bus.js";

export const STREAM_LIMITS = { total: 500, heartbeatMs: 25_000 };

const open = new Set<Response>();

export function projectionStream(season: number, code: string, req: Request, res: Response): void {
  if (open.size >= STREAM_LIMITS.total) {
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "Too many live connections right now; the page refreshes on its own instead." });
    return;
  }
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.flushHeaders?.();
  open.add(res);
  const done = openLiveConnection("projections-stream");
  res.write("retry: 15000\n\nevent: ready\ndata: {}\n\n");
  const off = onProjections((n) => {
    if (n.season !== season || n.code !== code) return;
    res.write(`event: projections\ndata: ${JSON.stringify({ computedAt: n.computedAt, runs: n.runs, through: n.through })}\n\n`);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), STREAM_LIMITS.heartbeatMs);
  ping.unref?.();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping); off(); done(); open.delete(res);
  };
  req.on("close", close);
  res.on("close", close);
}

/** End every open projections stream (SIGTERM: clients reconnect to the next server). */
export function closeProjectionStreams(): void {
  for (const res of [...open]) { try { res.end(); } catch { /* already gone */ } }
  open.clear();
}

export const openProjectionStreams = () => open.size;
