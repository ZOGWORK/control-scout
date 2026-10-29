// The team page's event rows add up to the season record (launch P0, 2026-10-28). They didn't:
//  - a league meet's row showed FIRST's ranking row, which is the league's running standing (10-0-0 over 24
//    matches at every meet of a team that went 0-2 at one);
//  - every row was the quals alone while the season record counts playoffs;
//  - a finished league meet with no matches listed every league team (ghost rows);
//  - a scrimmage with played matches but no ranking row showed nothing;
//  - the season record left out qualification no-shows, which FIRST counts (team 1's 2025 record).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { computeSeasonStats } from "./job";
import { computeRecords } from "./records";
import { loadSeason } from "./load";
import { seasonStats, teamEvents, teamSummaries } from "../api/teams";
import type { TeamEventRow } from "../../src/shared/api";

const S = 2025;
const A = 11, B = 12, C = 13, D = 14, E = 15, F = 16, G = 17, H = 18;
let n = 0;

async function event(code: string, type: string, start: string) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'test')", [S, code, code, type, start, start]);
}
/** FIRST's ranking row as it publishes it (for a league meet: the league's running standing). */
async function ranking(code: string, team: number, rank: number | null, w: number | null, l: number | null, played: number | null) {
  await run("INSERT INTO event_teams (season, code, team, rank, rp, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)", [S, code, team, rank, rank == null ? null : 2.5, w, l, played]);
}
type Slot = number | { team: number; surrogate?: boolean; onField?: boolean };
/** A played match; red scores `rs`, blue `bs`. */
async function match(code: string, level: "qual" | "playoff", red: Slot[], blue: Slot[], rs: number, bs: number) {
  const k = ++n;
  await run(`INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
    blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, 10, 20, 5, 0, ?, ?, 10, 20, 5, 0, 'test')`,
  [S, code, level, k, `M${k}`, rs, rs, bs, bs]);
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const s of ts) {
    const t = typeof s === "number" ? { team: s } : s;
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, surrogate, on_field) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)",
      [S, code, level, k, t.team, alliance, t.surrogate ? 1 : 0, t.onField === false ? 0 : 1]);
  }
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // A league meet: A goes 0-2 there, but FIRST's row is the league's standing (10-0-0 over 24).
  await event("MEET", "LeagueMeet", "2025-11-08");
  for (const t of [A, B, C, D]) await ranking("MEET", t, t === A ? 2 : 1, 10, 0, 24);
  await match("MEET", "qual", [A, B], [C, D], 40, 60);
  await match("MEET", "qual", [A, C], [B, D], 30, 50);
  // Another meet of the league, with no matches on record: every league team is on its roster (a ghost row).
  await event("MEET9", "LeagueMeet", "2025-12-06");
  for (const t of [A, B, C, D]) await ranking("MEET9", t, 2, 10, 0, 24);
  // A qualifier with playoffs: A 1-1 in quals (FIRST's row agrees), then 2-1 in playoffs; E sits out a playoff
  // match (a third alliance member: not its match). In quals F was a surrogate once (not on its record) and a
  // no-show once (on its record, as FIRST counts it).
  await event("QUAL", "Qualifier", "2026-01-10");
  for (const [t, w, l, p] of [[A, 1, 1, 2], [B, 1, 1, 2], [C, 1, 1, 2], [D, 0, 2, 2], [F, 1, 0, 1]] as const) await ranking("QUAL", t, 1, w, l, p);
  await match("QUAL", "qual", [A, B], [C, D], 100, 80);
  await match("QUAL", "qual", [A, D], [B, C], 70, 90);
  await match("QUAL", "qual", [{ team: F, surrogate: true }, B], [C, D], 50, 60);
  await match("QUAL", "qual", [{ team: F, onField: false }, B], [C, D], 80, 60);
  await match("QUAL", "playoff", [A, B, { team: E, onField: false }], [C, D], 120, 100);
  await match("QUAL", "playoff", [A, B], [C, D], 90, 110);
  await match("QUAL", "playoff", [A, B], [C, D], 130, 100);
  // G only ever played as a surrogate, at SUR: on the field, nothing on its record.
  await event("SUR", "Qualifier", "2026-02-07");
  await ranking("SUR", G, null, null, null, null);
  await match("SUR", "qual", [{ team: G, surrogate: true }, E], [B, C], 60, 40);
  // H's latest event published no scores (and has no type on record); an earlier one it played.
  await event("OLDQ", "Qualifier", "2025-12-13");
  await ranking("OLDQ", H, 1, 1, 0, 1);
  await match("OLDQ", "qual", [H, E], [B, C], 70, 20);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'NOSCORE', 'NOSCORE', NULL, '2026-03-14', '2026-03-14', 0, 0, 'test')", [S]);
  await ranking("NOSCORE", H, null, null, null, null);
  // A scrimmage with played matches and no ranking row at all.
  await event("SCRIM", "Scrimmage", "2025-10-04");
  await match("SCRIM", "qual", [A, B], [C, D], 20, 10);
  // A scrimmage that published no scores: kept, with no record.
  await event("SCRIM0", "Scrimmage", "2025-09-27");
  await ranking("SCRIM0", A, null, null, null, null);
  const events = await loadSeason(S);
  await computeSeasonStats(S, events);
  await computeRecords(S, events);
});

const sum = (rows: TeamEventRow[]) => rows.reduce((a, r) => ({ wins: a.wins + (r.wins ?? 0), losses: a.losses + (r.losses ?? 0), ties: a.ties + (r.ties ?? 0), matches: a.matches + (r.played ?? 0) }), { wins: 0, losses: 0, ties: 0, matches: 0 });

describe("team event rows", () => {
  it("add up to the season record, for every team", async () => {
    for (const t of [A, B, C, D, E, F, G, H]) {
      const rec = (await seasonStats(S, t))?.record;
      const { wins, losses, ties, matches } = sum(await teamEvents(S, t));
      expect({ team: t, wins, losses, ties, matches }).toEqual({ team: t, wins: rec?.wins ?? 0, losses: rec?.losses ?? 0, ties: rec?.ties ?? 0, matches: rec?.matches ?? 0 });
    }
  });

  it("show a league meet's own record and rank, not the league's running standing", async () => {
    const meet = (await teamEvents(S, A)).find((e) => e.code === "MEET")!;
    expect(meet).toMatchObject({ wins: 0, losses: 2, ties: 0, played: 2, qualPlayed: 2, rank: 4 });
  });

  it("count playoffs, with the quals alone beside them", async () => {
    const q = (await teamEvents(S, A)).find((e) => e.code === "QUAL")!;
    expect(q).toMatchObject({ wins: 3, losses: 2, ties: 0, played: 5, qual: { wins: 1, losses: 1, ties: 0, played: 2 } });
    expect((await seasonStats(S, A))!.record).toMatchObject({ wins: 4, losses: 4, ties: 0, matches: 8 });
  });

  it("leave out a finished league meet the team has no match at, and keep a scrimmage with no scores, saying so", async () => {
    const codes = (await teamEvents(S, A)).map((e) => e.code);
    expect(codes).toEqual(["SCRIM0", "SCRIM", "MEET", "QUAL"]);
    const scrim = (await teamEvents(S, A)).find((e) => e.code === "SCRIM")!;
    expect(scrim).toMatchObject({ wins: 1, losses: 0, played: 1 });
    expect((await teamEvents(S, A)).find((e) => e.code === "SCRIM0")).toMatchObject({ wins: null, played: null });
  });

  it("count a qualification no-show, not a surrogate match or a playoff match sat out", async () => {
    const f = await teamEvents(S, F);
    expect(f.map((e) => [e.code, e.wins, e.losses, e.played, e.onField])).toEqual([["QUAL", 1, 0, 1, true]]);
    expect((await seasonStats(S, F))!.record).toMatchObject({ wins: 1, losses: 0, matches: 1 });
    // E sat out QUAL's playoff match (not its match); SUR and OLDQ are its only events.
    expect((await teamEvents(S, E)).map((e) => e.code)).toEqual(["OLDQ", "SUR"]);
    expect((await seasonStats(S, E))!.record).toMatchObject({ wins: 2, losses: 0, matches: 2 });
  });

  it("team summaries give the last event's own record, not a ghost meet", async () => {
    // A later meet A is on the roster of but that has no results: not its last event.
    await event("MEET9B", "LeagueMeet", "2026-04-04");
    await ranking("MEET9B", A, 1, 10, 0, 24);
    const [s] = await teamSummaries([A], S);
    expect(s.lastEvent).toMatchObject({ code: "QUAL", record: "3-2-0" });
  });

  it("keep an event the team only played at as a surrogate: on the field, nothing on its record", async () => {
    const rows = await teamEvents(S, G);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "SUR", wins: null, played: null, onField: true });
    expect((await teamSummaries([G], S))[0].lastEvent).toMatchObject({ code: "SUR", record: null });
  });

  it("team summaries keep a finished event that published no scores as the last event, as the team page does", async () => {
    expect((await teamEvents(S, H)).map((e) => e.code)).toEqual(["OLDQ", "NOSCORE"]);
    expect((await teamSummaries([H], S))[0].lastEvent).toMatchObject({ code: "NOSCORE", record: null });
  });
});
