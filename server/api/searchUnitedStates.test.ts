// "united states" is the country, never "<place> states" read as the place's championship (execute.ts's states rule
// skips it; Loopy, PR #1579: the guard's regex had lost its word boundaries). An event "United Championship" is where
// such a misreading would land.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [code, name] of [["USUNCMP", "United Championship"], ["USNJCMP", "New Jersey Championship"]]) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, 'Championship', 'Town', 'NJ', 'USA', '2026-03-14', '2026-03-14', 't')", [code, name]);
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'playoff', 6, 1, 'F1', 1, 300, 300, 200, 200, 't')", [code]);
  }
  await rebuildSearch();
});

describe("\"united states\" is the country", () => {
  it("is never read as a championship named for the word before \"states\"", async () => {
    for (const q of ["united states matches", "best match in the united states", "United States matches", "top matches united states"]) {
      const a = await ask(q);
      expect(JSON.stringify([a.understood?.label, a.stat?.title]), q).not.toMatch(/United Championship/);
    }
  });
  it("\"<place> states\" still reads the place's championship", async () => {
    expect((await ask("nj states matches")).stat?.title).toMatch(/New Jersey Championship/);
  });
});
