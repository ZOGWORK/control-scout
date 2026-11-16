// A long run of reads lets other requests in (server/db.ts busyTurn): the driver answers a local read without giving
// the event loop back, so before this a search making hundreds of quick reads in a row held every other request,
// /api/health among them, for its whole run (12 s live, #1557).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { all, busyTurn, get, migrate, openDb, run, setDb, SLICE_MS } from "./db";

/** Work between reads that holds the thread, as a search's own reckoning does. */
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* reckoning */ } };

/** A search answered from the database: `reads` reads in a row, `ms` of work after each. */
async function search(reads: number, ms: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < reads; i++) {
    n += (await all<{ v: number }>("SELECT v FROM t WHERE id = ?", [1 + (i % 50)]))[0].v;
    if (i % 2) await get("SELECT COUNT(*) n FROM t");
    busy(ms);
  }
  return n;
}

let server: Server | null = null;
beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
  for (let i = 1; i <= 50; i++) await run("INSERT INTO t (id, v) VALUES (?, ?)", [i, i]);
});
afterEach(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null; });

describe("busyTurn", () => {
  it("answers a health check in well under 500 ms while a 3 s run of reads is under way", async () => {
    server = createServer((_req, res) => res.end('{"ok":true}'));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
    // Asked just after the search starts, as the app's connection check is: the server itself, over HTTP.
    let healthMs = Infinity;
    const searching = search(1000, 3);
    const t0 = performance.now();
    const health = fetch(url).then((r) => r.json()).then((b) => { healthMs = performance.now() - t0; return b; });
    const [sum, body] = await Promise.all([searching, health]);
    const searchMs = performance.now() - t0;
    expect(body).toEqual({ ok: true });
    expect(sum).toBe(25_500); // the same reads, the same answers
    expect(searchMs).toBeGreaterThan(2500);
    expect(healthMs).toBeLessThan(500);
  });

  it("gives a timer due meanwhile its turn within a few slices, not after the whole run", async () => {
    const searching = search(400, 2);
    const t0 = performance.now();
    let late = Infinity;
    setTimeout(() => { late = performance.now() - t0; }, 0);
    await searching;
    expect(performance.now() - t0).toBeGreaterThan(700);
    expect(late).toBeLessThan(SLICE_MS * 5);
  });

  it("costs nothing to reads that never hold the thread: no extra turn of the loop for them", async () => {
    // Let the loop turn, then read a few times quickly: busyTurn waits for no turn while under SLICE_MS.
    await new Promise<void>((r) => setImmediate(r));
    await busyTurn();
    let turned = false;
    setImmediate(() => { turned = true; });
    for (let i = 0; i < 5; i++) await get("SELECT v FROM t WHERE id = 1");
    expect(turned).toBe(false);
  });
});
