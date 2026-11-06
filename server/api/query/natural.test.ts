// Natural questions, said every way (docs/search-pipeline.md, "Natural questions"): one intent asked five or more ways
// gives the same card with the same numbers, and every question that answered before answers the same. A small
// database, fixture names only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { SearchAnswer } from "../../../src/shared/api";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
/** What a card says, in one line: its kind, title, headline and rows (or its none). */
const card = (a: SearchAnswer) => {
  const s = a.stat;
  if (!s) return { kind: a.card?.kind ?? null, title: a.card?.title ?? a.understood?.label ?? null, lines: a.card?.lines.map((l) => l.text) ?? [], hits: a.hits.map((h) => `${h.kind}:${h.ref}`) };
  const rows = s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => String(r.cells[b.columns[0].key])) : []));
  return { kind: s.intent, title: s.title, headline: s.headline?.value ?? null, rows, none: s.none ?? null };
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA"], [6980, "Bad Wolf", "Fair Lawn", "NJ", "USA"], [7149, "Enforcers", "Oradell", "NJ", "USA"],
    [20245, "Ultraviolet", "Detroit", "MI", "USA"], [23268, "Ultraviolet", "Hackettstown", "NJ", "USA"], [22457, "Ultraviolet Bots", "Leeds", "", "United Kingdom"],
    [9848, "GearView", "Dallas", "TX", "USA"], [24033, "Alphatronic", "Cluj-Napoca", "CJ", "Romania"],
    // Names ending in a question's filler or holding a place's preposition; a name with punctuation; a placeholder.
    [30001, "Robots R Us", "Town", "OH", "USA"], [30002, "Lost In Space", "Town", "OH", "USA"], [30003, "O'Brien Robotics", "Town", "OH", "USA"],
    [30004, "Ultraviolet Bots", "Town", "OH", "USA"], [30005, "Ultraviolet Bots", "Town", "OH", "USA"], [30006, "Ultraviolet Bots", "Town", "OH", "USA"],
    [30007, "Ultraviolet Bots", "Town", "OH", "USA"], [30008, "Ultraviolet Beams", "Town", "OH", "USA"],
    [99950, "Off-Season Demo Team", "Town", "OH", "USA"], [99951, "Off-Season Demo Team", "Town", "OH", "USA"],
  ];
  for (const [n, name, city, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state || null, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJQ1', 'Garden Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't'), (2024, 'USMIQ1', 'Lakes Qualifier', 'Qualifier', 'Town', 'MI', 'USA', '2025-01-10', '2025-01-10', 't')");
  let n = 0;
  const match = async (season: number, code: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, `${season + 1}-01-10T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a]);
    }
    for (const t of [...reds, ...blues]) await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, 1)", [season, code, t]);
  };
  await match(2025, "USNJQ1", 150, 90, [4215, 23268], [6980]);
  await match(2025, "USNJQ1", 80, 120, [4215], [6980, 7149]);
  await match(2025, "USNJQ1", 170, 60, [4215], [9848]);
  // 20245 played only in 2024–25: a season named leaves it out.
  await match(2024, "USMIQ1", 100, 50, [20245], [24033]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) SELECT season, code, team, 50, 1 FROM event_teams");
  await rebuildSearch();
  clearAllCaches();
});

describe("count teams by name (3a)", () => {
  const SAID = ["how many teams named ultraviolet", "how many teams are called ultraviolet", "number of teams named ultraviolet", "teams named ultraviolet",
    "how many teams have the name ultraviolet", "how many teams named Ultraviolet are there?", "can you tell me how many teams are called ultraviolet please"];
  it("one card for every way it's asked: the count, then every team with the name, by number", async () => {
    const first = card(await ask(SAID[0]));
    expect(first).toEqual({ kind: "teams-named", title: "Teams named Ultraviolet", headline: "2 teams", rows: ["20245 Ultraviolet", "23268 Ultraviolet"], none: null });
    for (const q of SAID.slice(1)) expect(card(await ask(q)), q).toEqual(first);
  });
  it("the count is the list, with where each team is from to tell a shared name apart", async () => {
    const s = (await ask("how many teams named ultraviolet")).stat as StatAnswer;
    const t = s.blocks[0];
    expect(t.kind === "table" && t.rows.map((r) => [r.cells.from, r.href])).toEqual([["Detroit, MI", "/teams/20245"], ["Hackettstown, NJ", "/teams/23268"]]);
    expect(t.kind === "table" && t.rows.length).toBe(2);
  });
  it("a name another team already has is read as words, never as that team", async () => {
    for (const [q, row] of [["how many teams named gearview", "9848 GearView"], ["how many teams are called hypnotic robotics", "4215 Hypnotic Robotics"], ["number of teams named bad wolf", "6980 Bad Wolf"]]) {
      const c = card(await ask(q));
      expect(c, q).toMatchObject({ kind: "teams-named", headline: "1 team", rows: [row] });
    }
  });
  it("a place narrows to the teams from it, a season to the teams that played it; the card says which", async () => {
    expect(card(await ask("how many teams named ultraviolet from NJ"))).toMatchObject({ headline: "1 team", rows: ["23268 Ultraviolet"] });
    const s = (await ask("teams called ultraviolet in 2025-26")).stat as StatAnswer;
    expect(s).toMatchObject({ headline: { value: "1 team", label: "named Ultraviolet that played in 2025–26" }, scope: ["2025–26"] });
  });
  it("a whole stored name is read whole, whatever words it holds", async () => {
    expect(card(await ask("how many teams named robots r us"))).toMatchObject({ headline: "1 team", rows: ["30001 Robots R Us"] });
    expect(card(await ask("teams called lost in space"))).toMatchObject({ headline: "1 team", rows: ["30002 Lost In Space"] });
    expect(card(await ask("how many teams named o'brien robotics are there"))).toMatchObject({ headline: "1 team", rows: ["30003 O'Brien Robotics"] });
  });
  it("never counts a placeholder registration", async () => {
    expect(card(await ask("how many teams named off-season demo team"))).toMatchObject({ headline: "0 teams", rows: [] });
  });
  it("none: said plainly, with names to try and every team a tap away, never the no-match page", async () => {
    const a = await ask("how many teams named zzzqqq");
    expect(a.step).toBe("deterministic");
    expect(card(a)).toMatchObject({ kind: "teams-named", headline: "0 teams", rows: [], none: "No team is named zzzqqq." });
    expect(a.pages[0]).toEqual({ title: "Browse all teams", href: "/teams" });
    // The names the words are part of, and the name anywhere when a place narrowed it to none.
    const part = (await ask("how many teams named ultraviolet b")).stat as StatAnswer;
    expect(part.blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["Ultraviolet Bots", "Ultraviolet Beams"] });
    // Spelled as the name search folds it: no apostrophe.
    expect(((await ask("how many teams named obrien r")).stat as StatAnswer).blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["O'Brien Robotics"] });
    const there = (await ask("how many teams named bad wolf in Romania")).stat as StatAnswer;
    expect(there.none).toBe("No team is named bad wolf in Romania.");
    expect(there.blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["teams named bad wolf"] });
  });
  it("never every team with the name for an event filter it doesn't take", async () => {
    for (const q of ["how many teams named ultraviolet at qualifiers", "teams named ultraviolet at league meets"]) {
      expect((await ask(q)).stat?.intent, q).not.toBe("teams-named");
    }
  });
});

describe("count teams by place (3a)", () => {
  it("a town's count is its list of teams", async () => {
    for (const q of ["how many teams from Oradell", "how many teams in Oradell", "number of teams from oradell"]) {
      expect(card(await ask(q)), q).toMatchObject({ kind: "city-teams", headline: "2 teams", rows: expect.arrayContaining(["4215 Hypnotic Robotics", "7149 Enforcers"]) });
    }
  });
  it("never a town's whole list for a filter it doesn't take", async () => {
    for (const q of ["how many teams from Oradell at worlds", "how many teams from Oradell at states", "how many teams from Oradell in 2025-26"]) {
      expect((await ask(q)).stat?.intent, q).not.toBe("city-teams");
    }
  });
});

describe("sorry, with what was read (§4)", () => {
  it("a team asked about something search can't answer yet: the team read, and its own searches to tap", async () => {
    const a = await ask("what is 4215's favorite color");
    expect(a.sorry?.understood.join(" ")).toContain("4215");
    expect(a.sorry?.suggest.length).toBeGreaterThan(0);
    expect(a.sorry?.suggest.every((x) => x.includes("4215"))).toBe(true);
  });
  it("never on an answer, on a placeholder team, or in the dropdown", async () => {
    expect((await ask("4215 record")).sorry).toBeUndefined();
    expect((await ask("ultraviolet")).sorry).toBeUndefined();
    expect((await ask("99950 favorite color")).sorry?.understood.join(" ") ?? "").not.toContain("99950");
    expect((await searchAnswer("what is 4215's favorite color", { limit: 8, now: NOW })).sorry).toBeUndefined();
  });
});

describe("what answered before answers the same (§5)", () => {
  it("a team's counts, stats and lists", async () => {
    expect(card(await ask("how many matches has 4215 won"))).toMatchObject({ kind: "wins-count", headline: "2 wins" });
    expect(card(await ask("4215 wins count"))).toMatchObject({ kind: "wins-count", headline: "2 wins" });
    expect(card(await ask("4215 record"))).toMatchObject({ kind: "record", headline: "2-1-0" });
    expect(card(await ask("4215 OPR"))).toMatchObject({ kind: "opr" });
    expect(card(await ask("4215 last 10 matches"))).toMatchObject({ kind: "last-matches" });
  });
  it("a region's count and a plain name stay search's own", async () => {
    expect(card(await ask("how many teams are from NJ"))).toMatchObject({ kind: "info", title: "How many teams in New Jersey · 2026–27" });
    // A name alone is still a team lookup: every team with it, never a count.
    const a = await ask("ultraviolet");
    expect(a.stat).toBeUndefined();
    expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(expect.arrayContaining(["20245", "23268"]));
    expect((await ask("bad wolf")).hits[0]).toMatchObject({ kind: "team", ref: "6980" });
  });
});
