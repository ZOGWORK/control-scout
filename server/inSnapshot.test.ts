// Reads that see one moment of the database (server/db.ts inSnapshot): on a database file, a write made meanwhile, by
// this process or another, is in none of them; every other read goes on meanwhile and sees it. In memory (one shared
// connection) there's no snapshot to hold: null, and the caller reads in one go.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { all, inSnapshot, migrate, openDb, run, setDb } from "./db";

const fileDb = async () => {
  const url = `file:${join(mkdtempSync(join(tmpdir(), "snapshot-")), "scout.db").replace(/\\/g, "/")}`;
  const c = openDb(url);
  setDb(c);
  await migrate(c);
  await run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  await run("INSERT INTO t (id) VALUES (1), (2)");
  return url;
};
const count = (rows: { n: number }[]) => Number(rows[0].n);

describe("inSnapshot", () => {
  it("keeps its moment while this process writes, and every other read sees the write at once", async () => {
    await fileDb();
    const seen = await inSnapshot(async (read) => {
      const before = count(await read<{ n: number }>("SELECT COUNT(*) n FROM t"));
      await run("INSERT INTO t (id) VALUES (3)");
      const outside = count(await all<{ n: number }>("SELECT COUNT(*) n FROM t"));
      const after = count(await read<{ n: number }>("SELECT COUNT(*) n FROM t"));
      return { before, outside, after };
    });
    expect(seen).toEqual({ before: 2, outside: 3, after: 2 });
    expect(count(await all<{ n: number }>("SELECT COUNT(*) n FROM t"))).toBe(3);
  });

  it("keeps its moment while another process's connection writes", async () => {
    const url = await fileDb();
    const other = openDb(url);
    const seen = await inSnapshot(async (read) => {
      const before = count(await read<{ n: number }>("SELECT COUNT(*) n FROM t"));
      await other.execute("INSERT INTO t (id) VALUES (3)");
      return [before, count(await read<{ n: number }>("SELECT COUNT(*) n FROM t"))];
    });
    other.close();
    expect(seen).toEqual([2, 2]);
  });

  it("lets go of its connection when its work throws", async () => {
    await fileDb();
    await expect(inSnapshot(async (read) => { await read("SELECT 1"); throw new Error("no"); })).rejects.toThrow("no");
    await run("INSERT INTO t (id) VALUES (3)");
    expect(await inSnapshot(async (read) => count(await read<{ n: number }>("SELECT COUNT(*) n FROM t")))).toBe(3);
  });

  it("holds one on any database file, however its client was made", async () => {
    const url = `file:${join(mkdtempSync(join(tmpdir(), "snapshot-")), "scout.db").replace(/\\/g, "/")}`;
    const made = openDb(url);
    setDb(made);
    await migrate(made); // write-ahead logging, as the server's database is
    await run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    setDb(createClient({ url }));
    const seen = await inSnapshot(async (read) => {
      const before = (await read("SELECT id FROM t")).length;
      await run("INSERT INTO t (id) VALUES (1)");
      return [before, (await read("SELECT id FROM t")).length];
    });
    expect(seen).toEqual([0, 0]);
  });

  it("is null on a file without write-ahead logging, where a held read would lock out every writer", async () => {
    const url = `file:${join(mkdtempSync(join(tmpdir(), "snapshot-")), "scout.db").replace(/\\/g, "/")}`;
    setDb(createClient({ url }));
    await run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    let ran = false;
    expect(await inSnapshot(async () => { ran = true; })).toBeNull();
    expect(ran).toBe(false);
  });

  it("is null in memory, its work never run: one connection shared by every read", async () => {
    let ran = false;
    for (const url of [":memory:", "file::memory:"]) {
      setDb(createClient({ url }));
      expect(await inSnapshot(async () => { ran = true; }), url).toBeNull();
    }
    setDb(openDb(":memory:"));
    expect(await inSnapshot(async () => { ran = true; })).toBeNull();
    expect(ran).toBe(false);
  });
});
