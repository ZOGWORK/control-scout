// A number written with thousands separators ("1,000") is one number all the way through search: the query
// cleaner, the parser and the layers, never team 1 and a leftover "000". A stored name written with one ("The Team of
// 10,000 Lakes") is still found by its whole name. A small fixture database.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { cleanQuery, searchAnswer } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { learn: false, limit: 40, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[1, "First Ones"], [12, "Dozen"], [10000, "The Team of 10,000 Lakes"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MN', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [CURRENT_SEASON, n]);
  }
  await rebuildSearch();
});

describe("a number with thousands separators", () => {
  it("is one number when the query is cleaned", () => {
    expect(cleanQuery("teams with opr over 1,000?")).toBe("teams with opr over 1000");
    expect(cleanQuery("4215, 6980")).toBe("4215 6980");
  });
  it("is a threshold, never team 1", async () => {
    const a = await ask("teams with opr over 1,000");
    expect(a.hits.some((h) => h.kind === "team" && h.ref === "1")).toBe(false);
    expect(a.stat?.title ?? a.understood?.label ?? "").toMatch(/\b1000\b/);
  });
  it("still finds a stored name written with one, by its whole name", async () => {
    expect((await ask("teams named The Team of 10,000 Lakes")).stat?.headline?.value).toBe("1 team");
  });
});
