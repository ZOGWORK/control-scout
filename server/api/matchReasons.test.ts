// Recent-record reasons (no-shows, near-zero matches) on unplayed matches come from the robots' form now, so
// they're added at read time to saved (logged) calls too, never to played matches, and never stored.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { matchViews } from "./matches";

const S = 2025;

async function match(n: number, played: boolean) {
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source)
     VALUES (?, 'EV', 'qual', 0, ?, ?, '2025-11-01T10:00:00', ?, ?, ?, ?, ?, 'test')`,
    [S, n, `Q${n}`, played ? 1 : 0, played ? 50 : null, played ? 50 : null, played ? 40 : null, played ? 40 : null],
  );
  for (const [t, a] of [[1, "red"], [2, "red"], [3, "blue"], [4, "blue"]] as const) {
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'EV', 'qual', 0, ?, ?, ?)", [S, n, t, a]);
  }
  // A call logged before the match (the saved one the page shows).
  await run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at)
     VALUES ('live', ?, 'EV', 'qual', 0, ?, '[1,2]', '[3,4]', 0.6, 60, 50, 'moderate', 'x', '2025-11-01T09:00:00Z')`,
    [S, n],
  );
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'EV', 'EV', 'Qualifier', '2025-11-01', '2025-11-01', 'UTC', 0, 0, 'test')", [S]);
  await run(
    `INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, idx, computed_at)
     VALUES (?, '', 3, 12, 2, 0, 0, 10, 10, 2, 0, 55, 'x')`,
    [S],
  );
  await match(1, false);
  await match(2, true);
});

describe("recent-record reasons on match rows", () => {
  it("are added to a saved live call on an unplayed match, and not to a played one", async () => {
    const views = await matchViews({ season: S, code: "EV" });
    const q1 = views.find((v) => v.number === 1)!, q2 = views.find((v) => v.number === 2)!;
    expect(q1.prediction?.kind).toBe("live");
    expect(q1.prediction?.reasons).toEqual(["Team 3 was a no-show in 2 of its last 10 matches"]);
    expect(q2.prediction?.kind).toBe("live");
    expect(q2.prediction?.reasons).toBeUndefined();
    // Never written to the ledger: the logged call stays exactly as it was.
    expect((await all<any>("SELECT factors FROM predictions WHERE number = 1"))[0].factors).toBeNull();
  });
});

describe("team names on match rows", () => {
  it("each lineup entry carries the team's name when we hold it, and leaves it out when we don't", async () => {
    await run("INSERT INTO teams (number, name) VALUES (1, 'Critical Mass'), (3, 'AArcHive')");
    const [q1] = await matchViews({ season: S, code: "EV" });
    expect(q1.red.teams.map((t) => t.name)).toEqual(["Critical Mass", undefined]);
    expect(q1.blue.teams.map((t) => t.name)).toEqual(["AArcHive", undefined]);
    expect("name" in q1.red.teams[1]).toBe(false);
  });
});
