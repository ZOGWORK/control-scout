// Boolean operators in search (./searchBoolean.ts, docs/search-boolean.md): the brief's ten cases on a small fixture
// database, and the queries without operators that must never be read as one.
import { beforeAll, describe, expect, it } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";
import type { StatBlock } from "../../src/shared/searchStat";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { readerAnswer, searchAnswer } from "./searchAnswer";
import { booleanAnswer, readBoolean } from "./searchBoolean";

const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });
const reader = (q: string) => readerAnswer(q, { limit: 25, learn: false, inner: true });
const sig = (a: SearchAnswer) => JSON.stringify([a.stat?.title, a.stat?.headline, a.stat?.none, a.stat?.blocks, a.hits.map((h) => h.ref)]);
const rowsOf = (a: SearchAnswer) => (a.stat?.blocks.find((b) => b.kind === "matches") as Extract<StatBlock, { kind: "matches" }> | undefined)?.rows ?? [];
/** Every team in a listed match. */
const teamsIn = (r: ReturnType<typeof rowsOf>[number], own: string) => [own, ...(r.partners ?? []), ...(r.opponents ?? [])].map((l) => (typeof l === "string" ? l : l.label.split(" ")[0]));

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, number][] = [
    [4215, "Hypnotic Robotics", 101.6], [6980, "Bad Wolf", 130], [23268, "Ultraviolet", 157.9], [14270, "Quantum Robotics", 200],
    [15461, "Nuts and Bolts", 40], [5110, "Wingus & Dingus", 30], [7418, "Batteries Not Included", 25],
    [16762, "Raider Robotics", 50], [16774, "Raider Robotics", 45], [12655, "North Cross Raider Robotics", 90], [4360, "Raider Robotics - Gold", 20], [3333, "Robotics Raiders United", 10],
  ];
  for (const [n, name, opr] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2015)", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_sd, rating_matches, rating_rank, matches, wins, losses, ties)
      VALUES (2025, ?, ?, ?, ?, ?, null, 11, ?, 3, 10, null, 10, 6, 4, 0)`, [n, opr, opr / 4, opr / 2, opr / 8, opr]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Town', 'NJ', 'USA', '2026-03-15', '2026-03-15', 't')");
  // Q1–Q3: 4215 against 6980. Q4: 4215 with 6980. Q5: 4215 with 23268 against 14270. Q6: 6980 with 14270 against
  // 23268. Q7: Nuts and Bolts against 4215.
  const ms: [number, number[], number[]][] = [[1, [4215], [6980]], [2, [4215], [6980]], [3, [4215], [6980]], [4, [4215, 6980], [23268]], [5, [4215, 23268], [14270]], [6, [6980, 14270], [23268]], [7, [15461], [4215]]];
  for (const [n, red, blue] of ms) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMP', 'qual', 0, ?, ?, ?, 1, ?, ?, 90, 90, 't')", [n, `Q${n}`, `2026-03-15T1${n}:00:00Z`, 100 + n, 100 + n]);
    for (const [t, side] of [...red.map((t) => [t, "red"] as const), ...blue.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'USNJCMP', 'qual', 0, ?, ?, ?)", [n, t, side]);
    }
  }
  for (const t of [4215, 6980, 23268, 14270, 15461]) {
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (2025, 'USNJCMP', ?, 1, 4, 1, 0, 5)", [t]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'USNJCMP', ?, 100, 5)", [t]);
  }
  await rebuildSearch();
});

describe("the brief's ten cases", () => {
  it("1. 4215 and 6980: the matches both teams played in, on either alliance", async () => {
    const a = await ask("4215 and 6980");
    expect(a.stat?.intent).toBe("boolean-and");
    expect(rowsOf(a).map((r) => r.label)).toEqual(["Q4", "Q3", "Q2", "Q1"]);
    for (const r of rowsOf(a)) expect(teamsIn(r, "4215")).toEqual(expect.arrayContaining(["4215", "6980"]));
    expect(a.stat?.headline).toMatchObject({ value: "4", label: expect.stringContaining("1 as partners, 3 as opponents") });
  });
  it("2. 4215 and 6980 matches: the same list", async () => {
    expect(sig(await ask("4215 and 6980 matches"))).toBe(sig(await ask("4215 and 6980")));
  });
  it("3. 4215 or 6980: either team's matches, each once", async () => {
    const a = await ask("4215 or 6980");
    const labels = rowsOf(a).map((r) => r.label);
    expect(labels.sort()).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]);
    expect(a.stat?.headline?.value).toBe("7");
  });
  it("4. 4215 not 6980: 4215's matches, none with 6980 in them", async () => {
    const a = await ask("4215 not 6980");
    expect(rowsOf(a).map((r) => r.label)).toEqual(["Q7", "Q5"]);
    for (const r of rowsOf(a)) expect(teamsIn(r, "4215")).not.toContain("6980");
  });
  it("5. &, | and - read as and, or and not", async () => {
    expect(sig(await ask("4215 & 6980"))).toBe(sig(await ask("4215 and 6980")));
    expect(sig(await ask("4215 | 6980"))).toBe(sig(await ask("4215 or 6980")));
    expect(sig(await ask("4215 -6980"))).toBe(sig(await ask("4215 not 6980")));
    expect(sig(await ask("4215 AND 6980"))).toBe(sig(await ask("4215 and 6980")));
  });
  it("6. 4215 and 6980 OPR: the OPR side by side, never a match list", async () => {
    const a = await ask("4215 and 6980 OPR");
    expect(a.stat?.intent).toBe("opr-vs");
    expect(rowsOf(a)).toEqual([]);
    expect(sig(await ask("4215 or 6980 opr"))).toBe(sig(a));
    // NOT leaves the team after it out: 4215's own OPR.
    const not = await ask("4215 not 6980 opr");
    expect(not.stat?.team?.number).toBe(4215);
    expect(not.understood?.label).toContain("6980 left out");
  });
  it("7. \"Raider Robotics\": the teams named exactly that first, never the words apart", async () => {
    const a = await ask("\"Raider Robotics\"");
    const refs = a.hits.filter((h) => h.kind === "team").map((h) => h.ref);
    expect(refs.slice(0, 2).sort()).toEqual(["16762", "16774"]);
    expect(refs).toEqual(expect.arrayContaining(["12655", "4360"]));
    expect(refs).not.toContain("3333");
    expect(a.understood?.label).toContain("Exact name \"Raider Robotics\": 2 teams");
  });
  it("8. a query without operators is read exactly as before", async () => {
    for (const q of ["4215", "4215 opr", "hypnotic robotics", "4215 vs 6980", "compare 4215 and 6980", "have 4215 and 6980 played each other",
      "who would win 4215 or 6980", "4215 or 6980 who wins", "who has a better record 4215 or 6980", "4215 and 6980 head to head", "4215 2024-25 opr",
      "4215 and 2025", "highest opr in nj", "teams in oradell", "inspire and think award winners", "4215 auto-only score", "-", "\"\"", "nuts and bolts"]) {
      expect(await readBoolean(q), q).toBeNull();
      expect(await booleanAnswer(q, reader, true), q).toBeNull();
    }
  });
  it("9. an AND with no shared matches says so, with each team's own count", async () => {
    const a = await ask("23268 and 15461");
    expect(a.stat?.none).toBe("Ultraviolet (23268) and Nuts and Bolts (15461) have no shared matches.");
    const kpis = a.stat?.blocks.find((b) => b.kind === "kpis") as Extract<StatBlock, { kind: "kpis" }>;
    expect(kpis.items.map((i) => [i.label, i.value])).toEqual([["Ultraviolet (23268)", "3"], ["Nuts and Bolts (15461)", "1"]]);
    expect(a.stat?.blocks.some((b) => b.kind === "links" && b.items[0].href === "/search?q=23268%20or%2015461")).toBe(true);
  });
  it("10. a team name holding and, or or & stays a name", async () => {
    expect(await readBoolean("nuts and bolts")).toBeNull();
    expect(await readBoolean("wingus & dingus")).toBeNull();
    expect(await readBoolean("batteries not included")).toBeNull();
    expect((await readBoolean("4215 -batteries not included"))?.groups).toEqual([[{ team: 4215, neg: false }, { team: 7418, neg: true }]]);
    expect((await readBoolean("nuts and bolts and 4215"))?.groups).toEqual([[{ team: 15461, neg: false }, { team: 4215, neg: false }]]);
    expect(rowsOf(await ask("Nuts and Bolts and 4215")).map((r) => r.label)).toEqual(["Q7"]);
  });
});

describe("failed searches filed against this reader", () => {
  it("#483 4215 and 6980 matches together: the AND match list", async () => {
    expect(sig(await ask("4215 and 6980 matches together"))).toBe(sig(await ask("4215 and 6980")));
  });
  it("#490 4215 not opr: declined plainly, never the team page as if answered", async () => {
    const a = await ask("4215 not opr");
    expect(a.stat?.intent).toBe("boolean-not");
    expect(a.stat?.none).toContain("\"opr\" isn't a team, so there's nothing to leave out");
    expect(a.understood?.label).not.toContain("isn't answered directly yet");
    expect(a.stat?.blocks[0]).toMatchObject({ kind: "links", items: [{ label: "4215 opr" }, { label: "4215 matches" }] });
  });
});

describe("precedence and parsing", () => {
  it("NOT binds tightest, then AND, then OR", async () => {
    expect((await readBoolean("4215 and 6980 or 23268 not 14270"))?.groups).toEqual([
      [{ team: 4215, neg: false }, { team: 6980, neg: false }], [{ team: 23268, neg: false }, { team: 14270, neg: true }]]);
    expect((await readBoolean("4215 and not 6980"))?.groups).toEqual([[{ team: 4215, neg: false }, { team: 6980, neg: true }]]);
    // 23268 without 14270: Q4 only (Q5 and Q6 have 14270); with 4215 and 6980's Q1–Q4, each once.
    expect(rowsOf(await ask("4215 and 6980 or 23268 not 14270")).map((r) => r.label).sort()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    // Read as (4215 and 6980) or 23268, the NOT on 14270 alone: never 4215 and (6980 or 23268).
    expect(rowsOf(await ask("4215 and 6980 or 23268")).map((r) => r.label).sort()).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  });
  it("a group only of NOTs, a dangling operator or an unknown team is no expression", async () => {
    for (const q of ["4215 or not 6980", "4215 and", "and 4215 6980", "4215 and 99999", "4215 and the bees"]) expect(await readBoolean(q), q).toBeNull();
  });
  it("a season or a match type can follow a match list", async () => {
    expect((await ask("4215 and 6980 matches 2025-26")).stat?.headline?.value).toBe("4");
    expect((await ask("4215 and 6980 matches 2024-25")).stat?.none).toContain("no shared matches in 2024–25");
    expect((await ask("4215 or 6980 in playoffs")).stat?.none).toContain("No matches");
  });
  it("a quoted full name is one term", async () => {
    expect((await readBoolean("\"bad wolf\" and 4215"))?.groups).toEqual([[{ team: 6980, neg: false }, { team: 4215, neg: false }]]);
  });
  it("the dropdown gets the reading without the blocks", async () => {
    const a = await searchAnswer("4215 and 6980", { limit: 8, learn: false });
    expect(a.stat).toBeUndefined();
    expect(a.understood?.label).toContain("Matches: Hypnotic Robotics (4215) and Bad Wolf (6980), either alliance");
  });
});
