// A run of seasons asked of anything but a rank (search audit, "season ranges", live check of #2275): "highest score
// from <year> to <year>" is each season's own highest score side by side, never one number across seasons (each season
// is a different game); a year read as part of the run is never also a team's number to look up.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import { nameWords } from "../../../src/shared/searchQuery";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
const rows = (s: StatAnswer | undefined) => { const t = s?.blocks.find((b) => b.kind === "table"); return t?.kind === "table" ? t.rows.map((r) => r.cells) : []; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Two teams in three seasons; a later game scores higher. Teams whose numbers start with a year: never a run's hits.
  for (const [n, name] of [[30501, "Crab Bots"], [30502, "Bay Bots"], [20231, "Year Bots"], [20241, "Next Year Bots"]] as const) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MD', 'USA')", [n, name]);
  let k = 0;
  for (const season of [2023, 2024, 2025]) {
    const code = `USMDQ${season}`;
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'MD', 'USA', ?, ?, 't')", [season, code, `Maryland Qualifier ${season}`, `${season + 1}-01-10`, `${season + 1}-01-10`]);
    for (const n of [30501, 30502]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
    // Each season: 30501's best match scores 100 more than the season before; 30502 is on the other side.
    for (const [red, blue] of [[100 + (season - 2023) * 100, 50], [80 + (season - 2023) * 100, 90]]) {
      k++;
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')",
        [season, code, k, `Q${k}`, `${season + 1}-01-10T10:00:00Z`, red, red, blue, blue]);
      for (const [t, a] of [[30501, "red"], [30502, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, k, t, a]);
    }
    // One judged award a season for 30501: the same count each season, still a season's own answer.
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, ?, 'Think', 1, 30501)", [season, code]);
    await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np, rank_np, ranked_teams) VALUES (?, 30501, 2, 1, 1, 0, 50, 1, 2), (?, 30502, 2, 1, 1, 0, 40, 2, 2)", [season, season]);
  }
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("a run of seasons asked of a score, a record or anything but a rank", () => {
  it("is each season's own answer side by side, never one number across seasons", async () => {
    const a = await ask("highest score from 2023 to 2025");
    const s = a.stat as StatAnswer;
    expect(s.intent).toMatch(/^seasons-/);
    // No headline: a best across seasons would set one game's score against another's.
    expect(s.headline).toBeUndefined();
    expect(rows(s).map((c) => [c.season, c.value])).toEqual([["2023–24", "100"], ["2024–25", "200"], ["2025–26", "300"]].map(([x, v]) => [x, expect.stringContaining(v)]));
    const tiles = s.blocks.find((b) => b.kind === "kpis");
    expect(tiles?.kind === "kpis" && tiles.items.map((i) => i.label)).toEqual(["2023–24", "2024–25", "2025–26"]);
    // "Between … and …" is one run, never two searches joined by "and".
    expect(((await ask("highest score between 2024 and 2025")).stat as StatAnswer).title).toMatch(/each season between 2024–25 and 2025–26$/);
  });
  it("a team's run of anything but a rank is asked season by season, the team named", async () => {
    const s = (await ask("30501 highest score since 2024")).stat as StatAnswer;
    expect([s.title, s.team?.number, rows(s).map((c) => c.season)]).toEqual(["Crab Bots (30501): Highest score, each season since 2024–25", 30501, ["2024–25", "2025–26"]]);
    // A team's record over a run is its record each season, never its OPR rank.
    const rec = (await ask("30501 record 2023 to 2025")).stat as StatAnswer;
    expect([rec.intent === "team-seasons", rows(rec).length]).toEqual([false, 3]);
    // The same answer each season (one award a season) is still each season's own, side by side.
    const aw = (await ask("30501 awards since 2023")).stat as StatAnswer;
    expect([aw.intent, rows(aw).length, new Set(rows(aw).map((c) => c.value)).size]).toEqual([expect.stringMatching(/^seasons-/), 3, 1]);
  });
  it("typed into the box, a run is a link to its page, its seasons' cards worked out only there", async () => {
    const a = await searchAnswer("30501 highest score since 2024", { limit: 8, full: false, now: NOW });
    expect([a.stat, a.understood?.label, a.pages[0]?.href]).toEqual([undefined, "Crab Bots (30501): each season since 2024–25", "/search?q=30501%20highest%20score%20since%202024"]);
  });
  it("a year read as part of a run is never a team number to look up", async () => {
    expect(nameWords("highest score from 2023 to 2024")).toBe("highest score");
    expect(nameWords("30501 since 2023")).toBe("30501");
    // Every run goes, a run alone leaves nothing to look up, and a letter that lowers to two keeps the words around it.
    expect([nameWords("highest score from 2022 to 2023 since 2024"), nameWords("since 2023"), nameWords("from 2022 to 2024")]).toEqual(["highest score", "", ""]);
    expect(nameWords("İ since 2023 teams")).toBe("İ team");
    // A year alone is still a number to look up.
    expect(nameWords("2024")).toBe("2024");
    for (const q of ["highest score from 2023 to 2024", "highest score since 2023"]) {
      const a = await ask(q);
      expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref), q).toEqual([]);
    }
  });
});
