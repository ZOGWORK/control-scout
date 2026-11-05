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
  // The final, with no time of its own (its date is the event's first day): 23268 against 14270.
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMP', 'playoff', 0, 1, 'Final 1', null, 1, 120, 120, 80, 80, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'USNJCMP', 'playoff', 0, 1, 23268, 'red'), (2025, 'USNJCMP', 'playoff', 0, 1, 14270, 'blue')");
  for (const t of [4215, 6980, 23268, 14270, 15461]) {
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (2025, 'USNJCMP', ?, 1, 4, 1, 0, 5)", [t]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'USNJCMP', ?, 100, 5)", [t]);
  }
  // 8888 last played in 2024–25, as 6980 also did: their latest shared season is 2024–25.
  await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (8888, 'Old Gears', 'Oradell', 'NJ', 'USA', 2010)");
  for (const t of [8888, 6980]) {
    await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?)", [t]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_sd, rating_matches, rating_rank, matches, wins, losses, ties)
      VALUES (2024, ?, 50, 12, 25, 6, null, 11, 50, 3, 10, null, 8, 5, 3, 0)`, [t]);
  }
  await rebuildSearch();
});

describe("the brief's ten cases", () => {
  it("1. 4215 and 6980: the matches both teams played in, on either alliance", async () => {
    const a = await ask("4215 and 6980");
    expect(a.stat?.intent).toBe("boolean-and");
    // Both teams as data, so the page doesn't list them again as team cards (src/components/search/page/results.ts answerTeams).
    expect(a.stat?.teams?.map((t) => t.number)).toEqual([4215, 6980]);
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
  it("7c. a quoted question or number is read as it is, in the dropdown as on the page", async () => {
    for (const limit of [8, 25]) {
      const a = await searchAnswer("\"4215 opr\"", { limit, learn: false });
      expect(a.step, `${limit}`).not.toBe("recovery");
      expect(a.understood?.label, `${limit}`).not.toContain("word for word");
      expect((await searchAnswer("\"4215\"", { limit, learn: false })).hits[0]?.ref).toBe("4215");
    }
  });
  it("7e. a name holding the phrase is found below names with the words apart", async () => {
    // Ten names with "Raider" and "Robotics" apart rank with the ones holding the phrase; the dropdown's 8 still finds them.
    for (let i = 0; i < 10; i++) await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2015)", [30000 + i, `Raider ${i} Robotics`]);
    await rebuildSearch();
    const a = await searchAnswer("\"Raider Robotics\"", { limit: 8, learn: false });
    expect(a.step).not.toBe("recovery");
    expect(a.hits.every((h) => !/^30\d{3}$/.test(h.ref))).toBe(true);
    expect(a.hits.map((h) => h.ref)).toEqual(expect.arrayContaining(["16762", "16774", "12655", "4360"]));
  });
  it("7d. a quoted name keeps to the caller's limit", async () => {
    const a = await searchAnswer("\"Raider Robotics\"", { limit: 1, learn: false });
    expect(a.hits.map((h) => h.ref)).toHaveLength(1);
    expect(["16762", "16774"]).toContain(a.hits[0].ref);
  });
  it("7b. a phrase no name holds says so, never the words apart", async () => {
    const a = await ask("\"Robotics Raider\"");
    expect(a.step).toBe("recovery");
    expect(a.hits).toEqual([]);
    expect(a.understood?.label).toBe("No team or event name holds \"Robotics Raider\" word for word");
    // A name two teams share, with a stat after it: those teams, asking which.
    const b = await ask("\"Raider Robotics\" opr");
    expect(b.hits.slice(0, 2).map((h) => h.ref).sort()).toEqual(["16762", "16774"]);
    expect(b.understood?.label).toContain("\"opr\" isn't read: 2 teams are named \"Raider Robotics\", so say which by its number");
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
    expect(kpis.items.map((i) => [i.label, i.value])).toEqual([["Ultraviolet (23268)", "4"], ["Nuts and Bolts (15461)", "1"]]);
    expect(a.stat?.blocks.some((b) => b.kind === "links" && b.items[0].href === "/search?q=23268%20or%2015461")).toBe(true);
  });
  it("10. a team name holding and, or or & stays a name", async () => {
    expect(await readBoolean("nuts and bolts")).toBeNull();
    expect(await readBoolean("wingus & dingus")).toBeNull();
    expect(await readBoolean("batteries not included")).toBeNull();
    expect((await readBoolean("4215 and Raider Robotics - Gold"))?.groups).toEqual([[{ team: 4215, neg: false }, { team: 4360, neg: false }]]);
    expect((await readBoolean("4215 -batteries not included"))?.groups).toEqual([[{ team: 4215, neg: false }, { team: 7418, neg: true }]]);
    expect((await readBoolean("nuts and bolts and 4215"))?.groups).toEqual([[{ team: 15461, neg: false }, { team: 4215, neg: false }]]);
    expect(rowsOf(await ask("Nuts and Bolts and 4215")).map((r) => r.label)).toEqual(["Q7"]);
    expect((await readBoolean("wingus & dingus and 4215"))?.groups).toEqual([[{ team: 5110, neg: false }, { team: 4215, neg: false }]]);
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
  it("the not example names a team really played: never a scheduled match, a robot sitting out or a year-like number", async () => {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (2024, 'Year Team', 'Oradell', 'NJ', 'USA', 2015)");
    for (const [n, played, opp, onField] of [[30, 0, 7418, 1], [31, 0, 7418, 1], [32, 0, 7418, 1], [33, 0, 7418, 1], [34, 1, 5110, 0], [35, 1, 5110, 0], [36, 1, 5110, 0], [37, 1, 5110, 0], [38, 1, 2024, 1], [39, 1, 2024, 1], [40, 1, 2024, 1], [41, 1, 2024, 1]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMP', 'qual', 0, ?, ?, null, ?, 100, 100, 90, 90, 't')", [n, `Q${n}`, played]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJCMP', 'qual', 0, ?, 4215, 'red', 1), (2025, 'USNJCMP', 'qual', 0, ?, ?, 'blue', ?)", [n, n, opp, onField]);
    }
    expect((await ask("4215 not opr")).understood?.label).toContain('"4215 not 6980"');
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
    expect(rowsOf(await ask("4215 and 6980 or 23268")).map((r) => r.label).sort()).toEqual(["Final 1", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  });
  it("a group only of NOTs, a dangling operator or an unknown team is no expression", async () => {
    for (const q of ["4215 or not 6980", "4215 and", "and 4215 6980", "4215 and 99999", "4215 and the bees"]) expect(await readBoolean(q), q).toBeNull();
  });
  it("a season or a match type can follow a match list", async () => {
    expect((await ask("4215 and 6980 matches 2025-26")).stat?.headline?.value).toBe("4");
    expect((await ask("4215 and 6980 matches 2024-25")).stat?.none).toContain("no shared matches in 2024–25");
    expect((await ask("4215 or 6980 in playoffs")).stat?.none).toContain("No matches");
  });
  it("any other stat: each team's own answer in one table, opening the section that answer opens", async () => {
    const a = await ask("4215 and 6980 record");
    expect(a.stat?.intent).toBe("boolean-compare");
    expect(a.stat?.teams?.map((t) => t.number)).toEqual([4215, 6980]);
    // The search's team table: each team's season numbers, the stat asked as its own column.
    const t = a.stat?.blocks.find((b) => b.kind === "leaderboard") as Extract<StatBlock, { kind: "leaderboard" }>;
    expect(t.rows.map((r) => r.team.label)).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    expect(t.rows.map((r) => [r.opr, r.parts?.auto, r.record])).toEqual([[101.6, 25.4, "6-4-0"], [130, 32.5, "6-4-0"]]);
    expect(t.stat.label).toBe(t.title.replace(", side by side", ""));
    expect(a.stat?.headline?.value).toBe(t.rows.map((r) => r.display).join(" vs "));
    // Each team's link opens what its own answer opens ("4215 record" reads as this season's record).
    const own = await ask("4215 record this season");
    expect(a.stat?.title).toBe(`${own.stat?.title}: 4215 vs 6980`);
    expect(a.hits[0].section).toBe(own.hits[0].section);
    const awards = await ask("4215 and 6980 awards");
    expect(awards.hits[0].section).toBe((await ask("4215 awards")).hits[0].section);
  });
  it("every team is read for one season, the latest they all played", async () => {
    const a = await ask("6980 and 8888 record");
    expect(a.stat?.title).toContain("2024–25");
    const t = a.stat?.blocks.find((b) => b.kind === "leaderboard") as Extract<StatBlock, { kind: "leaderboard" }>;
    expect(t.note).toBe("2024–25 season numbers");
  });
  it("a total keeps every season, as each team's own search counts it", async () => {
    const a = await ask("6980 and 8888 total matches");
    const own = await ask("6980 total matches");
    expect(a.stat?.intent).toBe("boolean-compare");
    expect(own.understood?.season).toBeUndefined();
    expect(a.stat?.headline?.value.split(" vs ")[0]).toBe(own.stat?.headline?.value);
  });
  it("an untimed final stays at the top of its event, above the timed qualifications", async () => {
    const rows = rowsOf(await ask("23268 or 14270"));
    expect(rows[0].label).toBe("Final 1");
  });
  it("a stat about wins stays on the boolean path; a win chance or who wins does not", async () => {
    expect((await readBoolean("4215 and 6980 total wins"))?.rest).toBe("total wins");
    expect((await readBoolean("4215 not 6980 win rate"))?.rest).toBe("win rate");
    for (const q of ["4215 and 6980 win chance", "4215 or 6980 who wins", "4215 and 6980 odds"]) expect(await readBoolean(q), q).toBeNull();
  });
  it("a dash right before a quote is NOT on the phrase", async () => {
    expect((await readBoolean("4215 -\"bad wolf\""))?.groups).toEqual([[{ team: 4215, neg: false }, { team: 6980, neg: true }]]);
    expect(sig(await ask("4215 -\"bad wolf\""))).toBe(sig(await ask("4215 not 6980")));
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

describe("the operator × operand × intent grid", () => {
  // Every operator form, every way to name the second team, every kind of question: read as an expression with the
  // right groups, and answered (a match list, a side by side or the first team's own stat), never a fallback.
  const OPS: [string, "and" | "or" | "not"][] = [["and", "and"], ["&", "and"], ["or", "or"], ["|", "or"], ["not", "not"], ["-", "not"]];
  const SECOND: [string, number][] = [["6980", 6980], ["bad wolf", 6980], ["\"Bad Wolf\"", 6980], ["Raider Robotics - Gold", 4360], ["Wingus & Dingus", 5110]];
  const INTENTS = ["", "matches", "total matches", "total awards", "opr", "win rate", "record"];
  for (const [op, kind] of OPS) for (const [second, team] of SECOND) for (const intent of INTENTS) {
    const q = `4215 ${op === "-" ? `-${second}` : `${op} ${second}`}${intent ? ` ${intent}` : ""}`;
    it(q, async () => {
      const b = await readBoolean(q);
      expect(b?.groups, q).toEqual(kind === "or" ? [[{ team: 4215, neg: false }], [{ team, neg: false }]] : [[{ team: 4215, neg: false }, { team, neg: kind === "not" }]]);
      expect(b?.rest).toBe(intent);
      // The boolean reader itself answers (never a later reader's rewrite of the query).
      const a = await booleanAnswer(q, reader, true);
      expect(a?.stat, q).toBeTruthy();
      const noSeason = (t = "") => t.replace(/ in \d{4}–\d\d/, "");
      if (!intent || intent === "matches") expect(a!.stat!.intent).toBe(`boolean-${kind}`);
      else {
        // The stat asked, as the first team's own search answers it ("4215 record" alone is the team's card: this season's).
        const own = (await ask(`4215 ${intent}`)).stat ?? (await ask(`4215 ${intent} this season`)).stat!;
        if (kind === "not") {
          expect(a!.stat!.team?.number).toBe(4215);
          expect([a!.stat!.intent, a!.stat!.title, a!.stat!.headline]).toEqual([own.intent, own.title, own.headline]);
        } else if (intent === "opr") expect(a!.stat!.intent).toBe("opr-vs");
        else {
          expect(a!.stat!.intent).toBe("boolean-compare");
          expect(noSeason(a!.stat!.title.split(": ")[0])).toBe(noSeason(own.title));
        }
      }
    });
  }
});

