// Settled events fetched before the sync read FIRST's advancement points get them later: finished events with a
// published advancement list and no stored points, a bounded few per sync; an event FIRST has no points for is
// remembered and never asked about again; a failed request is retried next time.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { backfillAdvancementPoints } from "./advancementPoints";

const S = 2026;

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  for (const [code, end] of [["DONE1", "2026-10-01"], ["DONE2", "2026-10-02"], ["EMPTY", "2026-10-03"], ["LATER", "2026-12-01"], ["HAVE", "2026-10-04"]]) {
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'first')", [S, code, code, end, end]);
    await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (?, ?, 5, 'CMP', '[]')", [S, code]);
  }
  await run("INSERT INTO advancement_points (season, code, team, total, awards, playoffs, alliance, quals) VALUES (?, 'HAVE', 1, 10, 0, 0, 0, 10)", [S]);
});

describe("advancement points backfill", () => {
  it("fills finished events without points, remembers the ones FIRST has none for, and retries failures", async () => {
    const asked: string[] = [];
    const fetch = async (path: string) => {
      asked.push(path);
      if (path.includes("/DONE1/")) return [{ team: 7, points: [70, 12, 40, 15, 3, 1, 1, 1, 1, 1] }];
      if (path.includes("/DONE2/")) throw new Error("FIRST 503");
      return [];
    };
    expect(await backfillAdvancementPoints(S, { today: "2026-10-31", fetch })).toEqual({ filled: 1, none: 1, failed: 1 });
    expect(asked).toEqual([`/${S}/advancement/DONE1/points`, `/${S}/advancement/DONE2/points`, `/${S}/advancement/EMPTY/points`]);
    expect(await all("SELECT code, team, total, playoffs FROM advancement_points WHERE code = 'DONE1'")).toEqual([{ code: "DONE1", team: 7, total: 70, playoffs: 40 }]);

    asked.length = 0;
    expect(await backfillAdvancementPoints(S, { today: "2026-10-31", fetch })).toEqual({ filled: 0, none: 0, failed: 1 });
    expect(asked).toEqual([`/${S}/advancement/DONE2/points`]);
  });

  it("asks about at most `limit` events, and nothing before 2025–26", async () => {
    const asked: string[] = [];
    await backfillAdvancementPoints(S, { today: "2026-10-31", limit: 1, fetch: async (p) => { asked.push(p); return []; } });
    expect(asked.length).toBe(1);
    expect(await backfillAdvancementPoints(2024, { fetch: async () => { throw new Error("not asked"); } })).toEqual({ filled: 0, none: 0, failed: 0 });
  });
});
