// A team's answers in the finals only (the playoffs' last series, series 0), and a match told by its margin
// (failed-search #822, #897): the finals are a filter on the team's own match rows, never a whole-season number's.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readStatQuestion } from "./read";
import { longForm } from "../searchLongForm";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[5100, "Gear Grinders"], [5200, "Bolt Brigade"], [5300, "Torque Squad"], [5400, "Servo Saints"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Austin', 'TX', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2023, ?), (2025, ?)", [n, n]);
  }
  for (const [season, code, start] of [[2025, "USTXCMP", "2026-03-07"], [2023, "USTXCMP", "2024-03-09"]] as const)
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, 'Texas Championship', 'Championship', 'Austin', 'TX', 'USA', ?, ?, 't')", [season, code, start, start]);
  const match = (season: number, level: string, series: number, n: number, label: string, red: number, blue: number) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USTXCMP', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 't')",
      [season, level, series, n, label, `${season + 1}-03-0${season === 2025 ? 7 : 9}T${String(9 + n + series).padStart(2, "0")}:00:00Z`, red, red, blue, blue]),
    ...[[5100, "red"], [5200, "red"], [5300, "blue"], [5400, "blue"]].map(([t, a]) =>
      run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USTXCMP', ?, ?, ?, ?, ?, 1)", [season, level, series, n, t, a])),
  ]);
  // 2025–26, a four-alliance double-elimination bracket (series 1 to 6, the grand final 6, its replay 7): quals with
  // a win by 150 and a loss by 140; M1 and the upper final won; the grand final won and its replay lost.
  for (let a = 1; a <= 4; a++) await run("INSERT INTO alliances (season, code, number, captain) VALUES (2025, 'USTXCMP', ?, ?)", [a, 5000 + a]);
  await match(2025, "qual", 0, 1, "Q1", 200, 50);
  await match(2025, "qual", 0, 2, "Q2", 60, 200);
  await match(2025, "qual", 0, 3, "Q3", 120, 100);
  await match(2025, "playoff", 1, 1, "M1", 150, 130);
  await match(2025, "playoff", 4, 1, "M4", 155, 135);
  await match(2025, "playoff", 6, 1, "M6", 180, 170);
  await match(2025, "playoff", 7, 1, "M7", 140, 160);
  // 2023–24, a classic bracket (no alliances posted): a semifinal won, the final (series 0) won twice.
  await match(2023, "playoff", 1, 1, "SF1-1", 100, 90);
  await match(2023, "playoff", 0, 1, "F-1", 210, 120);
  await match(2023, "playoff", 0, 2, "F-2", 190, 130);
  await rebuildSearch();
});

describe("the finals only", () => {
  it("reads the finals as a playoff scope of their own, and a state's finals as its state championship", () => {
    expect(readStatQuestion("5100 record during the grand finals")).toMatchObject({ id: "record", scope: { level: "playoff", finals: true } });
    expect(readStatQuestion("5100 finals win rate")).toMatchObject({ id: "win-percent", scope: { level: "playoff", finals: true } });
    const states = readStatQuestion("5100 record at texas state finals")!.scope;
    expect(states).toMatchObject({ states: true });
    expect(states).not.toHaveProperty("finals");
    const playoffs = readStatQuestion("5100 playoff record")!.scope;
    expect(playoffs).toMatchObject({ level: "playoff" });
    expect(playoffs).not.toHaveProperty("finals");
    // Making the finals is a question of its own, never a finals scope.
    expect(readStatQuestion("did 5100 make the finals")?.scope ?? {}).not.toHaveProperty("finals");
  });

  it("counts the finals matches only, on /search and in the dropdown", async () => {
    for (const q of ["what was gear grinders' record in the finals matches only", "5100 finals record"]) {
      const a = await ask(q);
      expect(a.stat, q).toMatchObject({ intent: "record", title: "Record in the finals in 2025–26" });
      expect(a.stat!.headline!.value, q).toBe("1-1-0");
      expect((await searchAnswer(q, { limit: 15 })).intent?.kind, q).toBe((await searchAnswer("5100 record", { limit: 15 })).intent?.kind);
    }
    // The playoffs are all four; a classic bracket's finals are its series 0.
    expect((await ask("5100 playoff record")).stat!.headline!.value).toBe("3-1-0");
    expect((await ask("5100 record in the finals in 2023-24")).stat!.headline!.value).toBe("2-0-0");
  });

  it("names the finals match a best score comes from", async () => {
    const a = await ask("what is 5200's highest score in the finals this season");
    expect(a.stat).toMatchObject({ intent: "highest-score", headline: { value: "180 points" } });
    expect((await ask("5200 highest score in the finals in 2023-24")).stat).toMatchObject({ headline: { value: "210 points" } });
  });

  it("leaves a number the finals can't filter to search", async () => {
    const a = await ask("5100 opr in the finals");
    expect(a.stat?.intent ?? null).not.toBe("opr");
  });
});

describe("a match told by its margin", () => {
  it("is the team's biggest loss or win", async () => {
    const loss = await ask("what was the final score of the game where bolt brigade lost by a ton");
    expect(loss.stat).toMatchObject({ intent: "biggest-loss", headline: { value: "140 points" } });
    const win = await ask("the match where 5300 won so big");
    expect(win.stat).toMatchObject({ intent: "biggest-win", headline: { value: "140 points" } });
  });
  it("needs the margin said: a match the team won or lost is any match", () => {
    expect(longForm("what was the score of the match where 5300 won") ?? "").not.toMatch(/biggest/);
    expect(longForm("the game where 5100 lost to 5300") ?? "").not.toMatch(/biggest/);
  });
});
