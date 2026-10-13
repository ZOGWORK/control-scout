// The shipped snapshot may only replace a database that can't lose anything.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { migrate, openDb } from "../db";
import { safeToReplace } from "./snapshot";

const fresh = () => join(mkdtempSync(join(tmpdir(), "cs-snap-")), "scout.db");
async function migrated(path: string, sql: string[] = []) {
  const c = openDb(`file:${path}`);
  await migrate(c);
  for (const s of sql) await c.execute(s);
  c.close();
}

describe("safeToReplace", () => {
  it("replaces a missing file or one with no tables", async () => {
    expect(await safeToReplace(fresh())).toBe(true);
    const p = fresh();
    createClient({ url: `file:${p}` }).close();
    expect(await safeToReplace(p)).toBe(true);
  });

  it("replaces a migrated database with no data at all", async () => {
    const p = fresh();
    await migrated(p);
    expect(await safeToReplace(p)).toBe(true);
  });

  it("keeps a database with accounts or scouting but no teams", async () => {
    const p = fresh();
    await migrated(p, ["INSERT INTO users (id, email, created_at) VALUES (1, 'coach@example.com', '2026-10-13')"]);
    expect(await safeToReplace(p)).toBe(false);
  });

  it("keeps a database with team data", async () => {
    const p = fresh();
    await migrated(p, ["INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics')"]);
    expect(await safeToReplace(p)).toBe(false);
  });

  it("keeps a file it can't read", async () => {
    const p = fresh();
    writeFileSync(p, "this is not a database, but it isn't empty either");
    expect(await safeToReplace(p)).toBe(false);
  });
});
