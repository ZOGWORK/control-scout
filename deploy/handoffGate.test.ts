import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { databaseUrl, migrationVersions, restartReasons, searchSchema } from "./handoff-gate.mjs";
import { MIGRATIONS } from "../server/db.js";
import { SEARCH_INDEX_SCHEMA } from "../server/api/search.js";

describe("handoff gate", () => {
  it("reads this repo's migrations and search schema from the source, as the deploy does", () => {
    expect(migrationVersions(readFileSync("server/db.ts", "utf8"))).toEqual(MIGRATIONS.map((m) => m.version));
    expect(searchSchema(readFileSync("server/api/search.ts", "utf8"))).toBe(SEARCH_INDEX_SCHEMA);
  });

  it("only counts versions inside MIGRATIONS", () => {
    const src = "const x = { version: 900, };\nexport const MIGRATIONS = [\n  {\n    version: 1,\n  },\n  {\n    version: 2,\n  },\n];\nconst y = {\n  version: 901,\n};\n";
    expect(migrationVersions(src)).toEqual([1, 2]);
    expect(migrationVersions("nothing here")).toBeNull();
  });

  it("reads DATABASE_URL from an env file, the last one winning, quotes dropped", () => {
    expect(databaseUrl("NODE_ENV=production\nDATABASE_URL=file:/a.db\nDATABASE_URL=\"file:/b.db\"\n")).toBe("file:/b.db");
    expect(databaseUrl("PORT=3100\n")).toBeNull();
  });

  it("hands off when the database already has every migration and the search schema", () => {
    expect(restartReasons({ migrations: [1, 2, 3], applied: [1, 2, 3], schema: 7, storedSearch: 7 })).toEqual([]);
    // A rollback: the database is ahead of the release. Nothing for the release to do at start.
    expect(restartReasons({ migrations: [1, 2], applied: [1, 2, 3], schema: 6, storedSearch: 7 })).toEqual([]);
  });

  it("restarts for a pending migration or a search index rebuild", () => {
    expect(restartReasons({ migrations: [1, 2, 3, 4], applied: [1, 2], schema: 7, storedSearch: 7 })).toEqual(["migration 3, 4 not applied yet"]);
    expect(restartReasons({ migrations: [1], applied: [1], schema: 8, storedSearch: 7 })).toEqual(["search index rebuilt at start (schema 7 → 8)"]);
    expect(restartReasons({ migrations: [1], applied: [1], schema: 7, storedSearch: null })).toEqual(["search index rebuilt at start (schema none → 7)"]);
  });

  it("restarts when it can't read the release", () => {
    expect(restartReasons({ migrations: null, applied: [], schema: null, storedSearch: 7 })).toEqual(["can't read the release's migrations", "can't read the release's search index schema"]);
  });
});
