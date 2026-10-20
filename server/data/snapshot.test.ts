// The shipped snapshot may only replace a database that can't lose anything.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { migrate, openDb } from "../db";
import { PRIVATE_TABLES, PUBLIC_TABLES, safeToReplace } from "./snapshot";

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

describe("every table is classified", () => {
  it("each table the migrations create is either public (shipped) or private (never shipped), never both", async () => {
    const p = fresh();
    await migrated(p);
    const c = createClient({ url: `file:${p}` });
    const names = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => String(r.name));
    c.close();
    // FTS5 shadow tables (search_data, search_fuzzy_idx, team_search_idx, …) belong to their virtual table.
    const own = names.filter((n) => !/^(search|search_fuzzy|team_search)_(data|idx|content|docsize|config)$/.test(n));
    const unclassified = own.filter((n) => !PUBLIC_TABLES.includes(n) && !PRIVATE_TABLES.includes(n));
    expect(unclassified, "add each new table to PUBLIC_TABLES or PRIVATE_TABLES in server/data/snapshot.ts").toEqual([]);
    expect(PUBLIC_TABLES.filter((t) => PRIVATE_TABLES.includes(t))).toEqual([]);
  });

  it("contact messages and usage stats are never shipped", () => {
    expect(PRIVATE_TABLES).toEqual(expect.arrayContaining(["contact_messages", "analytics_daily", "error_reports", "scout_entries"]));
  });
});
