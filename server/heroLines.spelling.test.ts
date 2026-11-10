// Migration 80: the saved hero line "Scouting, Remagined" reads "Reimagined"; other lines are left as they are.
import { describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";

describe("migration 80: hero line spelling", () => {
  it("fixes the word in either part, and only there", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c, 79);
    const at = "2026-11-01T00:00:00.000Z";
    await run("INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at) VALUES (0, 'Scouting,', 'Remagined', 1, ?, ?)", [at, at]);
    await run("INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at) VALUES (1, 'Remagined scouting', 'for FTC', 1, ?, ?)", [at, at]);
    await run("INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at) VALUES (2, 'Know the match', 'before it starts.', 1, ?, ?)", [at, at]);
    await migrate(c);
    const rows = await all<{ plain: string; accent: string; updated_at: string }>("SELECT plain, accent, updated_at FROM hero_lines ORDER BY position");
    expect(rows.map((r) => `${r.plain} ${r.accent}`)).toEqual(["Scouting, Reimagined", "Reimagined scouting for FTC", "Know the match before it starts."]);
    expect(rows[2].updated_at).toBe(at);
  });
});
