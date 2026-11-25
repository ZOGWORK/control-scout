// The schedule as it changes (bot/eventChanges.ts): a moved start, a changed lineup, a match that appeared, the match
// two away, and the state roundtrip the tick compares against — pure functions, plus the table.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import type { MatchView } from "../src/shared/api";
import type { Follow } from "./follows";
import { ALERT_WINDOW_MS, alertKey, alertLead, changedMatches, loadMatchState, onDeckDue, saveMatchState, type MatchState } from "./eventChanges";

const NOW = Date.parse("2026-10-24T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const t = (n: number) => ({ number: n, surrogate: false, dq: false, onField: true });
const m = (n: number, at: number | null, over: Partial<MatchView> = {}): MatchView => ({
  season: 2025, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null,
  startsAt: at === null ? null : iso(at), played: false,
  red: { teams: [t(1), t(2)], score: null }, blue: { teams: [t(3), t(4)], score: null },
  video: null, prediction: null, ...over,
});
const f = (team: number, channel = "c1"): Follow => ({ guild_id: "g", channel_id: channel, team, created_at: iso(NOW - 864e5), failures: 0 });
const state = (over: Partial<MatchState> = {}): MatchState => ({ startsAt: iso(NOW + 600_000), red: [1, 2], blue: [3, 4], level: "qual", ...over });
const prev = (rows: [string, MatchState][]) => new Map(rows);

describe("schedule changes", () => {
  it("a moved start posts once per channel, and says what it was", () => {
    const match = m(7, NOW + 1_800_000);
    const changes = changedMatches([f(1), f(1, "c2")], [match], prev([["qual:0:7", state()]]), NOW);
    expect(changes.map((c) => [c.channel, c.kind])).toEqual([["c1", "moved"], ["c2", "moved"]]);
    expect(alertLead(changes[0], NOW)).toContain(`was <t:${Math.floor((NOW + 600_000) / 1000)}:t>`);
  });

  it("a change smaller than the threshold, or one to a match not followed, isn't posted", () => {
    expect(changedMatches([f(1)], [m(7, NOW + 600_000 + 30_000)], prev([["qual:0:7", state()]]), NOW)).toEqual([]);
    expect(changedMatches([f(9)], [m(7, NOW + 1_800_000)], prev([["qual:0:7", state()]]), NOW)).toEqual([]);
  });

  it("each new time or lineup is a new claim, so a second change isn't swallowed", () => {
    const at = { channel: "c1", was: null };
    const first = { ...at, match: m(7, NOW + 600_000), kind: "moved" as const };
    const later = { ...at, match: m(7, NOW + 1_800_000), kind: "moved" as const };
    expect(alertKey(first)).not.toBe(alertKey(later));
    const red5 = { ...at, match: m(7, NOW + 600_000, { red: { teams: [t(1), t(5)], score: null } }), kind: "changed" as const };
    const red6 = { ...at, match: m(7, NOW + 600_000, { red: { teams: [t(1), t(6)], score: null } }), kind: "changed" as const };
    expect(alertKey(red5)).not.toBe(alertKey(red6));
  });

  it("a changed lineup is its own alert; a played or far-off match is never one", () => {
    const changed = m(7, NOW + 600_000, { red: { teams: [t(1), t(5)], score: null } });
    expect(changedMatches([f(1)], [changed], prev([["qual:0:7", state()]]), NOW)[0].kind).toBe("changed");
    expect(changedMatches([f(1)], [m(7, NOW - 60_000, { played: true })], prev([["qual:0:7", state()]]), NOW)).toEqual([]);
    expect(changedMatches([f(1)], [m(7, NOW + ALERT_WINDOW_MS + 60_000)], prev([["qual:0:7", state()]]), NOW)).toEqual([]);
  });

  it("a match that appeared (a playoff pairing) is new; the first sight of an event is silent", () => {
    const playoff = m(1, NOW + 600_000, { key: "playoff:1:1", level: "playoff", label: "M1" });
    const changes = changedMatches([f(1)], [playoff], prev([["qual:0:7", state()]]), NOW);
    expect(changes.map((c) => c.kind)).toEqual(["new"]);
    // No state at all: the caller is about to record it, and announcing every match would be a deploy's noise.
    expect(changedMatches([f(1)], [playoff], new Map(), NOW)).toEqual([]);
  });

  it("on deck: the match two ahead, only while it is close, once per channel and match", () => {
    const soon = [m(1, NOW + 10 * 60_000), m(2, NOW + 30 * 60_000), m(3, NOW + 50 * 60_000)];
    // Q3 is two unplayed matches after Q1, 50 minutes out: on deck.
    const due = onDeckDue([f(1), f(1, "c2")], soon, NOW);
    expect(due.map((d) => [d.channel, d.match.label])).toEqual([["c1", "Q3"], ["c2", "Q3"]]);
    // Two followed teams in it: one post, naming both.
    expect(onDeckDue([f(1), f(3)], soon, NOW)[0].teams).toEqual([1, 3]);
    // Too far out, or not enough matches after this one.
    expect(onDeckDue([f(1)], soon.map((x) => ({ ...x, startsAt: iso(NOW + 3 * 3600_000) })), NOW)).toEqual([]);
    expect(onDeckDue([f(1)], soon.slice(0, 2), NOW)).toEqual([]);
  });
});

describe("the schedule state, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => { await run("DELETE FROM discord_match_state"); });

  it("round-trips an event's schedule, sorted, by match key", async () => {
    await saveMatchState(2025, "X", [m(7, NOW + 600_000), m(8, null)], NOW);
    const read = await loadMatchState(2025, "X");
    expect(read.get("qual:0:7")).toEqual({ startsAt: iso(NOW + 600_000), red: [1, 2], blue: [3, 4], level: "qual" });
    expect(read.get("qual:0:8")?.startsAt).toBeNull();
    // A second save updates the row it has and keeps the others (a match that left the schedule is pruned by age).
    await saveMatchState(2025, "X", [m(7, NOW + 1_200_000)], NOW + 60_000);
    expect((await loadMatchState(2025, "X")).size).toBe(2);
    expect((await loadMatchState(2025, "X")).get("qual:0:7")?.startsAt).toBe(iso(NOW + 1_200_000));
    expect((await loadMatchState(2025, "OTHER")).size).toBe(0);
  });

  it("refreshes seen_at for a stable schedule, so a live event's rows aren't pruned as stale", async () => {
    await saveMatchState(2025, "X", [m(7, NOW + 600_000)], NOW);
    await saveMatchState(2025, "X", [m(7, NOW + 600_000)], NOW + 60_000);
    const [row] = await all<{ seen_at: string }>("SELECT seen_at FROM discord_match_state WHERE match_key = 'qual:0:7'");
    expect(row.seen_at).toBe(iso(NOW + 60_000));
  });

  it("leaves a skipped match at its old state, so a failed alert is retried", async () => {
    await saveMatchState(2025, "X", [m(7, NOW + 600_000)], NOW);
    await saveMatchState(2025, "X", [m(7, NOW + 1_800_000)], NOW + 60_000, new Set(["qual:0:7"]));
    expect((await loadMatchState(2025, "X")).get("qual:0:7")?.startsAt).toBe(iso(NOW + 600_000));
  });
});
