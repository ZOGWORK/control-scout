// Prediction vs result lists every match the team played at the event, a stored call or not: a match with none (a
// lineup the engine couldn't read, as a no-show's) is a row with no "Before", and the record counts it (launch audit D4).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { forecastAt } from "./forecast";

const S = 2025;
beforeAll(async () => {
  const c = openDb(":memory:"); setDb(c); await migrate(c);
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'EB', 'East Bergen', 'LeagueTournament', '2026-03-08', '2026-03-08', 't')", [S]);
  for (const [n, time, red, blue, rs, bs, call] of [[1, "2026-03-08T10:00", [1, 2], [3, 4], 100, 50, true], [2, null, [5, 6], [1, 7], 30, 140, false], [3, "2026-03-08T12:00", [1, 8], [3, 9], 90, 60, true]] as const) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'EB', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [S, n, `Q${n}`, time, rs, rs, bs, bs]);
    for (const [al, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'EB', 'qual', 0, ?, ?, ?, ?)", [S, n, t, al, t === 5 ? 0 : 1]);
    if (call) await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at)
      VALUES ('backtest', ?, 'EB', 'qual', 0, ?, ?, ?, 0.7, 90, 70, 'solid', 't', '2026-03-08')`, [S, n, JSON.stringify(red), JSON.stringify(blue)]);
  }
  // A playoff team 1 sat out (benched, on_field 0): not its match, so not listed and not on its record.
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'EB', 'playoff', 1, 1, 'M1', '2026-03-08T15:00', 1, 120, 120, 40, 40, 't')", [S]);
  for (const [t, al, on] of [[3, "red", 1], [9, "red", 1], [1, "blue", 0], [2, "blue", 1], [8, "blue", 1]] as const)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'EB', 'playoff', 1, 1, ?, ?, ?)", [S, t, al, on]);
});

describe("prediction vs result", () => {
  it("lists every played match, the one with no stored call (and no time) too, in order; a benched playoff is not its match", async () => {
    const a = await forecastAt([{ number: 1, name: "One" }], { season: S, code: "EB", name: "East Bergen", type: "LeagueTournament", start: "2026-03-08", end: "2026-03-08" } as never, true, Date.parse("2026-11-10T00:00:00Z"));
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table?.kind === "table" && table.rows.map((r) => [r.cells.match, r.cells.before === "No call stored"])).toEqual([["Q1", false], ["Q2", true], ["Q3", false]]);
    const kpis = a.blocks.find((b) => b.kind === "kpis");
    expect(kpis?.kind === "kpis" && kpis.items.find((i) => i.label === "After: record")?.value).toBe("3-0-0");
    expect(kpis?.kind === "kpis" && kpis.items.find((i) => i.label === "Called right")?.value).toBe("2 of 2");
    expect(a.headline?.label).toContain("1 more played with none stored: 3-0-0 in all");
  });
  it("a team whose every match has no call stored: the record, said so, never the event's odds", async () => {
    const a = await forecastAt([{ number: 6, name: "Six" }], { season: S, code: "EB", name: "East Bergen", type: "LeagueTournament", start: "2026-03-08", end: "2026-03-08" } as never, true, Date.parse("2026-11-10T00:00:00Z"));
    expect(a.headline).toMatchObject({ value: "0-1-0", label: "record, no call stored for that match" });
  });
});
