// Automatic posts for followed teams: what's due when, one post per channel and match (restarts and two
// followed teams in a match included), a channel that's gone is dropped, a passing failure is retried.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, kvSet, migrate, openDb, run, setDb } from "../server/db";
import { clearAllCaches } from "../server/caches";
import { setFlag } from "../server/flags";
import { CURRENT_SEASON as S } from "../server/data/seasons";
import type { EventDetail, MatchView } from "../src/shared/api";
import { MAX_FAILURES, REMIND_MS, addFollow, dueNow, listFollows, nextMatch, notifyTick, postEmbed, removeFollow, type Follow } from "./follows";
import { setGuildSettings } from "./settings";
import { loadEventState } from "./eventChanges";
import { Friendly, PRIDE, embedBlocks } from "./views";

const NOW = Date.parse("2026-10-24T15:00:00Z");
/** These tests are about the per-match posts: the event's schedule post (bot/eventAlerts.ts) counts as already sent. */
async function clearPosts() {
  await run("DELETE FROM discord_posts");
  for (const team of [18360, 4215]) await run("INSERT INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at, sent_at) VALUES ('c1', ?, 'USTXAUQ', ?, 'schedule', ?, ?)", [S, `schedule:${team}`, iso(NOW), iso(NOW)]);
}
const iso = (ms: number) => new Date(ms).toISOString();
/** The tick's count of posts sent, which is what these tests assert on (it also reports failed sends). */
const sent = async (...a: Parameters<typeof notifyTick>) => (await notifyTick(...a)).posted;

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

  it("a match marked played before its scores are posted waits: no result (never a tie at 0) until both are in", () => {
    const unscored = { ...m(1, NOW - 600_000, true), red: { ...m(1, NOW, true).red, score: null } };
    expect(dueNow([f(3)], [unscored], NOW)).toEqual([]);
    expect(dueNow([f(3)], [{ ...unscored, blue: { ...unscored.blue, score: null } }], NOW)).toEqual([]);
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
    // Its end is well ahead, so the event isn't finished by the real clock when a test's `now` is in the past (the
    // event's status comes from today's date, bot/eventAlerts.ts): its schedule post is due.
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'USTXAUQ', 'Austin Qualifier', 'Qualifier', ?, '2027-06-30', 'UTC', 0, 0, 'test')", [S, today]);
    const at = iso(NOW + 10 * 60_000).slice(0, 19);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'USTXAUQ', 'qual', 0, 7, 'Q7', ?, 0, 'test')", [S, at]);
    for (const [i, t] of [18360, 4215, 16379, 21058].entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, 'USTXAUQ', 'qual', 0, 7, ?, ?, ?)", [S, t, i < 2 ? "red" : "blue", (i % 2) + 1]);
    await kvSet("data:version", "v1");
  });
  beforeEach(async () => {
    await run("DELETE FROM discord_follows");
    await run("DELETE FROM discord_match_state");
    await run("DELETE FROM discord_event_state");
    await run("DELETE FROM discord_guild_settings");
    await clearPosts();
    clearAllCaches();
  });

  it("follow, list, unfollow; unknown teams and a full server are friendly errors", async () => {
    expect(await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5)).toBe("added");
    expect(await addFollow("g", "c1", { kind: "team", team: 18360 }, "u")).toBe("already");
    expect(await listFollows("g", NOW)).toMatchObject([{ kind: "team", team: 18360, event: null, channel_id: "c1", name: "Gear Grinders", stopped: false }]);
    // And its next post is there: the reminder for Q7, ten minutes out.
    // Its moment is the match's start less the reminder (the fixture's time is venue-local, so only the shape is
    // asserted here; the exact instant is the match's own).
    expect((await listFollows("g", NOW))[0].next).toMatchObject({ what: "reminder" });
    expect(Number((await listFollows("g", NOW))[0].next?.at)).toBeGreaterThan(0);
    await expect(addFollow("g", "c1", { kind: "team", team: 99999 }, "u")).rejects.toBeInstanceOf(Friendly);
    expect(await removeFollow("g", { kind: "team", team: 18360 })).toBe(1);
    expect(await listFollows("g")).toEqual([]);
  });

  it("an event can be followed instead of a team: listed as the event, posted once its schedule is up, and unfollowed by code", async () => {
    expect(await addFollow("g", "c1", { kind: "event", event: "USTXAUQ" }, "u", NOW - 864e5)).toBe("added");
    expect(await addFollow("g", "c1", { kind: "event", event: "USTXAUQ" }, "u")).toBe("already");
    expect(await listFollows("g", NOW)).toMatchObject([{ kind: "event", team: null, event: "USTXAUQ", channel_id: "c1", name: null, stopped: false }]);
    expect((await listFollows("g", NOW))[0].next).toEqual({ at: null, what: "a recap after the day's last match" });
    await expect(addFollow("g", "c1", { kind: "event", event: "NOPE" }, "u")).rejects.toBeInstanceOf(Friendly);
    const send = vi.fn(async () => "ok" as const);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(1);
    const [channel, embed] = send.mock.calls[0] as unknown as [string, { title: string; fields?: { name: string }[] }];
    expect(channel).toBe("c1");
    expect(embed.title).toBe("Schedule posted: Austin Qualifier");
    expect(embed.fields!.length).toBe(1);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW + 60_000)).toBe(0);
    expect(await removeFollow("g", { kind: "event", event: "USTXAUQ" })).toBe(1);
  });

  it("posts a meet's schedule as soon as FIRST posts it, even weeks before the event", async () => {
    // A window around today held the schedule post back until the event was nearly here — and an event with no date
    // published at all never posted one. Both are the same read, so it is no longer windowed.
    const start = iso(NOW + 30 * 864e5).slice(0, 10);
    // Its end is far ahead so the real clock doesn't call it finished (as USTXAUQ's is): the start is what makes it weeks out.
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'FAROUT', 'Far Out Qualifier', 'Qualifier', ?, '2027-06-30', 'UTC', 0, 0, 'test')", [S, start]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'FAROUT', 18360)", [S]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'FAROUT', 'qual', 0, 1, 'Q1', ?, 0, 'test')", [S, `${start}T10:00:00`]);
    for (const [i, t] of [18360, 4215].entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, 'FAROUT', 'qual', 0, 1, ?, ?, ?)", [S, t, i % 2 ? "blue" : "red", (i % 2) + 1]);
    clearAllCaches();
    try {
      expect(await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5)).toBe("added");
      const send = vi.fn(async () => "ok" as const);
      expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBeGreaterThan(0);
      const titles = (send.mock.calls as unknown as [string, { title: string }][]).map(([, e]) => e.title);
      expect(titles).toContain("Schedule posted: Far Out Qualifier");
    } finally {
      await run("DELETE FROM match_teams WHERE season = ? AND code = 'FAROUT'", [S]);
      await run("DELETE FROM matches WHERE season = ? AND code = 'FAROUT'", [S]);
      await run("DELETE FROM event_teams WHERE season = ? AND code = 'FAROUT'", [S]);
      await run("DELETE FROM events WHERE season = ? AND code = 'FAROUT'", [S]);
      await run("DELETE FROM discord_follows");
      await run("DELETE FROM discord_posts");
      clearAllCaches();
    }
  });

  it("an event follow belongs to the season it was made in, and is moved to this season's event once", async () => {
    expect(await addFollow("g", "c1", { kind: "event", event: "USTXAUQ" }, "u", NOW - 864e5)).toBe("added");
    // The row as a season rollover leaves it: the code exists this season too, and the follow is last season's.
    await run("UPDATE discord_follows SET season = season - 1 WHERE guild_id = 'g'");
    const send = vi.fn(async () => "ok" as const);
    // It never posts last season's event silently: the channel is told once, and the follow moves to this season's.
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(1);
    const [channel, embed] = send.mock.calls[0] as unknown as [string, { title: string; description: string }];
    expect(channel).toBe("c1");
    expect(embed.title).toBe("Following Austin Qualifier again");
    expect(embed.description).toContain("this season's Austin Qualifier");
    expect((await all<{ season: number }>("SELECT season FROM discord_follows"))[0].season).toBe(S);
    // From then on it is this season's follow: the schedule posts on the next tick, and the notice never repeats.
    expect(await sent(send, "https://controlscout.org", () => {}, NOW + 60_000)).toBe(1);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW + 120_000)).toBe(0);
  });

  it("waits out quiet hours before telling a channel its event follow moved to this season", async () => {
    expect(await addFollow("g", "c1", { kind: "event", event: "USTXAUQ" }, "u", NOW - 864e5)).toBe("added");
    await run("UPDATE discord_follows SET season = season - 1 WHERE guild_id = 'g'");
    const h = new Date(NOW).getUTCHours();
    await setGuildSettings("g", { quiet: { start: h, end: (h + 2) % 24 }, reminders: true, pingRole: null }, "u", NOW);
    const send = vi.fn(async () => "ok" as const);
    // Quiet hours: nothing posts, and the follow keeps last season's row so the notice isn't lost.
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect((await all<{ season: number }>("SELECT season FROM discord_follows"))[0].season).toBe(S - 1);
    // Out of them the notice is the first thing the channel hears, and the follow moves to this season's event.
    await setGuildSettings("g", { quiet: null, reminders: true, pingRole: null }, "u", NOW);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(1);
    expect(((send.mock.calls[0] as unknown[])[1] as { title: string }).title).toBe("Following Austin Qualifier again");
    expect((await all<{ season: number }>("SELECT season FROM discord_follows"))[0].season).toBe(S);
  });

  it("keeps the dates it was told about when a moved meet's alert can't be sent, and tells it on the next tick", async () => {
    expect(await addFollow("g", "c1", { kind: "event", event: "USTXAUQ" }, "u", NOW - 864e5)).toBe("added");
    const send = vi.fn(async () => "ok" as const);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(1); // the schedule post, and the dates recorded
    await run("UPDATE events SET end = '2027-07-01' WHERE season = ? AND code = 'USTXAUQ'", [S]);
    clearAllCaches();
    // The alert can't be sent: the event keeps the dates the channel was told about, so the move isn't lost.
    await sent(vi.fn(async () => "error" as const), "https://controlscout.org", () => {}, NOW + 60_000);
    expect((await loadEventState(S, "USTXAUQ"))?.end).toBe("2027-06-30");
    const retry = vi.fn(async () => "ok" as const);
    expect(await sent(retry, "https://controlscout.org", () => {}, NOW + 60_000)).toBeGreaterThan(0);
    expect(retry.mock.calls.some((c) => ((c as unknown[])[1] as { title?: string }).title === "Dates changed: Austin Qualifier")).toBe(true);
    expect((await loadEventState(S, "USTXAUQ"))?.end).toBe("2027-07-01");
    // Put the fixture's dates back for the tests after this one.
    await run("UPDATE events SET end = '2027-06-30' WHERE season = ? AND code = 'USTXAUQ'", [S]);
    clearAllCaches();
  });

  it("posts the reminder once, even across ticks and with two followed teams in the match", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    await addFollow("g", "c1", { kind: "team", team: 4215 }, "u", NOW - 864e5);
    const send = vi.fn(async () => "ok" as const);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW)).toBe(1);
    expect(await sent(send, "https://controlscout.org", () => {}, NOW + 60_000)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const [channel, embed] = send.mock.calls[0] as unknown as [string, { title: string; description: string; color: number }];
    expect(channel).toBe("c1");
    expect(embed.title).toBe("Q7 · Austin Qualifier");
    expect(PRIDE).toContain((embed as { color?: number }).color); // sent with a pride-flag border
    // One post naming both followed teams (here on one alliance: named together, with its side).
    expect(embed.description.split("\n")[0]).toMatch(/^\[18360\]\(.*\) & \[4215\]\(.*\) on (Red|Blue), <t:\d+:R>/);
  });

  it("posts a moved match once, after the schedule changes, and nothing on the tick after", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    const send = vi.fn(async () => "ok" as const);
    expect(await sent(send, "s", () => {}, NOW)).toBe(1); // the reminder, and the schedule recorded
    await clearPosts();
    // FIRST moves Q7 back forty minutes.
    await run("UPDATE matches SET time = ? WHERE season = ? AND code = 'USTXAUQ' AND level = 'qual' AND series = 0 AND number = 7", [iso(NOW + 50 * 60_000).slice(0, 19), S]);
    clearAllCaches();
    // A failed post releases its claim and keeps the old schedule, so the next tick tries the move again.
    expect(await sent(vi.fn(async () => "error" as const), "s", () => {}, NOW + 60_000)).toBe(0);
    expect(await sent(send, "s", () => {}, NOW + 60_000)).toBe(1);
    const [, moved] = send.mock.calls.at(-1) as unknown as [string, { description: string }];
    expect(moved.description.split("\n")[0]).toMatch(/^Moved: it was <t:\d+:t>, now <t:\d+:R>/);
    // Once: the next tick sees the new time as the state.
    expect(await sent(send, "s", () => {}, NOW + 120_000)).toBe(0);
    // Put the fixture's schedule back: the tests after this one expect Q7 ten minutes out.
    await run("UPDATE matches SET time = ? WHERE season = ? AND code = 'USTXAUQ' AND level = 'qual' AND series = 0 AND number = 7", [iso(NOW + 10 * 60_000).slice(0, 19), S]);
    clearAllCaches();
  });

  it("turned off by the owner (the discordBot toggle): nothing is posted and every follow is kept; back on, the post goes", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    const send = vi.fn(async () => "ok" as const);
    await setFlag("discordBot", false, "owner@example.com");
    try {
      expect(await sent(send, "s", () => {}, NOW)).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(await listFollows("g", NOW)).toMatchObject([{ kind: "team", team: 18360, event: null, channel_id: "c1", name: "Gear Grinders", stopped: false }]);
    } finally { await setFlag("discordBot", true, "owner@example.com"); }
    expect(await sent(send, "s", () => {}, NOW)).toBe(1);
  });

  it("a passing failure is tried again next tick; a channel that's gone stops the follow after repeated failures, and tells its creator", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    const flaky = vi.fn().mockResolvedValueOnce("error").mockResolvedValueOnce("ok");
    await sent(flaky, "s", () => {}, NOW);
    expect(await sent(flaky, "s", () => {}, NOW + 60_000)).toBe(1);

    await clearPosts();
    const gone = vi.fn(async () => "gone" as const);
    const dm = vi.fn(async (_user: string, _text: string) => {});
    for (let i = 0; i < MAX_FAILURES; i++) { await clearPosts(); await sent(gone, "s", () => {}, NOW, dm); }
    const [row] = await all<{ dropped_at: string | null; drop_reason: string | null }>("SELECT dropped_at, drop_reason FROM discord_follows");
    // Kept, with why: the server can see it stopped, and following again revives it.
    expect(row.dropped_at).toBe(iso(NOW));
    expect(row.drop_reason).toMatch(/channel refused posts/);
    expect(dm).toHaveBeenCalledTimes(1);
    expect(dm.mock.calls[0][0]).toBe("u");
    // A stopped follow is never ticked again, even when its channel comes back.
    await clearPosts();
    expect(await sent(vi.fn(async () => "ok" as const), "s", () => {}, NOW)).toBe(0);
    expect(await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW)).toBe("added");
    expect((await all<{ dropped_at: string | null }>("SELECT dropped_at FROM discord_follows"))[0].dropped_at).toBeNull();
  });

  it("only the follow that reached the limit is stopped and DMed; a newer follow in the same channel keeps running", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    await addFollow("g", "c1", { kind: "team", team: 4215 }, "u2", NOW - 864e5);
    // One more refused post takes 18360 over; 4215 has none and only picks up this tick's few.
    await run("UPDATE discord_follows SET failures = ? WHERE team = 18360", [MAX_FAILURES - 1]);
    const dm = vi.fn(async (_user: string, _text: string) => {});
    await clearPosts();
    await sent(vi.fn(async () => "gone" as const), "s", () => {}, NOW, dm);
    const rows = await all<{ team: number; dropped_at: string | null }>("SELECT team, dropped_at FROM discord_follows ORDER BY team");
    expect(rows.find((r) => r.team === 18360)!.dropped_at).toBe(iso(NOW));
    expect(rows.find((r) => r.team === 4215)!.dropped_at).toBeNull();
    expect(dm).toHaveBeenCalledTimes(1);
    expect(dm.mock.calls[0][0]).toBe("u");
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
    const tries = Array.from({ length: 11 }, (_, i) => addFollow("g2", `c${i}`, { kind: "team", team: 4215 }, "u").catch((e) => e));
    const results = await Promise.all(tries);
    expect(results.filter((r) => r === "added")).toHaveLength(10);
    expect(results.filter((r) => r instanceof Friendly)).toHaveLength(1);
    expect((await all("SELECT * FROM discord_follows WHERE guild_id = 'g2'")).length).toBe(10);
  });

  it("a claim the bot never sent (it stopped mid-send) is posted once it's stale; a channel that was gone gets it once it's back", async () => {
    await addFollow("g", "c1", { kind: "team", team: 18360 }, "u", NOW - 864e5);
    // A stopped bot left a claim without sent_at.
    await run("INSERT INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at) VALUES ('c1', ?, 'USTXAUQ', 'qual:0:7', 'reminder', ?)", [S, iso(NOW - 5 * 60_000)]);
    const ok = vi.fn(async () => "ok" as const);
    expect(await sent(ok, "s", () => {}, NOW)).toBe(1);
    expect(await sent(ok, "s", () => {}, NOW + 30_000)).toBe(0); // now marked sent

    await clearPosts();
    const gone = vi.fn(async () => "gone" as const);
    await sent(gone, "s", () => {}, NOW);
    expect(await sent(ok, "s", () => {}, NOW + 60_000)).toBe(1); // access restored: retried while still due
  });
});
