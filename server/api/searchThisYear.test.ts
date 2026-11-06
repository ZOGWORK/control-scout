// "This year", "this season" or no season word, for an event held every season (owner, live 3.6.9: "Who won nj
// turnpike division this year" answered with the 2022–23 division, whose name fits the words better, instead of
// 2025–26's). A season said is that season's; none said is the latest held with a result; an older one only when asked.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
// [season, code, name, parent, held, winners, losers]
const EVENTS: [number, string, string, string | null, string, number[], number[]][] = [
  [2022, "NJ0312", "New Jersey State Championship-NJ0312", null, "2023-03-12", [], []],
  [2022, "NJ0312TP", "New Jersey State Championship-NJ0312 - Turnpike Division", "NJ0312", "2023-03-12", [4215, 9848, 21226], [11166, 14481, 17036]],
  [2025, "USNJCMP", "New Jersey Championship", null, "2026-03-14", [], []],
  [2025, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "USNJCMP", "2026-03-14", [23268, 7149], [6980, 14270]],
  [2023, "USMICMPFD", "Michigan State Championship - Ford Division", null, "2024-04-05", [8000, 8001], [8002, 8003]],
  [2025, "USMICMPFD", "Michigan State Championship - Ford Division", null, "2026-04-03", [8100, 8101], [8102, 8103]],
  [2024, "USTXHOQ", "Houston Area Qualifier", null, "2025-01-11", [7000, 7001], [7002, 7003]],
  [2025, "USTXHOQ", "Houston Area Qualifier", null, "2026-01-10", [7100, 7101], [7102, 7103]],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams = new Set(EVENTS.flatMap(([, , , , , w, l]) => [...w, ...l]));
  for (const n of teams) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, `Team ${n}`]);
  for (const [season, code, name, parent, held, w, l] of EVENTS) {
    await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [season, code, name, parent, held, held]);
    if (!w.length) continue;
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, ?, 1, ?, ?), (?, ?, 2, ?, ?)", [season, code, w[0], w[1], season, code, l[0], l[1]]);
    for (const n of [1, 2]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'playoff', 6, ?, ?, 1, 200, 200, 150, 150, 't')", [season, code, n, `F${n}`]);
      for (const [t, al] of [...w.slice(0, 2).map((t) => [t, "red"]), ...l.slice(0, 2).map((t) => [t, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'playoff', 6, ?, ?, ?)", [season, code, n, t, al]);
    }
  }
  await rebuildSearch();
});

/** The winners an answer names, by number, and its season. */
const winners = async (q: string) => {
  const a = await ask(q);
  return { teams: (a.stat?.headline?.teams ?? []).map((t) => Number(t.label.split(" ")[0])), season: a.understood?.season };
};

describe("an event held every season, asked by its words", () => {
  it("the owner's query: \"this year\" is this season's, else the latest held, never an older name that fits better", async () => {
    for (const q of ["Who won nj turnpike division this year", "who won nj turnpike division this season", "who won nj turnpike division", "who won the nj turnpike division"]) {
      expect(await winners(q), q).toEqual({ teams: [23268, 7149], season: 2025 });
    }
  });
  it("an older season said is that season's", async () => {
    for (const q of ["who won nj turnpike division 2022-23", "who won nj turnpike division in 2022-23", "who won nj turnpike division in 2023"]) {
      expect(await winners(q), q).toEqual({ teams: [4215, 9848], season: 2022 });
    }
  });
  it("the same for other recurring divisions and events", async () => {
    for (const [words, latest, older, olderSeason] of [["michigan ford division", [8100, 8101], [8000, 8001], 2023], ["houston area qualifier", [7100, 7101], [7000, 7001], 2024]] as const) {
      for (const q of [`who won ${words} this year`, `who won ${words} this season`, `who won ${words}`]) expect(await winners(q), q).toEqual({ teams: latest, season: 2025 });
      expect(await winners(`who won ${words} ${olderSeason}-${String(olderSeason + 1).slice(2)}`)).toEqual({ teams: older, season: olderSeason });
    }
  });
});
