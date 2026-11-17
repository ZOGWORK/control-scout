// An event's days for its videos: FIRST's listed dates, widened to the days it played. KZCMP 2022 is listed 2023-02-23
// to 02-25 and played its last qualifications and its playoffs on 02-26: the watcher's events, an owner's approval
// and a decision from evidence all take 02-26 as one of its days. A match not played, or an event that played
// nothing, leaves the listed dates as they are.
import { beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY } from "./eventDays";
import { eventsBetween } from "./officialWatch";
import { applyVideoDecisions } from "./videoDecisions";

const CH = "UCBXqD1Kn2u3mFnjHsHMMTKQ";
const days = (code: string) => get<{ a: string; b: string }>(`SELECT ${EVENT_FIRST_DAY} a, ${EVENT_LAST_DAY} b FROM events e WHERE e.season = 2022 AND e.code = ?`, [code]);

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2022, ?, ?, 'Championship', 'Almaty', NULL, 'Kazakhstan', ?, ?, 'Asia/Almaty', 0, 0, NULL, 'test')";
  await run(ev, ["KZCMP", "Kazakhstan Central Asia FTC Regional Championship", "2023-02-23", "2023-02-25"]);
  await run(ev, ["KZQUIET", "A meet that played nothing", "2023-02-25", "2023-02-25"]);
  const m = "INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2022, ?, ?, 0, ?, ?, ?, ?, 'test')";
  await run(m, ["KZCMP", "qual", 1, "Q1", "2023-02-25T10:11:48.455", 1]);
  await run(m, ["KZCMP", "qual", 32, "Q32", "2023-02-26T10:14:12.722", 1]);
  await run(m, ["KZCMP", "playoff", 99, "F2", "2023-02-26T16:34:52.085", 1]);
  // Scheduled for the next day, never played: not one of its days.
  await run(m, ["KZQUIET", "qual", 1, "Q1", "2023-02-27T10:00:00", 0]);
});

describe("an event's days", () => {
  it("are its listed dates, widened to the days it played", async () => {
    expect(await days("KZCMP")).toEqual({ a: "2023-02-23", b: "2023-02-26" });
    expect(await days("KZQUIET")).toEqual({ a: "2023-02-25", b: "2023-02-25" });
  });

  it("put a day it played outside its listed dates among the watcher's events", async () => {
    expect((await eventsBetween("2023-02-26", "2023-02-26")).map((e) => [e.code, e.start, e.end])).toEqual([["KZCMP", "2023-02-23", "2023-02-26"]]);
    expect((await eventsBetween("2023-02-27", "2023-02-27")).map((e) => e.code)).toEqual([]);
  });

  it("let a decision from evidence link a recording of that day", async () => {
    await run("INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES ('ZXdoZmDoHp0', ?, 'Kazakhstan FTC Regional Championship (PLAYOFF)', '2023-02-26T10:55:36Z', 'x', 'x')", [CH]);
    const r = await applyVideoDecisions(() => {}, [{ videoId: "ZXdoZmDoHp0", decision: "link", season: 2022, code: "KZCMP", day: "2023-02-26", part: "Playoff", evidence: "test" }], { again: true, now: Date.parse("2026-11-17T12:00:00Z"), lockWaitMs: 1000 });
    expect(r.skipped).toEqual([]);
    expect(await all("SELECT code, day, part FROM official_videos WHERE video_id = 'ZXdoZmDoHp0'")).toEqual([{ code: "KZCMP", day: "2023-02-26", part: "Playoff" }]);
  });
});
