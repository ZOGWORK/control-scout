// "Beat" before a phase is "best" mistyped (failed search #2043: "Texpand beat auto in into the deep"): no match is
// beaten by a phase, so it reads as the team's highest score in that phase, as "best auto" does. "Beat" before a team
// is still a win.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

const box = (q: string) => searchAnswer(q, { limit: 25 });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[18763, "Texpand"], [4215, "Hypnotic Robotics"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'TX', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USTXQ1', 'Austin Qualifier', 'Qualifier', 'Austin', 'TX', 'USA', '2025-01-11', '2025-01-11', 't')");
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, red_auto, blue_auto, source) VALUES (2024, 'USTXQ1', 'qual', 0, 1, 'Q1', '2025-01-11T10:00:00Z', 1, 120, 120, 90, 90, 40, 20, 't')");
  for (const [t, a] of [[18763, "red"], [4215, "blue"]] as const) {
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2024, 'USTXQ1', 'qual', 0, 1, ?, ?, 1)", [t, a]);
  }
  await rebuildSearch();
});

describe("\"beat\" before a phase", () => {
  it("is the team's highest score in that phase, as \"best\" is (Texpand, Hypnotic Robotics)", async () => {
    for (const [team, label] of [["Texpand", "Texpand (18763)"], ["hypnotic robotics", "Hypnotic Robotics (4215)"]] as const) {
      for (const [phase, title] of [["auto", "Auto"], ["teleop", "TeleOp"], ["endgame", "Endgame"]] as const) {
        const q = `${team} beat ${phase} in into the deep`;
        const a = await box(q);
        expect(a.step, q).toBe("deterministic");
        expect(a.understood?.label, q).toBe(`${label} · Highest ${title} score in 2024–25`);
        expect(a.understood?.label, q).toBe((await box(`${team} best ${phase} in into the deep`)).understood?.label);
      }
    }
  });
  it("before a team it is still a win: their head to head", async () => {
    expect((await box("did 18763 beat 4215")).understood?.label).toBe("Head to head: Texpand (18763) vs Hypnotic Robotics (4215)");
  });
});
