// Automatic posts for followed teams: what's due when, one post per channel and match (restarts and two
// followed teams in a match included), a channel that's gone is dropped, a passing failure is retried.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, kvSet, migrate, openDb, run, setDb } from "../server/db";
import { clearAllCaches } from "../server/caches";
import { setFlag } from "../server/flags";
import { CURRENT_SEASON as S } from "../server/data/seasons";
import type { EventDetail, MatchView } from "../src/shared/api";
import { MAX_FAILURES, REMIND_MS, addFollow, dueNow, listFollows, nextMatch, notifyTick, postEmbed, removeFollow, type Follow } from "./follows";
import { Friendly, PRIDE, embedBlocks } from "./views";

const NOW = Date.parse("2026-10-24T15:00:00Z");
/** These tests are about the per-match posts: the event's schedule post (bot/eventAlerts.ts) counts as already sent. */
async function clearPosts() {
  await run("DELETE FROM discord_posts");
  for (const team of [18360, 4215]) await run("INSERT INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at, sent_at) VALUES ('c1', ?, 'USTXAUQ', ?, 'schedule', ?, ?)", [S, `schedule:${team}`, iso(NOW), iso(NOW)]);
}
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

  const SITE = "https://controlscout.org";
  const L = (n: number) => `[${n}](${SITE}/teams/${n})`;
  const ev = (matches: MatchView[]) => ({ event: { name: "Austin Qualifier" }, matches }) as unknown as Pick<EventDetail, "event" | "matches">;

  it("the reminder starts with the followed team's side, partner and time; 3 blocks, no fields", () => {
    const match = m(1, NOW + 60_000);
    const [r] = dueNow([f(3)], [match], NOW);
    const e = postEmbed(r, ev([match]), SITE);
    const at = Math.floor((NOW + 60_000) / 1000);
    expect(e.description!.split("\n")[0]).toBe(`${L(3)} on Blue with ${L(4)}, <t:${at}:R> (<t:${at}:t>).`);
    expect(e.description!.split("\n")[1]).toBe(`🔴 ${L(1)} & ${L(2)} vs ${L(3)} & ${L(4)} 🔵 · Red 60% to win · predicted 50–40 · fair`);
    expect(e.fields).toBeUndefined();
    expect(embedBlocks(e)).toBe(3);
    // Two followed teams on opposite sides: both named, each with its side.
    const [both] = dueNow([f(1), f(4)], [match], NOW);
    expect(postEmbed(both, ev([match]), SITE).description!.split("\n")[0]).toBe(`${L(1)} on Red with ${L(2)}; ${L(4)} on Blue with ${L(3)}, <t:${at}:R> (<t:${at}:t>).`);
  });

  it("the result tells the outcome once and names the next match only when there is one", () => {
    const done = m(1, NOW - 60_000, true), next = m(5, NOW + 3_600_000), later = m(9, NOW + 7_200_000);
    const [res] = dueNow([f(3)], [done], NOW);
    const e = postEmbed(res, ev([done, later, next]), SITE);
    const lines = e.description!.split("\n");
    expect(lines[0]).toBe(`🔴 ${L(1)} & ${L(2)} **50** – 40 ${L(3)} & ${L(4)} 🔵`);
    expect(lines[1]).toBe("Called it ✅ — Red 60% (predicted 50–40), won by 10.");
    expect(lines[2]).toBe(`Next: Q5 · <t:${Math.floor((NOW + 3_600_000) / 1000)}:t> · [Match](${SITE}/events/${S}/X/match/qual:0:5) · [Event](${SITE}/events/${S}/X)`);
    expect(e.description!.match(/won|lost/g)).toHaveLength(1);
    // No next match: no Next line, just the event link.
    expect(postEmbed(res, ev([done]), SITE).description!.split("\n")[2]).toBe(`[Event](${SITE}/events/${S}/X)`);
    expect(embedBlocks(e)).toBeLessThanOrEqual(4);
  });

  it("nextMatch: the earliest unplayed one with a followed team, never a played or an earlier one", () => {
    const done = m(4, NOW, true);
    expect(nextMatch([m(2, NOW - 600_000), m(6, NOW + 900_000, true), m(8, NOW + 1_800_000), m(7, NOW + 1_200_000)], done, [1])?.match.label).toBe("Q7");
    expect(nextMatch([m(2, NOW - 600_000)], done, [1])).toBeNull();
    expect(nextMatch([m(7, NOW + 1_200_000)], done, [1, 3])?.team).toBe(1);
  });

  it("nextMatch: a next match with no posted time still counts, and its line goes without a time", () => {
    const done = m(4, NOW - 60_000, true);
    const tba = { ...m(9, NOW), startsAt: null };
    expect(nextMatch([tba], done, [1])?.match.label).toBe("Q9");
    const [res] = dueNow([f(1)], [done], NOW);
    expect(postEmbed(res, ev([done, tba]), SITE).description!.split("\n")[2]).toBe(`Next: Q9 · [Match](${SITE}/events/${S}/X/match/qual:0:9) · [Event](${SITE}/events/${S}/X)`);
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
  beforeEach(async () => { await run("DELETE FROM discord_follows"); await clearPosts(); clearAllCaches(); });

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
    const [channel, embed] = send.mock.calls[0] as unknown as [string, { title: string; description: string; color: number }];
    expect(channel).toBe("c1");
    expect(embed.title).toBe("Q7 · Austin Qualifier");
    expect(PRIDE).toContain((embed as { color?: number }).color); // sent with a pride-flag border
    // One post naming both followed teams (here on one alliance: named together, with its side).
    expect(embed.description.split("\n")[0]).toMatch(/^\[18360\]\(.*\) & \[4215\]\(.*\) on (Red|Blue), <t:\d+:R>/);
  });

  it("turned off by the owner (the discordBot toggle): nothing is posted and every follow is kept; back on, the post goes", async () => {
    await addFollow("g", "c1", 18360, "u", NOW - 864e5);
    const send = vi.fn(async () => "ok" as const);
    await setFlag("discordBot", false, "owner@example.com");
    try {
      expect(await notifyTick(send, "s", () => {}, NOW)).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(await listFollows("g")).toEqual([{ team: 18360, channel_id: "c1", name: "Gear Grinders" }]);
    } finally { await setFlag("discordBot", true, "owner@example.com"); }
    expect(await notifyTick(send, "s", () => {}, NOW)).toBe(1);
  });

  it("a passing failure is tried again next tick; a channel that's gone is dropped after repeated failures", async () => {
    await addFollow("g", "c1", 18360, "u", NOW - 864e5);
    const flaky = vi.fn().mockResolvedValueOnce("error").mockResolvedValueOnce("ok");
    await notifyTick(flaky, "s", () => {}, NOW);
    expect(await notifyTick(flaky, "s", () => {}, NOW + 60_000)).toBe(1);

    await clearPosts();
    const gone = vi.fn(async () => "gone" as const);
    for (let i = 0; i < MAX_FAILURES; i++) { await clearPosts(); await notifyTick(gone, "s", () => {}, NOW); }
    expect(await all("SELECT * FROM discord_follows")).toEqual([]);
  });
});

describe("review fixes", () => {
  const t = (n: number, onField = true) => ({ number: n, surrogate: false, dq: false, onField });
  const f = (team: number): Follow => ({ guild_id: "g", channel_id: "c1", team, created_at: iso(NOW - 864e5), failures: 0 });

  it("a followed team that sat out a played playoff match isn't named in its result", () => {
    const m: MatchView = {
      season: S, code: "X", key: "playoff:1:1", level: "playoff", series: 1, number: 1, label: "M1", time: null, startsAt: iso(NOW - 600_000), played: true,
      red: { teams: [t(1), t(2), t(5, false)], score: { total: 50, np: 50, auto: 0, teleop: 0, endgame: 0, pen: 0 } },
      blue: { teams: [t(3), t(4)], score: { total: 40, np: 40, auto: 0, teleop: 0, endgame: 0, pen: 0 } },
      video: null, prediction: null,
    };
    expect(dueNow([f(5)], [m], NOW)).toEqual([]);
    expect(dueNow([f(1)], [m], NOW)).toHaveLength(1);
  });
});

describe("review fixes, on a database", () => {
  beforeEach(async () => { await run("DELETE FROM discord_follows"); await clearPosts(); clearAllCaches(); });

  it("the 10-team limit holds, even when follows land at the same moment", async () => {
    await run("INSERT INTO teams (number, name) SELECT 100 + value, 'T' FROM json_each('[0,1,2,3,4,5,6,7,8,9,10]') WHERE 1 ON CONFLICT DO NOTHING");
    const tries = Array.from({ length: 11 }, (_, i) => addFollow("g2", `c${i}`, 4215, "u").catch((e) => e));
    const results = await Promise.all(tries);
    expect(results.filter((r) => r === "added")).toHaveLength(10);
    expect(results.filter((r) => r instanceof Friendly)).toHaveLength(1);
    expect((await all("SELECT * FROM discord_follows WHERE guild_id = 'g2'")).length).toBe(10);
  });

  it("a claim the bot never sent (it stopped mid-send) is posted once it's stale; a channel that was gone gets it once it's back", async () => {
    await addFollow("g", "c1", 18360, "u", NOW - 864e5);
    // A stopped bot left a claim without sent_at.
    await run("INSERT INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at) VALUES ('c1', ?, 'USTXAUQ', 'qual:0:7', 'reminder', ?)", [S, iso(NOW - 5 * 60_000)]);
    const ok = vi.fn(async () => "ok" as const);
    expect(await notifyTick(ok, "s", () => {}, NOW)).toBe(1);
    expect(await notifyTick(ok, "s", () => {}, NOW + 30_000)).toBe(0); // now marked sent

    await clearPosts();
    const gone = vi.fn(async () => "gone" as const);
    await notifyTick(gone, "s", () => {}, NOW);
    expect(await notifyTick(ok, "s", () => {}, NOW + 60_000)).toBe(1); // access restored: retried while still due
  });
});
