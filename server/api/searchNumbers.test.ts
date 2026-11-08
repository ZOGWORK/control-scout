// Singular, plural and a one-edit typo of every intent word are one question (owner, 2026-11-06: "4215 upcoming
// event" answered, "4215 upcoming events" and "4215 upcoming evntd" read Sorry). A generated matrix over several
// teams: each set answers in all three forms, the same way.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { numberQuery, ownWords } from "./spelling";

const S = 2025;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const TEAMS: [number, string][] = [[4215, "Hypnotic Robotics"], [7149, "ENFORCERS"], [23268, "Ultraviolet"]];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2010)", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (?, ?, 100, 30, 60, 10, 90, 10, 10, 7, 3, 0)`, [S, n]);
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'USNJQ1', 'Think', 1, ?, 'Think Award')", [S, n]);
  }
  // A finished qualifier, and two meets on one day ahead (an AM and a PM session) that every team is registered for.
  await run(`INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES
    (?, 'USNJQ1', 'Garden Qualifier', 'Qualifier', 'Union', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't'),
    (2026, 'USNJM1AM', 'Northeast League Meet AM', 'LeagueMeet', 'Union', 'NJ', 'USA', ?, ?, 't'),
    (2026, 'USNJM1PM', 'Northeast League Meet PM', 'LeagueMeet', 'Union', 'NJ', 'USA', ?, ?, 't')`, [S, day(1), day(1), day(1), day(1)]);
  for (const [n] of TEAMS) for (const [s, code] of [[S, "USNJQ1"], [2026, "USNJM1AM"], [2026, "USNJM1PM"]] as const) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [s, code, n]);
  await rebuildSearch();
});

/** How an answer answered: a stat, a card, or a team's page at the section that answers; null for none. */
const how = (a: Awaited<ReturnType<typeof ask>>) => {
  if (a.sorry || a.step === "recovery") return null;
  if (a.stat) return `stat:${a.stat.intent}`;
  if (a.card) return `card:${a.card.kind}`;
  const h = a.hits[0];
  return h?.kind === "team" && h.section && !/isn't answered/.test(a.understood?.label ?? "") ? `section:${h.section}` : null;
};

// Each intent word in both numbers; the typo is one slip in the plural (a swap, a letter left out, a key beside it).
const WORDS: [string, string, string][] = [
  ["upcoming event", "upcoming events", "upcoming evntd"], ["next event", "next events", "next evnets"], ["award", "awards", "awrads"],
  ["record", "records", "recrod"], ["opr", "oprs", "oprs"], ["rating", "ratings", "raitngs"], ["prediction", "predictions", "predction"],
  ["match", "matches", "matchse"], ["event", "events", "evnets"], ["win", "wins", "wisn"], ["season", "seasons", "sesaons"],
];

describe("singular, plural and a typo are one question", () => {
  it("every intent word answers in all three forms the same way, for every team", async () => {
    const failing: string[] = [];
    for (const [n] of TEAMS) for (const forms of WORDS) {
      const got = await Promise.all(forms.map(async (w) => how(await ask(`${n} ${w}`))));
      if (got.some((g) => g == null) || new Set(got).size > 1) failing.push(`${forms.map((w) => `${n} ${w}`).join(" | ")} → ${got.join(" | ")}`);
    }
    expect(failing).toEqual([]);
  });
  // Greptile on #973: the dropdown builds no stat cards, so it is matched by what it read (the intent, card or section).
  it("the dropdown reads every form the same way too", async () => {
    const drop = async (q: string) => {
      const a = await searchAnswer(q, { limit: 15, learn: false });
      if (a.step === "recovery") return null;
      return a.intent?.kind ?? (a.card ? `card:${a.card.kind}` : a.hits[0]?.kind === "team" && a.hits[0].section ? `section:${a.hits[0].section}` : null);
    };
    const failing: string[] = [];
    for (const [n] of TEAMS) for (const forms of WORDS) {
      const got = await Promise.all(forms.map((w) => drop(`${n} ${w}`)));
      if (got.some((g) => g == null) || new Set(got).size > 1) failing.push(`${forms.map((w) => `${n} ${w}`).join(" | ")} → ${got.join(" | ")}`);
    }
    expect(failing).toEqual([]);
  });
  it("the owner's queries: the upcoming events listed, the typo corrected and answered", async () => {
    for (const q of ["4215 upcoming event", "4215 upcoming events", "4215 upcoming evntd", "4215 upcomming events"]) {
      const a = await ask(q);
      expect(a.card, q).toMatchObject({ kind: "next-event", title: "Upcoming events" });
      expect(a.card?.lines.map((l) => l.text), q).toEqual(["Northeast League Meet AM", "Northeast League Meet PM"]);
    }
    expect((await ask("4215 upcoming evntd")).didYouMean).toBe("4215 upcoming events");
    expect((await ask("4215 upcoming events")).didYouMean).toBeUndefined();
    expect((await ask("4215 recrod")).didYouMean).toBe("4215 record");
    expect((await ask("4215 awrads")).didYouMean).toBe("4215 awards");
    expect((await ask("7149 predction")).didYouMean).toBe("7149 prediction");
  });
  it("a name is never a keyword, and a word naming an event keeps its number", () => {
    expect(numberQuery("Hypnotic Robotics events")).toBe("Hypnotic Robotics event");
    // "states" is a state championship and "worlds" the FIRST Championship, never a count of states or worlds.
    expect(numberQuery("4215 states")).toBeNull();
    expect(numberQuery("4215 worlds")).toBeNull();
    expect(numberQuery("who won nj championship", true)).toBeNull();
    // An award's own name has no plural: "most inspire awards" never becomes "most inspires awards" (a team's name).
    expect(numberQuery("most inspire awards", true) ?? "").not.toMatch(/inspires/);
    expect(numberQuery("most think awards", true) ?? "").not.toMatch(/thinks/);
    // A question's own plain words are never nouns ("how", "the", "last").
    expect(numberQuery("how has the last event gone", true)).toBe("how has the last events gone");
  });
  it("each pair is one singular and one plural, -ies and -es too, and no made-up word is a spelling target", () => {
    expect(numberQuery("4215 penalties")).toBe("4215 penalty");
    expect(numberQuery("4215 penalty", true)).toBe("4215 penalties");
    expect(numberQuery("4215 matches")).toBe("4215 match");
    expect(numberQuery("4215 match", true)).toBe("4215 matches");
    expect(numberQuery("4215 penalties", true)).toBeNull();
    expect(numberQuery("4215 matches", true)).toBeNull();
    for (const w of ["penaltieses", "matcheses", "serieses"]) expect(ownWords().has(w), w).toBe(false);
  });
});
