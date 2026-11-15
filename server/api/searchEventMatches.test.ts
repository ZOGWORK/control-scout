// An event's matches asked for by its name ("<event> matches", owner: "CRI matches" should play its clips): its matches
// in the order played, each row linking the match, so the answer's video plays each one (./answers/video.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { rowRefs } from "./answers/video";
import { matchFindAnswer } from "./query/matchFind";
import type { SearchAnswer } from "../../src/shared/api";

const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
const table = (a: SearchAnswer) => a.stat?.blocks.find((b) => b.kind === "table") as { rows: { cells: Record<string, unknown>; href?: string }[]; columns: { key: string }[] } | undefined;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams = [4215, 6980, 23268, 7149, 5000, 5001];
  for (const n of teams) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Chicago', 'IL', 'USA')", [n, `Team ${n}`]);
  // Two editions under one code, FIRST's real name; 70 quals and two playoff matches in the latest (more than 60 rows).
  for (const [season, start, quals] of [[S - 1, `${S}-07-19`, 3], [S, `${S + 1}-07-24`, 70]] as const) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, 'FPECRI', 'Chicago Robotics Invitational Premier Event', 'Premier', 'Chicago', 'IL', 'USA', ?, ?, 'America/Chicago', 'cri')", [season, start, start]);
    for (const t of teams) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'FPECRI', ?)", [season, t]);
    const ms: [string, number, number, string][] = [...Array.from({ length: quals }, (_, i) => ["qual", 0, i + 1, `Q${i + 1}`] as [string, number, number, string]), ["playoff", 1, 1, "M1"], ["playoff", 2, 1, "M2"]];
    // Inserted out of order: the answer orders them.
    for (const [level, series, n, label] of [...ms].reverse()) {
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, red_auto, blue_auto, source)
                 VALUES (?, 'FPECRI', ?, ?, ?, ?, ?, 1, ?, ?, 100, 100, 20, 10, 'cri')`, [season, level, series, n, label, `${start}T10:00:00`, 100 + n, 100 + n]);
      for (const [t, al] of [[4215, "red"], [6980, "red"], [23268, "blue"], [7149, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'FPECRI', ?, ?, ?, ?, ?, 1)", [season, level, series, n, t, al]);
    }
  }
  await rebuildSearch();
});

describe("an event's matches by its name", () => {
  it("lists every match in the order played, qualification first, each linking the match", async () => {
    for (const q of ["Chicago Robotics Invitational Premier Event matches", "matches at Chicago Robotics Invitational Premier Event", "FPECRI matches", "CRI matches"]) {
      const a = await ask(q);
      expect(a.stat?.title, q).toBe(`Matches at Chicago Robotics Invitational Premier Event, ${S}–${String((S + 1) % 100).padStart(2, "0")}`);
      const t = table(a)!;
      expect(t.rows.map((r) => r.cells.match), q).toEqual([...Array.from({ length: 70 }, (_, i) => `Q${i + 1}`), "M1", "M2"]);
      expect(t.rows[0].href, q).toBe(`/events/${S}/FPECRI?match=qual:0:1`);
      // One event: said in the title, not on every row; no rank or measure column.
      expect(t.columns.map((c) => c.key), q).toEqual(["match", "score", "date"]);
    }
  });
  it("every row's video is read, the finals too, past the 60 an answer used to stop at", async () => {
    const refs = rowRefs(await ask("CRI matches"));
    expect(refs).toHaveLength(72);
    expect(refs.at(-1)?.key).toBe("playoff:2:1");
  });
  it("a match type and a year narrow it: the playoffs, the edition held that year", async () => {
    const p = await ask("CRI playoff matches");
    expect(p.stat?.title).toMatch(/^Playoff matches at Chicago Robotics Invitational Premier Event, /);
    expect(table(p)!.rows.map((r) => r.cells.match)).toEqual(["M1", "M2"]);
    const y = await ask(`CRI ${S} matches`);
    expect(table(y)!.rows.map((r) => r.cells.match)).toEqual(["Q1", "Q2", "Q3", "M1", "M2"]);
  });
  it("leaves a team's matches, a measure and a place's matches to their own readers", async () => {
    expect((await ask("4215 matches")).stat?.title ?? "").not.toMatch(/^Matches at /);
    expect((await ask("CRI highest scoring match")).stat?.title).toMatch(/^Highest-scoring match at /);
    expect((await ask("matches")).stat?.title ?? "").not.toMatch(/^Matches at /);
  });
});

describe("the play-order list itself", () => {
  const order = (n: number, events: { season: number; code: string }[]) => matchFindAnswer({ measure: "order", season: S, region: null, level: null, finals: false, kind: null, n, list: true, events, named: true });
  it("two events together: each match number in event order, never by score, and the event said per row", async () => {
    // The earlier edition (code shared) stands in for a second division: both listed, Q1s first, by code.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FPECRI2', 'Chicago Robotics Invitational Premier Event Division 2', 'Premier', 'Chicago', 'IL', 'USA', ?, ?, 'cri')", [S, `${S + 1}-07-24`, `${S + 1}-07-24`]);
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, red_auto, blue_auto, source)
               VALUES (?, 'FPECRI2', 'qual', 0, 1, 'Q1', ?, 1, 300, 300, 100, 100, 20, 10, 'cri')`, [S, `${S + 1}-07-24T10:00:00`]);
    const a = await order(3, [{ season: S, code: "FPECRI" }, { season: S, code: "FPECRI2" }]);
    const t = a.blocks.find((b) => b.kind === "table") as unknown as { rows: { href?: string }[]; columns: { key: string }[] };
    expect(t.rows.map((r) => r.href)).toEqual([`/events/${S}/FPECRI?match=qual:0:1`, `/events/${S}/FPECRI2?match=qual:0:1`, `/events/${S}/FPECRI?match=qual:0:2`]);
    expect(t.columns.map((c) => c.key)).toEqual(["match", "score", "event", "date"]);
  });
  it("a list cut short says how much of it is shown", async () => {
    const a = await order(5, [{ season: S, code: "FPECRI" }]);
    expect(a.definition).toMatch(/^The first 5 of the 72 played matches, in the order played/);
    expect((await order(200, [{ season: S, code: "FPECRI" }])).definition).toMatch(/^Every played match, in the order played/);
  });
});
