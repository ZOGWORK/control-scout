// Logged failed searches #1384–#1388 and #1406, by the generic rules that answer them: a team against itself, a clause
// taken back by "no", a chat command written out, one question in two time windows, and a team's predicted against
// actual rank at every event of a season. Fixture teams and events only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import type { StatAnswer } from "../../../src/shared/searchStat";
import type { SearchAnswer } from "../../../src/shared/api";
import { searchAnswer, withoutContrast } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";
import { rankReviewAnswer } from "./rankReview";
import { PAIR_SPLIT, windowPairAnswer } from "./windowPair";

const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string][] = [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [7149, "Enforcers"], [11111, "Gear Heads"]];
  for (const [n, name] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, ?, 50, 3, 1, 6, 6, 3, 3, 0)", [S, n]);
  }
  // Two events. At the first, 7149's calls put it first of four and it finished second; at the second, no call is stored.
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'EVA', 'Alpha Qualifier', 'Qualifier', ?, ?, 'test')", [S, `${S}-11-01`, `${S}-11-01`]);
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'EVB', 'Beta Qualifier', 'Qualifier', ?, ?, 'test')", [S, `${S}-12-01`, `${S}-12-01`]);
  const ranks: [string, number, number][] = [["EVA", 7149, 2], ["EVA", 4215, 1], ["EVA", 6980, 3], ["EVA", 11111, 4], ["EVB", 7149, 5]];
  for (const [code, team, rank] of ranks) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, ?)", [S, code, team, rank]);
  // EVA's two qualification matches: 7149 + 4215 vs 6980 + 11111 (7149's side 80%), 7149 + 6980 vs 4215 + 11111 (60%).
  const ms: [number, number[], number[], number][] = [[1, [7149, 4215], [6980, 11111], 0.8], [2, [7149, 6980], [4215, 11111], 0.6]];
  for (const [number, red, blue, p] of ms) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (?, 'EVA', 'qual', 0, ?, ?, 1, 100, 90, 'test')", [S, number, `Q${number}`]);
    await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at)
      VALUES ('backtest', ?, 'EVA', 'qual', 0, ?, ?, ?, ?, 100, 90, 'medium', 'test', '2025-11-01', '2025-11-01', 'red', '2025-11-01')`, [S, number, JSON.stringify(red), JSON.stringify(blue), p]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("a team asked against itself (#1387)", () => {
  it("says no match can be called, and opens the team's own forecasts in Predict", async () => {
    for (const q of ["predict 4215 vs 4215", "what happens if 4215 plays against itself, lol, no, predict 4215 vs 4215", "what if 4215 plays against itself"]) {
      const a = await ask(q);
      expect(a.stat, q).toMatchObject({ intent: "self-match", title: "4215 can't play itself", none: expect.stringContaining("no prediction for Hypnotic Robotics (4215) against itself") });
      const links = a.stat?.blocks.find((b) => b.kind === "links");
      expect(links?.kind === "links" && links.items[0].href, q).toBe("/predict?mode=scheduled&for=team:4215");
    }
  });
  it("two different teams, or one team's two seasons, are never read as one team against itself", async () => {
    expect((await ask("predict 4215 vs 6980")).stat?.intent).not.toBe("self-match");
    expect((await ask(`4215 ${S} vs 4215 ${S - 1}`)).stat?.intent).not.toBe("self-match");
  });
});

describe("a clause taken back by a lone 'no'", () => {
  it("leaves only what follows it", () => {
    expect(withoutContrast("what happens if 4215 plays against itself, lol, no, predict 4215 vs 4215")).toBe("predict 4215 vs 4215");
    expect(withoutContrast("4215 record, no awards")).toBe("4215 record, no awards");
  });
});

describe("a chat command written out with its option (#1406)", () => {
  it("is the option's question, answered as typed without it", async () => {
    const a = await ask("/ask question:predict 4215 vs 4215");
    expect(a.stat?.intent).toBe("self-match");
    expect(a.q).toBe("/ask question:predict 4215 vs 4215");
  });
});

describe("one team's predicted against actual rank at every event (#1385)", () => {
  it("ranks the event's teams by the engine's expected wins and sets the real rank beside it", async () => {
    const s = await rankReviewAnswer({ number: 7149, name: "Enforcers" }, S);
    const table = s.blocks.find((b) => b.kind === "table");
    const rows = table?.kind === "table" ? table.rows.map((r) => r.cells) : [];
    // 7149: 0.8 + 0.6 = 1.4 expected wins, the most of the four (4215 1.2, 6980 0.6, 11111 0.8): predicted #1, finished #2.
    expect(rows[0]).toMatchObject({ event: "Alpha Qualifier", predicted: "#1 of 4", expected: "1.4", actual: "#2", gap: "1 worse" });
    expect(rows[1]).toMatchObject({ event: "Beta Qualifier", predicted: "No calls stored", actual: "#5" });
    expect(s.headline).toMatchObject({ value: "1.0 places", label: expect.stringContaining("over 1 event") });
  });
  it("is the answer to the question asked, in the team's latest season", async () => {
    const a = await ask("show me 7149's predicted vs actual rank at every event this season, side by side");
    expect(a.stat?.intent).toBe("predicted-vs-actual-rank");
  });
});

describe("one question in two time windows (#1386)", () => {
  const stat = (over: Partial<StatAnswer>): SearchAnswer => ({ q: "", hits: [], pages: [], step: "deterministic", weak: false,
    stat: { family: "aggregate", intent: "record", title: "Record this month", scope: ["2026–27"], blocks: [], definition: "Results.", source: "s", team: { number: 4215, name: "Hypnotic Robotics" }, ...over } });
  const month = (label: string, from: string, to: string) => ({ kind: "window" as const, label, typed: label, from, to, season: 2026 });
  it("splits at the versus word", () => {
    expect(PAIR_SPLIT.exec("whats 17965's record this month, versus last month")?.index).toBe(32);
  });
  it("sets each window's number side by side, and says when neither has anything", () => {
    const times: [ReturnType<typeof month>, ReturnType<typeof month>] = [month("this month", "2026-11-01", "2026-11-30"), month("last month", "2026-10-01", "2026-10-31")];
    const a = windowPairAnswer("q", times, stat({ headline: { value: "2-3-1", label: "33% win rate in 6 matches this month" } }), stat({ none: "No matches last month." }), { pages: [] });
    expect(a.stat).toMatchObject({ title: "Record this month vs last month", headline: { value: "2-3-1 vs –" } });
    const k = a.stat?.blocks[0];
    expect(k?.kind === "kpis" && k.items.map((i) => [i.label, i.value])).toEqual([["This month (Nov 1–30, 2026)", "2-3-1"], ["Last month (Oct 1–31, 2026)", "–"]]);
    const none = windowPairAnswer("q", times, stat({ none: "No matches this month." }), stat({ none: "No matches last month." }), { pages: [] });
    expect(none.stat?.headline).toBeUndefined();
    expect(none.stat?.none).toBe("Hypnotic Robotics (4215) has no matches on record this month (Nov 1–30, 2026) or last month (Oct 1–31, 2026).");
  });
});
