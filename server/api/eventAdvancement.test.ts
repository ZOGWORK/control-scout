// The event page's advancement (Sushil, 11-11): the next event's name from our events (never only its code), and
// FIRST's advancement points per team, in FIRST's advancement order.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { eventDetail } from "./events";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = (code: string, name: string, type: string) => run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (2025, ?, ?, ?, '2026-02-21', '2026-02-21', 0, 0, 'test')", [code, name, type]);
  await ev("USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament");
  await ev("USNJCMP", "New Jersey Championship", "Championship");
  await ev("USNJXX", "Somewhere League Tournament", "LeagueTournament");
  const order = [[4215, 136], [207, 105], [15762, 55], [12853, 49], [13617, 48]];
  await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (2025, 'USNJNOLT2', 5, 'USNJCMP', ?)", [JSON.stringify(order.map(([team]) => ({ team, status: "FIRST", declined: false })))]);
  for (const [team, total] of order) await run("INSERT INTO advancement_points (season, code, team, total, awards, playoffs, alliance, quals) VALUES (2025, 'USNJNOLT2', ?, ?, 0, 0, 0, 0)", [team, total]);
  await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (2025, 'USNJXX', 2, 'ZZCMP', ?)", [JSON.stringify([{ team: 1, status: "FIRST", declined: false }])]);
});

describe("an event's advancement", () => {
  it("names the next event and carries FIRST's points, in advancement order", async () => {
    const a = (await eventDetail(2025, "USNJNOLT2"))!.advancement!;
    expect(a).toMatchObject({ slots: 5, advancesTo: "USNJCMP", advancesToName: "New Jersey Championship" });
    expect(a.rows.map((r) => [r.team, r.points])).toEqual([[4215, 136], [207, 105], [15762, 55], [12853, 49], [13617, 48]]);
  });
  it("a code that isn't one of ours has no name, and no points posted reads null", async () => {
    const a = (await eventDetail(2025, "USNJXX"))!.advancement!;
    expect(a.advancesToName).toBeNull();
    expect(a.rows[0].points).toBeNull();
  });
});
