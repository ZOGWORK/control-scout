import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { fingerprint, meetSeeded, priorSeeds, replayInput } from "./disagreements";
import type { FieldRow } from "../../src/shared/api";

const S = 2025;

async function event(code: string, start: string, end: string, teams: number[], o: { played?: number } = {}) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 0, 0, 'test')", [S, code, `Event ${code}`, start, end]);
  for (const [i, t] of teams.entries()) await run("INSERT INTO event_teams (season, code, team, rank, qual_played) VALUES (?, ?, ?, ?, ?)", [S, code, t, i + 1, o.played ?? 5]);
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

beforeAll(async () => {
  const c = openDb("file::memory:");
  setDb(c);
  await migrate(c);
  // Team 7 played A (Nov), then B (Dec); B is the latest before HERE (Jan). C is after HERE; T is tiny.
  await event("A", "2025-11-01", "2025-11-01", [7, ...range(100, 11)]);
  await event("B", "2025-12-06", "2025-12-06", [...range(200, 9), 7, ...range(300, 2)]);
  await event("T", "2025-12-20", "2025-12-20", [7, 8, 9]);
  await event("FEW", "2025-12-13", "2025-12-13", [8, ...range(400, 11)], { played: 2 });
  await event("C", "2026-02-01", "2026-02-01", [7, ...range(500, 11)]);
  await event("HERE", "2026-01-10", "2026-01-11", [7, 8, ...range(600, 10)]);
});

describe("priorSeeds", () => {
  it("takes each team's seed at its latest earlier event with a real field", async () => {
    const p = await priorSeeds(S, "HERE", "2026-01-10", [7, 8, 600]);
    expect(p.get(7)).toEqual({ rank: 10, of: 12, code: "B", name: "Event B" });
    // 8's only earlier events: a 3-team one and one where it played too few matches.
    expect(p.has(8)).toBe(false);
    expect(p.has(600)).toBe(false);
  });
});

describe("replayInput", () => {
  const side = (np: number) => ({ teams: [1, 2], auto: 10, teleop: np - 20, endgame: 10, np, penCommitted: 0, total: np });
  const ev = (code: string, times: number[], np = 50) => ({ season: S, code, matches: times.map((time, i) => ({ season: S, eventCode: code, level: "qual", series: 0, number: i + 1, time, red: side(np), blue: side(40) })) }) as any;
  it("covers the matches up to the cutoff, earlier events' corrections included, and nothing after it", () => {
    const base = replayInput([ev("A", [1, 2]), ev("B", [5])], 3);
    expect(base.startsWith("2:")).toBe(true);
    expect(replayInput([ev("A", [1, 2]), ev("B", [5], 99)], 3)).toBe(base); // after the cutoff
    expect(replayInput([ev("A", [1, 2], 60), ev("B", [5])], 3)).not.toBe(base); // a corrected earlier result
    expect(replayInput([ev("A", [1, 2, 3]), ev("B", [5])], 3)).not.toBe(base); // a match added
  });
});

describe("fingerprint", () => {
  const d = (rank: number) => ({ field: [{ team: 7, rank, qualPlayed: 5, wins: 3, losses: 2, ties: 0, rp: 2, opr: { np: 40 } }], matches: [{ played: true }] }) as any;
  it("changes when the seeding does", () => {
    expect(fingerprint(d(1), 1)).toBe(fingerprint(d(1), 1));
    expect(fingerprint(d(1), 1)).not.toBe(fingerprint(d(2), 1));
    expect(fingerprint(d(1), 1)).not.toBe(fingerprint(d(1), 2));
  });
});

describe("meetSeeded", () => {
  const row = (team: number, o: Partial<FieldRow> = {}): FieldRow => ({ team, name: null, city: null, state: null, rank: 11, rp: 1.1, tbp: 9, wins: 2, losses: 4, ties: 0, qualPlayed: 6,
    opr: { np: 20, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null, ...o });
  it("a league meet is compared with its own seeding, not FIRST's league standing", () => {
    // The meet's record differs from the league row's (2-4-0 over 6), so a mix of the two would show.
    const [m] = meetSeeded([row(15762, { meet: { rank: 14, rs: 1.83, tb: [35.5, 0.5, 12], wins: 3, losses: 1, ties: 1, played: 5 } })]);
    expect(m).toMatchObject({ rank: 14, rp: 1.83, qualPlayed: 5, wins: 3, losses: 1, ties: 1 });
  });
  it("a league meet team with no counted match has no seed there; any other event keeps FIRST's", () => {
    expect(meetSeeded([row(1, { meet: null })])[0]).toMatchObject({ rank: null, rp: null, qualPlayed: 0 });
    expect(meetSeeded([row(2)])[0]).toMatchObject({ rank: 11, rp: 1.1, qualPlayed: 6 });
  });
});

