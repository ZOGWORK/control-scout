// A season's video page (./highlights.ts withVideo): a scope with too many matches to list lists its matches with
// video, never its standout matches with none (issue #1997: "bio buzz videos").
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { answerVideo } from "../answers/video";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const n of [101, 102, 103, 104]) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'TX', 'USA')", [n, `Team ${n}`]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  const ev = (code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'Qualifier', 'Town', 'TX', 'USA', ?, ?, 't')", [code, name, start, start]);
  await ev("USTXQ1", "Lone Star Qualifier", "2026-10-10");
  await ev("USTXQ2", "Prairie Qualifier", "2026-10-17");
  let n = 0;
  const match = async (code: string, level: "qual" | "playoff", label: string, day: string, red: number, blue: number, video: string | null = null) => {
    n++;
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, blue_total, blue_np, blue_auto, video, source)
      VALUES (2026, ?, ?, ?, ?, ?, ?, 1, ?, ?, 10, ?, ?, 10, ?, 't')`, [code, level, level === "playoff" ? 1 : 0, n, label, `${day}T10:00:00Z`, red, red, blue, blue, video]);
    for (const [t, a] of [[101, "red"], [102, "red"], [103, "blue"], [104, "blue"]] as const)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, ?, ?, ?, ?, ?, ?, 1)", [code, level, level === "playoff" ? 1 : 0, n, t, a]);
  };
  // More matches than a video page lists (GALLERY), the season's best scores with no video; three with video.
  for (let i = 1; i <= 240; i++) await match("USTXQ1", "qual", `Q${i}`, "2026-10-10", 200 + (i % 50), 100);
  await match("USTXQ2", "qual", "Q1", "2026-10-17", 120, 90, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  await match("USTXQ2", "qual", "Q2", "2026-10-17", 150, 80, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  await match("USTXQ2", "playoff", "M1", "2026-10-17", 110, 100, "https://www.youtube.com/watch?v=ccccccccccc");
  await rebuildSearch();
  clearAllCaches();
});

describe("a season's match videos (issue #1997)", () => {
  it("bio buzz videos: the season's matches with video, the latest playoff match first, then the best", async () => {
    const a = await ask("bio buzz videos");
    const s = a.stat as StatAnswer;
    expect(s.title).toBe("Match videos, 2026–27");
    expect(s.blocks.map((b) => b.kind)).toEqual(["videos"]);
    const v = s.blocks[0] as Extract<StatBlock, { kind: "videos" }>;
    expect(v.title).toBe("Matches with video");
    // One event's matches: the tiles name no event.
    expect(v.tiles.map((t) => `${t.href} ${t.label}`)).toEqual(["/events/2026/USTXQ2?match=playoff:1:243 M1", "/events/2026/USTXQ2?match=qual:0:242 Q2", "/events/2026/USTXQ2?match=qual:0:241 Q1"]);
    expect(v.more).toBeUndefined();
    const video = await answerVideo(a, NOW);
    expect(video?.main).toMatchObject({ videoId: "ccccccccccc", kind: "match", match: "M1" });
    expect(Object.keys(video?.rows ?? {})).toHaveLength(2);
  });
});
