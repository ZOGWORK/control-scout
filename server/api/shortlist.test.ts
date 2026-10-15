// /api/shortlist: the whole list in one request, with each team's season OPR
// split and event-by-event trend (oldest first), in the order asked.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";

const S = 2025;
let server: Server;
let base = "";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (101, 'Alpha', 'Sydney', 'NSW', 'Australia'), (102, 'Beta', NULL, NULL, 'USA')");
  for (const [code, start] of [["EARLY", "2025-10-01"], ["LATE", "2025-12-01"]]) {
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'test')", [S, code, `${code} Qualifier`, start, start]);
  }
  await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (?, 'EARLY', 101, 4, 3, 2, 0), (?, 'LATE', 101, 1, 5, 0, 0)", [S, S]);
  // Inserted late-first, to prove the trend is sorted by date.
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, avg_np) VALUES (?, 'LATE', 101, 80, 20, 45, 15, 120), (?, 'EARLY', 101, 50, 10, 30, 10, 90)", [S, S]);
  await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, wins, losses, ties, matches, events) VALUES (?, 101, 80, 20, 45, 15, 3, 500, 8, 2, 0, 10, 2)", [S]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("/api/shortlist", () => {
  it("returns summaries, the OPR split and the event trend for every team, in the order asked", async () => {
    const r = await fetch(`${base}/api/shortlist?teams=102,101&season=${S}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.teams.map((t: any) => t.team)).toEqual([102, 101]);
    const a = body.teams[1];
    expect(a).toMatchObject({ name: "Alpha", place: "Sydney, NSW, Australia", opr: 80, oprRank: 3, record: "8-2-0", breakdown: { auto: 20, teleop: 45, endgame: 15 } });
    expect(a.events.map((e: any) => [e.code, e.opr, e.rank])).toEqual([["EARLY", 50, 4], ["LATE", 80, 1]]);
    expect(a.events[0]).toMatchObject({ auto: 10, teleop: 30, endgame: 10, avgNp: 90, name: "EARLY Qualifier" });
    // A team without results this season still gets a row, just empty.
    expect(body.teams[0]).toMatchObject({ name: "Beta", opr: null, breakdown: { auto: null, teleop: null, endgame: null }, events: [] });
  });
  it("rejects a bad or oversized list", async () => {
    expect((await fetch(`${base}/api/shortlist?teams=abc`)).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
    expect((await fetch(`${base}/api/shortlist?teams=${many}`)).status).toBe(400);
  });
});
