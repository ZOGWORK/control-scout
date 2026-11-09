// Stat answers keep the real order of things: matches in their event's own order when a played match has no time,
// a coming event (a roster posted early) is never a team's latest, and a league meet's stored rank (the league's
// running standing) is never shown as the team's finish at that meet.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [207, "Critical Mass"], [23268, "Ultraviolet"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
  }
  const ev = (code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [code, name, type, start, start]);
  await ev("USNJLM1", "Northern League Meet 1", "LeagueMeet", "2026-01-10");
  await ev("USNJQ9", "New Jersey Qualifier 9", "Qualifier", "2099-03-01");
  for (const code of ["USNJLM1", "USNJQ9"]) for (const t of [4215, 6980, 207, 23268]) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, ?)", [code, t, code === "USNJLM1" && t === 4215 ? 1 : null]);
  const match = (n: number, time: string | null, red: number, blue: number) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJLM1', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [n, `Q${n}`, time, red, red, blue, blue]),
    ...[[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]].map(([t, a]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJLM1', 'qual', 0, ?, ?, ?, 1)", [n, t, a])),
  ]);
  // Q1 timed and won; Q2, played later, has no time and was lost.
  await match(1, "2026-01-10T10:00:00Z", 100, 50);
  await match(2, null, 40, 90);
  // A classic bracket stores its final as series 0, its semifinal as series 1: 6980 plays SF1-1, then F1.
  for (const [series, label] of [[1, "SF1-1"], [0, "F1"]] as const) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJLM1', 'playoff', ?, 1, ?, NULL, 1, 50, 50, 60, 60, 't')", [series, label]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJLM1', 'playoff', ?, 1, 6980, 'blue', 1)", [series]);
  }
  // 2026–27: 207 is on a league roster in a played match but never took the field.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USNJLM9', 'Southern League Meet 1', 'LeagueMeet', 'Hillsborough', 'NJ', 'USA', '2026-10-20', '2026-10-20', 't')");
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2026, 'USNJLM9', 'qual', 0, 1, 'Q1', '2026-10-20T10:00:00Z', 1, 80, 80, 70, 70, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, 'USNJLM9', 'qual', 0, 1, 207, 'red', 0)");
  await rebuildSearch();
});

describe("order", () => {
  it("this season is the latest one the team took the field in, not one it is only on a roster for", async () => {
    const a = await searchAnswer("207 average score this season", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "70.0", sub: expect.stringMatching(/^2025–26/) });
  });
  it("a played match without a time keeps its place in the event", async () => {
    expect((await searchAnswer("4215 most recent match", { limit: 25 })).stat!.headline).toMatchObject({ label: "Q2 at Northern League Meet 1" });
    expect((await searchAnswer("4215 current streak", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 loss" });
  });
  it("a final (series 0) comes after its semifinals", async () => {
    expect((await searchAnswer("6980 most recent match", { limit: 25 })).stat!.headline).toMatchObject({ label: "F1 at Northern League Meet 1" });
  });
  it("a coming event is never the latest; a league meet shows its league standing, not a finish", async () => {
    const a = await searchAnswer("4215 last event", { limit: 25 });
    expect(a.stat!.headline).toMatchObject({ value: "Northern League Meet 1", label: "League standing #1 of 1" });
    // The events table says it too, marked as the league's standing (the owner, 11-09: the rank was missing).
    const rows = a.stat!.blocks.find((b) => b.kind === "table");
    expect(rows && rows.kind === "table" && rows.rows[0].cells.rank).toBe("#1 of 1 league");
    expect((await searchAnswer("4215 total events", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 event" });
  });
});
