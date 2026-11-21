// A season's video page small enough to list every match (./highlights.ts galleryOf): "No match videos yet" only when
// no listed match has one (issue #1997: 2 of 2026–27's 158 matches with video, and the page said there were none).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const videos = async () => {
  const s = (await searchAnswer("bio buzz videos", { limit: 25, full: true, now: NOW })).stat as StatAnswer;
  return s.blocks.find((b) => b.kind === "videos") as Extract<StatBlock, { kind: "videos" }>;
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const n of [101, 102]) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'TX', 'USA')", [n, `Team ${n}`]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USTXQ1', 'Lone Star Qualifier', 'Qualifier', 'Town', 'TX', 'USA', '2026-10-10', '2026-10-10', 't')");
  for (let i = 1; i <= 4; i++) {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, blue_total, blue_np, blue_auto, video, source)
      VALUES (2026, 'USTXQ1', 'qual', 0, ?, ?, '2026-10-10T10:00:00Z', 1, ?, ?, 10, 50, 50, 10, ?, 't')`, [i, `Q${i}`, 100 + i, 100 + i, i <= 2 ? `https://www.youtube.com/watch?v=video${i}abcde` : null]);
    for (const [t, a] of [[101, "red"], [102, "blue"]] as const)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, 'USTXQ1', 'qual', 0, ?, ?, ?, 1)", [i, t, a]);
  }
  await rebuildSearch();
  clearAllCaches();
});

describe("a season's match videos, every match listed (issue #1997)", () => {
  it("two of its matches with video: every match listed, no line saying there are none", async () => {
    const v = await videos();
    expect(v.title).toBe("Every match");
    expect(v.tiles.map((t) => t.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(v.empty).toBeUndefined();
  });

  it("none with video: says so", async () => {
    await run("UPDATE matches SET video = NULL");
    clearAllCaches();
    expect((await videos()).empty?.text).toBe("No match videos in 2026–27 yet.");
  });
});
