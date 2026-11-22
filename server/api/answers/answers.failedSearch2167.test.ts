// Logged failed search #2167: "quality control average auto opr last 10 matches". A phase's OPR over a team's last N
// matches can't be solved from those matches alone (an OPR needs every team's matches at an event), so the answer is
// the closest real figure, labelled as exactly that: their alliance's average auto points over those N matches.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./season";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[21229, "Quality Control"], [30030, "Exodus"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Bellevue', 'WA', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rating_np, rating_matches, matches, wins, losses, ties) VALUES (2026, 21229, 140, 38, 150, 12, 12, 8, 4, 0)");
  for (const [code, name, day] of [["USWASAM1", "Salk League Meet 1", "2026-10-17"], ["USWASAM2", "Salk League Meet 2", "2026-11-14"]] as const) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Bellevue', 'WA', 'USA', ?, ?, 't')", [code, name, day, day]);
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, ?, 21229, 1)", [code]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, matches) VALUES (2026, ?, 21229, 140, 38, 6)", [code]);
  }
  // Twelve matches, six a meet; auto points 10, 20, … 120 in time order: the last 10 are 30…120, average 75.
  for (let i = 1; i <= 12; i++) {
    const code = i <= 6 ? "USWASAM1" : "USWASAM2", day = i <= 6 ? "2026-10-17" : "2026-11-14";
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, source)
      VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, 80, 20, 90, 90, 30, 50, 10, 't')`, [code, i, `Q${i}`, `${day}T${String(8 + i).padStart(2, "0")}:00:00Z`, 100 + i * 10, 100 + i * 10, i * 10]);
    for (const [t, a] of [[21229, "red"], [30030, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1)", [code, i, t, a]);
  }
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("a phase over the team's last N matches (#2167)", () => {
  it("answers the logged query with the alliance's average auto points, said so", async () => {
    const r = await full("quality control average auto opr last 10 matches");
    expect(r.stat).toMatchObject({
      title: "Auto points, last 10 matches",
      headline: { value: "75.0", label: "average alliance auto points over the last 10 matches, not an OPR", sub: expect.stringMatching(/auto 30, 40, 50, 60, 70, 80, 90, 100, 110, 120$/) },
      definition: expect.stringContaining("This is not an OPR"),
    });
    expect(r.understood).toMatchObject({ kind: "question", label: "Quality Control (21229) · Auto points, last 10 matches (not an OPR)" });
    // Every word read: "average", "auto" and "opr" are what the answer is.
    expect(r.understood?.unread ?? []).toEqual([]);
    const kp = r.stat!.blocks.find((b) => b.kind === "kpis");
    expect(kp && kp.kind === "kpis" && kp.items.map((i) => [i.label, i.value])).toEqual([["Average auto, last 10", "75.0"], ["Highest", "120"], ["Lowest", "30"]]);
  });
  it("leaves the plain last N matches as they were: the record and scores", async () => {
    expect((await full("quality control last 10 matches")).stat).toMatchObject({ title: "Last 10 matches", headline: { value: expect.stringMatching(/^\d+-\d+-\d+$/) } });
  });
});
