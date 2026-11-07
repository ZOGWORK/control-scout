// A team's name typed whole, with its own punctuation and words a question's frame drops (search-eval, seed 20764:
// "UK 488 - The King's School- Barrel Botz" and "Team Stealth" weren't read). Held out: a name with a number, a lone
// dash, a dash ending a word and a possessive; a name starting with "Team"; a misspelling of it.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { normalise, parseQuery } from "./query/parse";
import { parseContext } from "./query/context";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const TEAMS: [number, string][] = [[24325, "UK 488 - The King's School- Barrel Botz"], [21536, "Team Stealth"], [16309, "Stealth Panther Robotics FTC"], [5000, "Rivals"], [5001, "Others"], [5002, "QUEEN'S GAMBIT"]];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'KS', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USKSQ1', 'Kansas Qualifier', 'Qualifier', 'Town', 'KS', 'USA', '2026-01-10', '2026-01-10', 't')", [S]);
  for (const [n] of TEAMS) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USKSQ1', ?)", [S, n]);
  // Three matches: 24325 and 21536 together, against the other two, red winning each.
  for (const n of [1, 2, 3]) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USKSQ1', 'qual', 0, ?, ?, 1, 150, 150, 100, 100, 't')", [S, n, `Q${n}`]);
    for (const [t, al] of [[24325, "red"], [21536, "red"], [5000, "blue"], [5001, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USKSQ1', 'qual', 0, ?, ?, ?, 1)", [S, n, t, al]);
  }
  await rebuildSearch();
});

describe("a team's name typed whole, punctuation and all", () => {
  it("a dash on its own or ending a word is punctuation, never a word", () => {
    expect(normalise("UK 488 - The King's School- Barrel Botz record")).toBe("uk 488 the king school barrel botz record");
    // A dash inside a word or between numbers stays what it is.
    expect(normalise("Cluj-Napoca 2024-25")).toBe("cluj napoca 2024-25");
    // Greptile on #1028: a season said with a spaced dash is still the season, never a lone number left over.
    expect(normalise("highest score in 2024 - 25")).toBe("highest score in 2024-25");
  });
  it("its number beside it, or the name alone, reads the team's own record", async () => {
    for (const q of ["24325 UK 488 - The King's School- Barrel Botz's w l t", "UK 488 - The King's School- Barrel Botz record", "what is largest score UK 488 - The King's School- Barrel Botz 24325", "what's avg pts of 24325 UK 488 - The King's School- Barrel Botz?"]) {
      const a = await ask(q);
      expect(a.stat?.team?.number, q).toBe(24325);
    }
    const p = await parseQuery("24325 UK 488 - The King's School- Barrel Botz record", await parseContext());
    expect(p.complete).toBe(true);
    expect(p.teams.map((t) => t.number)).toEqual([24325]);
    // Greptile on #1028: a possessive stored in capitals ("QUEEN'S") matches as typed, with no correction.
    for (const q of ["QUEEN'S GAMBIT", "queen's gambit"]) {
      const named = await parseQuery(`${q} record`, await parseContext());
      expect(named.teams.map((t) => [t.number, t.via]), q).toEqual([[5002, "name"]]);
    }
  });
  it("a name starting with a word questions drop (\"Team Stealth\") keeps it, spelled right or with a slip", async () => {
    for (const q of ["team stealth record", "team sealth record", "the record of team stealth"]) {
      const a = await ask(q);
      expect(a.stat?.team?.number ?? Number(a.hits[0]?.ref), q).toBe(21536);
    }
    // A team named without it is still read as itself.
    const own = await ask("stealth panther robotics ftc record");
    expect(own.stat?.team?.number ?? Number(own.hits[0]?.ref), JSON.stringify(own.understood)).toBe(16309);
  });
});
