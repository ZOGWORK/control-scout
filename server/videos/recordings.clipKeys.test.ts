// "With video" lists only matches an answer can play (search video brief, point 5): a match's own video counts when
// it is a YouTube link, never an empty or other link (server/videos/recordings.ts seasonClipKeys).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { forgetRecordings, seasonClipKeys } from "./recordings";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (2025, 'USNJQ1', 'New Jersey Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2026-01-10', '2026-01-10', 'America/New_York', 't')");
  for (const [n, video] of [[1, "https://www.youtube.com/watch?v=4elyC6MxtEY"], [2, ""], [3, "https://example.com/match3"], [4, null]] as const) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, video, source) VALUES (2025, 'USNJQ1', 'qual', 0, ?, ?, '2026-01-10T10:00:00', 1, ?, 't')", [n, `Q${n}`, video]);
  }
  forgetRecordings();
});

describe("seasonClipKeys", () => {
  it("counts a match's own video only when it plays", async () => {
    expect([...(await seasonClipKeys(2025))]).toEqual(["USNJQ1|qual|0|1"]);
  });
});
