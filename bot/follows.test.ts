// Automatic posts for followed teams: what's due when, one post per channel and match (restarts and two
// followed teams in a match included), a channel that's gone is dropped, a passing failure is retried.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, kvSet, migrate, openDb, run, setDb } from "../server/db";
import { clearAllCaches } from "../server/caches";
import { CURRENT_SEASON as S } from "../server/data/seasons";
import type { MatchView } from "../src/shared/api";
import { MAX_FAILURES, REMIND_MS, addFollow, dueNow, listFollows, notifyTick, postEmbed, removeFollow, type Follow } from "./follows";
import { Friendly } from "./views";

const NOW = Date.parse("2026-10-24T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("dueNow", () => {
  const t = (n: number) => ({ number: n, surrogate: false, dq: false, onField: true });
  const m = (n: number, at: number, played = false): MatchView => ({
    season: S, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: iso(at), played,
    red: { teams: [t(1), t(2)], score: played ? { total: 50, np: 50, auto: 0, teleop: 0, endgame: 0, pen: 0 } : null },
    blue: { teams: [t(3), t(4)], score: played ? { total: 40, np: 40, auto: 0, teleop: 0, endgame: 0, pen: 0 } : null },
    video: null, prediction: { pRed: 0.6, redMean: 50, blueMean: 40, tier: "moderate", kind: "live", predictedAt: null },
  });
  const f = (team: number, channel = "c1", since = NOW - 864e5): Follow => ({ guild_id: "g", channel_id: channel, team, created_at: iso(since), failures: 0 });

  it("a reminder within 15 minutes of the start, not before", () => {
    expect(dueNow([f(1)], [m(1, NOW + REMIND_MS)], NOW).map((d) => d.kind)).toEqual(["reminder"]);
    expect(dueNow([f(1)], [m(1, NOW + REMIND_MS + 60_000)], NOW)).toEqual([]);
    expect(dueNow([f(1)], [m(1, NOW - 60_000)], NOW)).toEqual([]); // started, no result yet: nothing
  });

  it("a result once played; never one from long ago or from before the follow", () => {
    expect(dueNow([f(3)], [m(1, NOW - 600_000, true)], NOW).map((d) => d.kind)).toEqual(["result"]);
    expect(dueNow([f(3)], [m(1, NOW - 7 * 3600_000, true)], NOW)).toEqual([]);
    expect(dueNow([f(3, "c1", NOW)], [m(1, NOW - 600_000, true)], NOW)).toEqual([]);
  });

  it("two followed teams in one match: one post in that channel naming both; other teams' matches: nothing", () => {
    const d = dueNow([f(1), f(4), f(9)], [m(1, NOW + 60_000)], NOW);
    expect(d).toHaveLength(1);
    expect(d[0].teams).toEqual([1, 4]);
    expect(dueNow([f(1, "c1"), f(1, "c2")], [m(1, NOW + 60_000)], NOW).map((x) => x.channel)).toEqual(["c1", "c2"]);
  });

  it("the post leads with the team: when it plays, or how it did", () => {
    const [r] = dueNow([f(1)], [m(1, NOW + 60_000)], NOW);
    expect(postEmbed(r, "Austin Qualifier", "https://controlscout.org").description).toMatch(/^\*\*1\*\* plays <t:\d+:R>/);
    const [res] = dueNow([f(3)], [m(1, NOW - 60_000, true)], NOW);
    expect(postEmbed(res, "Austin Qualifier", "https://controlscout.org").description).toBe("**3** lost Q1.");
  });
});

describe("follows and the tick, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    const today = iso(NOW).slice(0, 10);
    await run("INSERT INTO teams (number, name) VALUES (18360, 'Gear Grinders'), (4215, 'Alpha'), (16379, 'Beta'), (21058, 'Gamma')");
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 18360), (?, 4215)", [S, S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'USTXAUQ', 'Austin Qualifier', 'Qualifier', ?, ?, 'UTC', 0, 0, 'test')", [S, today, today]);
    const at = iso(NOW + 10 * 60_000).slice(0, 19);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'USTXAUQ', 'qual', 0, 7, 'Q7', ?, 0, 'test')", [S, at]);
    for (const [i, t] of [18360, 4215, 16379, 21058].entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, 'USTXAUQ', 'qual', 0, 7, ?, ?, ?)", [S, t, i < 2 ? "red" : "blue", (i % 2) + 1]);
    await kvSet("data:version", "v1");
  });
  beforeEach(async () => { await run("DELETE FROM discord_follows"); await run("DELETE FROM discord_posts"); clearAllCaches(); });

  it("follow, list, unfollow; unknown teams and a full server are friendly errors", async () => {
    expect(await addFollow("g", "c1", 18360, "u", NOW - 864e5)).toBe("added");
    expect(await addFollow("g", "c1", 18360, "u")).toBe("already");
    expect(await listFollows("g")).toEqual([{ team: 18360, channel_id: "c1", name: "Gear Grinders" }]);
    await expect(addFollow("g", "c1", 99999, "u")).rejects.toBeInstanceOf(Friendly);
    expect(await removeFollow("g", 18360)).toBe(1);
    expect(await listFollows("g")).toEqual([]);
  });

  it("posts the reminder once, even across ticks and with two followed teams in the match", async () => {
    await addFollow("g", "c1", 18360, "u", NOW - 864e5);
    await addFollow("g", "c1", 4215, "u", NOW - 864e5);
    const send = vi.fn(async () => "ok" as const);
    expect(await notifyTick(send, "https://controlscout.org", () => {}, NOW)).toBe(1);
    expect(await notifyTick(send, "https://controlscout.org", () => {}, NOW + 60_000)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const [channel, embed] = send.mock.calls[0] as unknown as [string, { title: string; description: string }];
    expect(channel).toBe("c1");
    expect(embed.title).toBe("Austin Qualifier · Q7");
    expect(embed.description).toMatch(/^\*\*18360\*\* & \*\*4215\*\* play/);
  });

  it("a passing failure is tried again next tick; a channel that's gone is dropped after repeated failures", async () => {
    await addFollow("g", "c1", 18360, "u", NOW - 864e5);
    const flaky = vi.fn().mockResolvedValueOnce("error").mockResolvedValueOnce("ok");
    await notifyTick(flaky, "s", () => {}, NOW);
    expect(await notifyTick(flaky, "s", () => {}, NOW + 60_000)).toBe(1);

    await run("DELETE FROM discord_posts");
    const gone = vi.fn(async () => "gone" as const);
    for (let i = 0; i < MAX_FAILURES; i++) { await run("DELETE FROM discord_posts"); await notifyTick(gone, "s", () => {}, NOW); }
    expect(await all("SELECT * FROM discord_follows")).toEqual([]);
  });
});
