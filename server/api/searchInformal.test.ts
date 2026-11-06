// Informal and short forms said in full before anything reads the query (server/api/query/lexicon.ts INFORMAL; owner:
// "events happening rn" found nothing while "events happening live" listed today's). Every time question in both
// forms, across teams and places, reads the same; a name holding a form keeps it.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { informalQuery } from "./query/lexicon";

const S = 2026;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const TEAMS: [number, string, string][] = [[4215, "Hypnotic Robotics", "NJ"], [7149, "ENFORCERS", "TX"], [23268, "Ultraviolet", "NJ"], [31337, "RN Robotics", "MI"]];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, state] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  const events: [string, string, string, number][] = [
    ["USNJTODAY", "Garden State League Meet", "NJ", 0], ["USTXTMRW", "Lone Star Qualifier", "TX", 1],
    ["USMIWEEK", "Great Lakes Qualifier", "MI", 7], ["USNJLAST", "Shore League Meet", "NJ", -7],
  ];
  for (const [code, name, state, d] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', ?, 'USA', ?, ?, 't')", [S, code, name, state, day(d), day(d)]);
    for (const [n, , st] of TEAMS) if (st === state || n === 4215) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, n]);
  }
  await rebuildSearch();
});

/** What an answer read: its label and the first results, so two readings compare whole. */
const reading = (a: Awaited<ReturnType<typeof ask>>) => a.step === "recovery" ? null : JSON.stringify([a.understood?.label, a.stat?.intent, a.card?.kind, a.hits.slice(0, 5).map((h) => h.ref)]);

// Each time question, its full words and a short form.
const PAIRS: [string, string][] = [
  ["events happening right now", "events happening rn"], ["events right now", "events atm"], ["live events right now", "live events rn rn"],
  ["events today", "events tdy"], ["events today", "events 2day"],
  ["events tomorrow", "events tmrw"], ["events tomorrow", "events tmr"], ["events tomorrow", "events 2moro"],
  ["events this weekend", "events this wknd"], ["events next week", "events nxt wk"], ["events next week", "events nxt week"],
  ["events last week", "events lst wk"], ["events yesterday", "events yday"],
  ["matches right now", "matches rn"],
];

describe("informal and short forms are their full words", () => {
  it("every time question reads the same in both forms, alone, in a place and for a team", async () => {
    const failing: string[] = [];
    const scopes = ["", " in nj", " in texas", " in michigan"];
    for (const [full, short] of PAIRS) for (const where of scopes) {
      const [a, b] = await Promise.all([ask(`${full}${where}`), ask(`${short}${where}`)]);
      if (reading(a) !== reading(b)) failing.push(`${full}${where} | ${short}${where} → ${reading(a)} | ${reading(b)}`);
    }
    for (const [n] of TEAMS.slice(0, 3)) for (const [full, short] of [["upcoming events this season", "upcoming events this szn"], ["next event", "nxt event"], ["events this weekend", "events this wknd"]]) {
      const [a, b] = await Promise.all([ask(`${n} ${full}`), ask(`${n} ${short}`)]);
      if (reading(a) !== reading(b)) failing.push(`${n} ${full} | ${n} ${short} → ${reading(a)} | ${reading(b)}`);
    }
    expect(failing).toEqual([]);
  });
  it("the owner's query lists today's events and keeps the query as typed", async () => {
    const a = await ask("events happening rn");
    expect(a.q).toBe("events happening rn");
    expect(a.hits.map((h) => h.ref)).toContain(`${S}:USNJTODAY`);
  });
  it("only a standalone word, never a word of a team's or an event's name", async () => {
    expect(informalQuery("events happening rn", () => false)).toBe("events happening right now");
    expect(informalQuery("burn turn rnd", () => false)).toBe("burn turn rnd");
    expect(informalQuery("RN Robotics events", (w) => w.toLowerCase() === "rn robotics")).toBe("RN Robotics events");
    expect((await ask("RN Robotics")).hits[0]?.ref).toBe("31337");
    expect((await ask("rn robotics events")).hits[0]?.ref).toBe("31337");
  });
  // Greptile on #973: the expansion keeps the query's quotes and operators, so a quoted name stays exact.
  it("quotes, operators and punctuation around a form stay as typed", async () => {
    expect(informalQuery('"Hypnotic Robotics" rn?', () => false)).toBe('"Hypnotic Robotics" right now?');
    expect(informalQuery("4215 | 7149 events tmrw", () => false)).toBe("4215 | 7149 events tomorrow");
    // Inside quotes, nothing is said another way; outside them, it still is.
    expect(informalQuery('"RN" robotics events rn', () => false)).toBe('"RN" robotics events right now');
    expect(informalQuery('"rn robotics" tmrw', () => false)).toBe('"rn robotics" tomorrow');
    expect((await ask('"RN" Robotics')).hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(["31337"]);
    const a = await ask('"Hypnotic Robotics" rn');
    expect(a.q).toBe("Hypnotic Robotics rn");
    expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(["4215"]);
  });
});
