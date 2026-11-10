// A large read a chunk at a time (server/db.ts allInChunks): every row, in key order, once, whatever the chunk size,
// and the event loop let go between chunks so requests waiting behind the read are answered.
import { beforeEach, describe, expect, it } from "vitest";
import { all, allInChunks, migrate, openDb, run, setDb } from "./db";

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, keep INTEGER)");
  for (let i = 1; i <= 25; i++) await run("INSERT INTO t (id, v, keep) VALUES (?, ?, ?)", [i * 3, `v${i}`, i % 4 === 0 ? 0 : 1]);
});

describe("allInChunks", () => {
  it("returns what one read returns, in key order, at any chunk size", async () => {
    const whole = await all<{ id: number; v: string }>("SELECT id, v FROM t WHERE keep = ? ORDER BY id", [1]);
    for (const size of [1, 4, 7, 18, 19, 100]) {
      expect(await allInChunks<{ id: number; v: string }>("SELECT id, v FROM t WHERE keep = ? AND id > ?", [1], "id", size), `size ${size}`).toEqual(whole);
    }
  });

  it("returns nothing for an empty read", async () => {
    expect(await allInChunks("SELECT id FROM t WHERE keep = 5 AND id > ?", [], "id", 4)).toEqual([]);
  });

  it("lets the event loop go between chunks", async () => {
    let turns = 0;
    let on = true;
    const spin = () => { if (!on) return; turns++; setImmediate(spin); };
    setImmediate(spin);
    await allInChunks("SELECT id FROM t WHERE id > ?", [], "id", 5);
    on = false;
    // Five full chunks and an empty one: the loop ran between them.
    expect(turns).toBeGreaterThanOrEqual(4);
  });
});
