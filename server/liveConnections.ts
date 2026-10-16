// Open live connections (server-sent event streams), counted for the owner portal's Usage panel.
//
// The workspace live stream (server/scout/stream.ts, "scout-stream") and anything else that holds a connection open registers
// each one here and releases it when it closes:
//
//   const done = openLiveConnection("event-stream");
//   req.on("close", done);
//
// Counts are per server process; the portal shows this process's.
const open = new Map<string, number>();
let peak = 0;
let peakAt: string | null = null;

/** Count one open connection of `kind`; call the returned function once when it closes (extra calls do nothing). */
export function openLiveConnection(kind = "stream"): () => void {
  open.set(kind, (open.get(kind) ?? 0) + 1);
  const total = liveConnectionCount();
  if (total > peak) { peak = total; peakAt = new Date().toISOString(); }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const n = (open.get(kind) ?? 1) - 1;
    if (n > 0) open.set(kind, n); else open.delete(kind);
  };
}

/** Open connections right now, all kinds together. */
export function liveConnectionCount(): number {
  let n = 0;
  for (const v of open.values()) n += v;
  return n;
}

/** Open connections by kind, plus the most at once since this process started. */
export function liveConnections(): { total: number; byKind: Record<string, number>; peak: number; peakAt: string | null } {
  return { total: liveConnectionCount(), byKind: Object.fromEntries(open), peak, peakAt };
}

/** Tests: back to none. */
export function resetLiveConnections(): void { open.clear(); peak = 0; peakAt = null; }
