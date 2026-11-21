// A write waiting for another process's write lock leaves the event loop free (server/db.ts lockWait): SQLite's busy
// timeout waited by sleeping the thread, so on event days a write behind the data cycle's child process held every
// request (/api/health, searches) for up to 5 s.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { lockBusy, lockWait, migrate, openDb } from "./db";

const dirs: string[] = [];
// Windows can still hold a file a moment after its last handle closed: a temp folder left behind is harmless.
afterEach(() => { for (const d of dirs.splice(0)) try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } });

/** Another process holding the database's write lock for `ms`: resolves once it holds it, with when it lets go. */
async function holdLock(file: string, ms: number): Promise<{ released: Promise<void> }> {
  const script = join(file, "..", "holder.mjs");
  writeFileSync(script, `
    import { createClient } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("@libsql/client")).href)};
    const c = createClient({ url: ${JSON.stringify(`file:${file}`)} });
    const tx = await c.transaction("write");
    await tx.execute("INSERT INTO t (v) VALUES (0)");
    console.log("holding");
    setTimeout(async () => { await tx.commit(); process.exit(0); }, ${ms});
  `);
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
  const done = new Promise<void>((r) => child.on("exit", () => r()));
  await new Promise<void>((r, j) => { child.stdout.on("data", (d) => { if (String(d).includes("holding")) r(); }); child.on("exit", () => j(new Error("holder exited"))); });
  return { released: done };
}

describe("lockWait", () => {
  it("waits for another process's write with the event loop turning, then writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    dirs.push(dir);
    const file = join(dir, "t.db").replace(/\\/g, "/");
    const c = openDb(`file:${file}`);
    await migrate(c);
    await c.execute("CREATE TABLE t (v INTEGER)");
    const { released } = await holdLock(file, 1500);
    let gap = 0, last = performance.now();
    const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; }, 5);
    try {
      const t0 = performance.now();
      await c.execute("INSERT INTO t (v) VALUES (1)");
      // It waited for the holder (it can't have written before), and the loop never stood still meanwhile.
      expect(performance.now() - t0).toBeGreaterThan(500);
      await new Promise((r) => setTimeout(r, 30)); // the tick that measures a loop held until now
      expect(gap).toBeLessThan(400);
      const [b] = await c.batch([{ sql: "INSERT INTO t (v) VALUES (2)", args: [] }], "write");
      expect(b.rowsAffected).toBe(1);
      expect((await c.execute("SELECT COUNT(*) AS n FROM t")).rows[0].n).toBe(3);
    } finally {
      clearInterval(tick);
      await released;
      c.close();
    }
  }, 30_000);

  it("gives up with SQLITE_BUSY after its budget, and never retries other errors", async () => {
    let tries = 0;
    const busy = Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" });
    await expect(lockWait(async () => { tries++; throw busy; }, 400)).rejects.toBe(busy);
    expect(tries).toBeGreaterThan(2);
    tries = 0;
    const other = Object.assign(new Error("no such table"), { code: "SQLITE_ERROR" });
    await expect(lockWait(async () => { tries++; throw other; })).rejects.toBe(other);
    expect(tries).toBe(1);
    expect(await lockWait(async () => (++tries > 2 ? "ok" : Promise.reject(busy)))).toBe("ok");
    expect(lockBusy({ rawCode: 517 })).toBe(true); // SQLITE_BUSY_SNAPSHOT
    expect(lockBusy(new Error("x"))).toBe(false);
  });
});
