// People also ask (./followUps.ts): every question shown is a search that answers directly (asked again from scratch,
// it gives the same line), none is the search itself or shown twice, a question with no answer for this team is left
// out, and the questions are the same for any team. The generator names no team, event or year.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "../query/parse";
import { parseContext } from "../query/context";
import { failureOf, outcomeTrace } from "../../searchFailures";
import { clearAllCaches } from "../../caches";
import { answerKey, candidates, followUps, pageAnswer, previewOf, ASK_MAX } from "./followUps";

const TEAMS = [4215, 6980, 7149] as const;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [7149, "ENFORCERS"], [207, "Critical Mass"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJQ1', 'Garden State Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't')");
  for (const [t, rank, opr] of [[4215, 1, 101.6], [6980, 2, 46.9], [7149, 3, 115.3], [207, 4, 60]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJQ1', ?, ?)", [t, rank]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'USNJQ1', ?, ?, 30, 60, 10, 3)", [t, opr]);
  }
  const games: [number, number, number[], number[]][] = [[150, 90, [4215, 207], [6980, 7149]], [80, 120, [4215, 6980], [7149, 207]], [200, 100, [7149, 4215], [6980, 207]]];
  for (const [i, [red, blue, reds, blues]] of games.entries()) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJQ1', 'qual', 0, ?, ?, '2026-01-10T10:00:00Z', 1, ?, ?, ?, ?, 't')", [i + 1, `Q${i + 1}`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJQ1', 'qual', 0, ?, ?, ?, 1)", [i + 1, t, a]);
    }
  }
  // Only 4215 has an award: "What awards has 6980 won?" has no answer, and is never asked.
  await run("INSERT INTO awards (season, code, team, type, placement, name) VALUES (2025, 'USNJQ1', 4215, 'Inspire', 1, 'Inspire Award')");
  await rebuildSearch();
});

const asked = async (q: string) => followUps(q, await pageAnswer(q, 25, new Set()));

describe("people also ask", () => {
  it.each(TEAMS)("asks only questions search answers directly, for %i", async (t) => {
    const q = `${t} record`;
    const ask = await asked(q);
    expect(ask.length).toBeGreaterThan(0);
    expect(ask.length).toBeLessThanOrEqual(ASK_MAX);
    // Never the search itself, never one question twice.
    expect(ask.map((x) => x.q.toLowerCase())).not.toContain(q);
    expect(new Set(ask.map((x) => x.q)).size).toBe(ask.length);
    clearAllCaches();
    for (const x of ask) {
      const a = await searchAnswer(x.q, { limit: 25 });
      expect(failureOf(x.q, a, outcomeTrace(a)), x.q).toBeNull();
      expect(a.sorry, x.q).toBeUndefined();
      // The line shown is the answer's own.
      expect(previewOf(a), x.q).toBe(x.preview);
    }
  });

  it("leaves out a question with no answer for this team", async () => {
    expect((await asked("4215 record")).map((x) => x.q)).toContain("What awards has 4215 won?");
    expect((await asked("6980 record")).map((x) => x.q)).not.toContain("What awards has 6980 won?");
  });

  it("never asks again, in other words, a search the page already offers", async () => {
    // A question search can't answer yet: the page offers the team's own searches ("4215 record 2025–26").
    const q = "what is 4215's favorite color";
    const a = await pageAnswer(q, 25, new Set());
    const offered = [...(a.suggest ?? []), ...(a.sorry?.suggest ?? [])];
    expect(offered.length).toBeGreaterThan(0);
    const what = async (x: string) => answerKey(await pageAnswer(x, 25, new Set()));
    const theirs = new Set(await Promise.all(offered.map(what)));
    const ask = await followUps(q, a);
    expect(ask.length).toBeGreaterThan(0);
    for (const x of ask) expect(theirs.has(await what(x.q)), x.q).toBe(false);
  });

  it("says a season the query typed with its preposition once", async () => {
    const q = "4215 record in 2025-26";
    const qs = candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set())).map((x) => x.q);
    expect(qs).toContain("What is 4215's OPR in 2025-26?");
    const last = candidates(await parseQuery("4215 record last season", await parseContext()), await pageAnswer("4215 record last season", 25, new Set())).map((x) => x.q);
    expect(last).toContain("What is 4215's OPR last season?");
    expect(last.filter((x) => /\bin (?:last|this)\b/i.test(x))).toEqual([]);
    expect(qs.filter((x) => /\bin in\b/i.test(x))).toEqual([]);
  });

  it("asks the same questions of any team", async () => {
    const shape = async (t: number) => {
      const q = `${t} record`;
      return candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set())).map((x) => x.q.replaceAll(String(t), "#"));
    };
    const [a, ...rest] = await Promise.all(TEAMS.map(shape));
    expect(a.length).toBeGreaterThan(ASK_MAX);
    for (const b of rest) expect(b).toEqual(a);
  });

  it("names no team, event or year in the generator", () => {
    const src = readFileSync(join(__dirname, "followUps.ts"), "utf8");
    expect(src.match(/\b\d{3,}\b/g)).toBeNull();
    expect(src).not.toMatch(/garden state|hypnotic|bad wolf|enforcers|critical mass/i);
  });
});
