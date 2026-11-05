// A season's best match scores asked with the season's game and penalties said ("what was the highest score in decode
// without penalties"), per period ("highest auto score in centerstage") and per place, across three seasons; and the
// common words ("without", "team", "best") that never name a team by themselves, however many team names hold them.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { onlyCommonWords } from "../../../src/shared/searchQuery";
import { readTopMatches } from "./families/topMatches";
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../src/shared/searchStat";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true });
const ask = async (q: string) => (await full(q)).stat as StatAnswer;
const rows = (a: StatAnswer) => (a.blocks.find((b) => b.kind === "matches") as Extract<StatBlock, { kind: "matches" }>).rows;

// Each season: [the code, its state, red [auto, teleop, endgame, penalties won], blue [...], red teams, blue teams].
type Side = [number, number, number, number];
const SEASON_MATCHES: Record<number, [string, string, Side, Side, number[], number[]][]> = {
  // DECODE: Q1's red has the most points with penalties (150 + 60), Q2's red the most without them (190).
  2025: [["USNJQ1", "NJ", [40, 90, 20, 60], [30, 70, 10, 0], [4215, 6980], [16091, 24551]], ["USNJQ1", "NJ", [50, 110, 30, 5], [20, 60, 10, 0], [6980, 16091], [4215, 25334]], ["USTXQ1", "TX", [60, 80, 10, 0], [10, 40, 5, 0], [10809, 12689], [24551, 25334]]],
  // INTO THE DEEP: Texas has the season's best (200); New Jersey's best is 170, and its best endgame 45.
  2024: [["USNJQ1", "NJ", [30, 95, 45, 0], [25, 80, 20, 10], [4215, 16091], [6980, 24551]], ["USTXQ1", "TX", [50, 120, 30, 0], [40, 100, 25, 0], [10809, 12689], [25334, 24551]]],
  // CENTERSTAGE: the best auto (70) is in a lower-scoring match than the best total (180).
  2023: [["USNJQ1", "NJ", [70, 60, 10, 0], [20, 50, 10, 0], [6980, 24551], [4215, 16091]], ["USTXQ1", "TX", [40, 110, 30, 20], [35, 90, 20, 0], [10809, 25334], [12689, 24551]]],
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string][] = [
    [4215, "Hypnotic Robotics", "NJ"], [6980, "Bad Wolf", "NJ"], [16091, "T.W.C.A. (Team Without a Cool Acronym)", "NJ"], [24551, "We are the best", "NJ"],
    [25334, "Best Robotics", "TX"], [10809, "Crow Force", "TX"], [12689, "The Sparks", "TX"], [30001, "The Best", "TX"],
  ];
  for (const [n, name, state] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const s of [2023, 2024, 2025]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  }
  let n = 0;
  for (const [season, ms] of Object.entries(SEASON_MATCHES).map(([s, m]) => [Number(s), m] as const)) {
    for (const code of new Set(ms.map((m) => m[0]))) {
      const state = ms.find((m) => m[0] === code)![1];
      await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', ?, 'USA', ?, ?, 't')", [season, code, `${state === "NJ" ? "New Jersey" : "Texas"} Qualifier`, state, `${season + 1}-01-10`, `${season + 1}-01-10`]);
    }
    for (const [code, , red, blue, reds, blues] of ms) {
      n++;
      const np = (s: Side) => s[0] + s[1] + s[2];
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source)
        VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't')`,
        [season, code, n, `Q${n}`, `${season + 1}-01-10T10:00:00Z`, np(red) + red[3], np(red), red[0], red[1], red[2], red[3], np(blue) + blue[3], np(blue), blue[0], blue[1], blue[2], blue[3]]);
      for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a]);
      }
    }
  }
  // A DECODE match FIRST posted as totals only: its split an estimate (all of it TeleOp), never a TeleOp or Endgame record.
  n++;
  await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, breakdown, source)
    VALUES (2025, 'USTXQ1', 'qual', 0, ?, ?, '2026-01-10T11:00:00Z', 1, 185, 185, 20, 165, 0, 0, 50, 50, 10, 40, 0, 0, 0, 't')`, [n, `Q${n}`]);
  await rebuildSearch();
});

describe("common words never name a team by themselves", () => {
  it("reads which words are only common ones", () => {
    for (const q of ["without", "team", "best", "the best team", "best robotics", "with penalties", "Team Without"]) expect(onlyCommonWords(q), q).toBe(true);
    for (const q of ["cool acronym", "hypnotic robotics", "sparks", "4215", "crow"]) expect(onlyCommonWords(q), q).toBe(false);
    expect(onlyCommonWords("")).toBe(false);
  });
  it("a stat question's common leftovers resolve no team; a name's own word still does", async () => {
    // "without" was T.W.C.A. (Team Without a Cool Acronym); "best", We are the best; "best robotics", Best Robotics.
    for (const q of ["highest score without", "best highest score in decode", "robotics highest auto score", "team highest score", "the best highest score", "without highest auto score"]) {
      const a = await full(q);
      expect(a.understood?.label ?? "", q).not.toMatch(/T\.W\.C\.A|We are the best|Best Robotics|The Sparks/);
      expect(a.hits.some((h) => h.kind === "team"), q).toBe(false);
    }
    // A name made only of common words is found when typed whole, never from a part of it.
    expect((await full("best robotics highest auto score")).understood?.label).toMatch(/^Best Robotics \(25334\) · /);
    // Typed whole with its stopword ("the best"), the name is cleaned as the query is.
    expect((await full("the best")).hits.map((h) => h.ref)).toContain("30001");
    // "best" reads as The Best's whole name (its "the" dropped), never as a part of "We are the best" or "Best Robotics".
    expect((await full("best")).hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(["30001"]);
    // A distinctive word beside the common ones keeps the team: its own question, as before.
    expect((await full("team without a cool acronym highest score")).understood?.label).toMatch(/^T\.W\.C\.A\. .*\(16091\) · /);
    expect((await full("4215 highest auto score")).understood?.label).toMatch(/^Hypnotic Robotics \(4215\) · /);
    expect((await full("sparks highest score")).understood?.label).toMatch(/^The Sparks \(12689\) · /);
  });
});

describe("a season's highest scores, by its game", () => {
  it("a totals-only match's estimated split is never a TeleOp or Endgame record, and its row shows Auto only", async () => {
    expect(rows(await ask("highest teleop score in decode"))[0].ownNp).not.toBe(185);
    const row185 = rows(await ask("highest score in decode")).find((r) => r.ownNp === 185)!;
    expect(row185.phases).toEqual({ auto: 20 });
    // Its reported Auto still counts.
    expect(rows(await ask("highest auto score in decode")).some((r) => r.ownNp === 185)).toBe(true);
  });
  it("each season's best of one period, every heading naming it", async () => {
    const s = await ask("highest auto score ever");
    expect(s.title).toBe("Highest auto score each season");
    const table = s.blocks.find((b) => b.kind === "table") as Extract<StatBlock, { kind: "table" }>;
    expect(table.title).toBe("Highest alliance auto score each season (each season is a different game)");
    expect(table.columns.find((c) => c.key === "score")?.label).toBe("Auto score");
    expect(table.rows.map((r) => r.cells.score)).toEqual([60, 50, 70]);
  });
  it("reads the game (each spelling), penalties said and a period", () => {
    expect(readTopMatches("what was the highest score in decode without penalties")).toMatchObject({ season: 2025, noPenalties: true, phase: null, region: null });
    expect(readTopMatches("highest score in center stage")).toMatchObject({ season: 2023, noPenalties: false });
    expect(readTopMatches("highest score in into the deep excluding fouls")).toMatchObject({ season: 2024, noPenalties: true });
    expect(readTopMatches("highest auto score in centerstage")).toMatchObject({ season: 2023, phase: "auto" });
    expect(readTopMatches("top tele-op scores in decode")).toMatchObject({ season: 2025, phase: "teleop" });
    expect(readTopMatches("highest end game score in nj in into the deep")).toMatchObject({ season: 2024, phase: "endgame", region: { key: "USA:NJ" } });
  });
  it("the failed search: DECODE's best alliance score without penalties, both alliances and its periods", async () => {
    const a = await full("what was the highest score in decode without penalties");
    expect(a.understood?.label).toBe("Highest match score in DECODE (2025–26) without penalties");
    expect(a.hits.some((h) => h.ref === "16091")).toBe(false);
    const s = a.stat as StatAnswer;
    // 190 without penalties beats the 210 that had 60 penalty points in it.
    expect(s.headline?.value).toBe("190 points");
    const top = rows(s)[0];
    expect(top).toMatchObject({ alliance: "red", ownNp: 190, own: 195, opp: 90, phases: { auto: 50, teleop: 140, endgame: 30, teleopWithEndgame: true } });
    expect(top.partners!.map((p) => p.label)).toEqual(["6980 Bad Wolf", "16091 T.W.C.A. (Team Without a Cool Acronym)"]);
    expect(top.opponents!.map((p) => p.label)).toEqual(["4215 Hypnotic Robotics", "25334 Best Robotics"]);
    expect(rows(s).find((r) => r.own === 210)).toMatchObject({ ownNp: 150 });
  });
  it("each season's best, by its game's name in any spelling", async () => {
    const cases: [string, string, number][] = [["highest score in decode", "DECODE 2025–26", 190], ["highest score in into the deep", "INTO THE DEEP 2024–25", 200], ["highest score in center stage", "CENTERSTAGE 2023–24", 180]];
    for (const [q, game, best] of cases) {
      const s = await ask(q);
      expect(s.title, q).toBe(`Highest-scoring matches, ${game}`);
      expect(s.headline?.value, q).toBe(`${best} points`);
    }
  });
  it("a place's best in a season", async () => {
    const s = await ask("highest score in nj in into the deep");
    expect(s.title).toBe("Highest-scoring matches in New Jersey, INTO THE DEEP 2024–25");
    expect(s.headline?.value).toBe("170 points");
    expect(rows(s).every((r) => r.event.label.includes("New Jersey"))).toBe(true);
  });
  it("one period's best in each of three seasons, its colour's period marked", async () => {
    const cases: [string, string, StatMatchRow["ranked"], number][] = [
      ["highest auto score in centerstage", "Highest auto scores in CENTERSTAGE (2023–24)", "auto", 70],
      // TeleOp as FIRST reports it from 2024–25 on: with the endgame (120 + 30).
      ["highest teleop score in into the deep", "Highest teleop scores in INTO THE DEEP (2024–25)", "teleop", 150],
      ["highest endgame score in decode", "Highest endgame scores in DECODE (2025–26)", "endgame", 30],
    ];
    for (const [q, title, phase, best] of cases) {
      const s = await ask(q);
      expect(s.title, q).toBe(title);
      expect(s.headline?.value, q).toBe(`${best} ${phase} points`);
      expect(rows(s)[0], q).toMatchObject({ ranked: phase, phases: { [phase!]: best } });
    }
    // A period in a place: New Jersey's best endgame in INTO THE DEEP.
    expect(rows(await ask("highest teleop score in into the deep"))[0].phases).toEqual({ auto: 50, teleop: 150, endgame: 30, teleopWithEndgame: true });
    expect(rows(await ask("highest teleop score in centerstage"))[0].phases).toEqual({ auto: 40, teleop: 110, endgame: 30 });
    const nj = await ask("highest endgame score in nj in into the deep");
    expect(nj.title).toBe("Highest endgame scores in INTO THE DEEP (2024–25) in New Jersey");
    expect(nj.headline?.value).toBe("45 endgame points");
  });
});
