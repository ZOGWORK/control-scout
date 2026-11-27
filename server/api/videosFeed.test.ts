// The Videos feed against the real app on an in-memory database: the general feed for a stranger, a person's own
// after they follow a team, and the feed moving after they finish or skip a video. Match videos here are FIRST's own
// (matches.video), so no recording or YouTube read is involved.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { deleteUser, sha256 } from "../auth/session";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "../data/seasons";
import { cleanWatch, upsetPercent } from "./videosFeed";
import { decodeHistory, encodeHistory, type FeedAnswer } from "../../src/shared/videosFeed";

const S = CURRENT_SEASON;
let server: Server;
let base = "";
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, st] of [[1111, "NJ"], [2222, "TX"], [3333, "TX"], [4444, "CA"], [5555, "CA"], [6666, "CA"]] as const) {
    await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, ?, 'USA')", [n, `Team ${n}`, st]);
  }
  await run("INSERT INTO events (season, code, name, type, state, country, start, end, timezone, source) VALUES (?, 'USTXQ1', 'Texas Qualifier', 'Qualifier', 'TX', 'USA', ?, ?, 'UTC', 'first')", [S, day(3), day(3)]);
  await run("INSERT INTO events (season, code, name, type, state, country, start, end, timezone, source) VALUES (?, 'USCAQ1', 'California Qualifier', 'Qualifier', 'CA', 'USA', ?, ?, 'UTC', 'first')", [S, day(4), day(4)]);
  // 12 matches at each event, each with FIRST's own video. Team 1111 plays only in Texas Q1–Q3, team 2222 only in
  // California Q1–Q3. Texas Q12 is the season high; California Q12 a tie.
  let v = 0;
  for (const code of ["USTXQ1", "USCAQ1"]) {
    for (let m = 1; m <= 12; m++) {
      const red = code === "USTXQ1" && m === 12 ? 400 : 100 + m, blue = code === "USCAQ1" && m === 12 ? red : 60 + m;
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, video, source)
        VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, 't')`, [S, code, m, `Q${m}`, `${day(code === "USTXQ1" ? 3 : 4)}T${String(8 + Math.floor(m / 2)).padStart(2, "0")}:00:00`, red, red, blue, blue, `https://www.youtube.com/watch?v=${vid(++v)}`]);
      const mine = m <= 3 ? (code === "USTXQ1" ? 1111 : 2222) : 3333;
      for (const [team, alliance] of [[mine, "red"], [code === "USTXQ1" ? 4444 : 5555, "red"], [6666, "blue"]] as const) {
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [S, code, m, team, alliance]);
      }
    }
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(() => { clearAllCaches(); });

let n = 0;
async function account(state: { myTeam?: number | null; tracked?: number[] } = {}) {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [`feed${++n}@example.test`, new Date().toISOString()]);
  const id = Number(u!.id);
  const t = `tok-feed-${n}-${Math.random()}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  if (state.myTeam !== undefined) await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'myTeam', ?, ?)", [id, JSON.stringify(state.myTeam), Date.now()]);
  if (state.tracked) await follow(id, state.tracked);
  return { id, cookie: `cs_session=${t}` };
}
const follow = (id: number, teams: number[]) => run(`INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'tracked', ?, ?)
  ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [id, JSON.stringify({ teams, events: [] }), Date.now()]);
const feed = async (q = "", cookie?: string): Promise<FeedAnswer> => {
  const r = await fetch(`${base}/api/videos/feed${q}`, { headers: { "X-CS-Test": "1", ...(cookie ? { cookie } : {}) } });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  return r.json();
};
const watch = (body: unknown, cookie?: string) => fetch(`${base}/api/videos/watch`, { method: "POST", headers: { "content-type": "application/json", "X-CS-Test": "1", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const all3 = async (cookie?: string, q = "") => {
  const out: FeedAnswer["items"] = [];
  let cursor: string | null = "";
  while (cursor != null) {
    const a = await feed(`?${new URLSearchParams({ ...(q ? Object.fromEntries(new URLSearchParams(q)) : {}), ...(cursor ? { cursor } : {}) })}`, cookie);
    out.push(...a.items);
    cursor = a.next;
  }
  return out;
};

describe("GET /api/videos/feed", () => {
  it("gives a stranger the general feed: top plays first, every item with a reason and a video", async () => {
    const a = await feed();
    expect(a.coldStart).toBe(true);
    expect(a.items.length).toBe(12);
    expect(a.items[0].title).toContain("400");
    expect(a.items[0].reason).toBe("Season high: 400 without penalties");
    // No pool fills more than 3 in a row while another has items.
    const whole = await all3();
    for (let i = 3; i < whole.length; i++) {
      const run = new Set(whole.slice(i - 3, i + 1).map((x) => x.source)).size === 1;
      if (run) expect(whole.slice(i).every((x) => x.source === whole[i].source)).toBe(true);
    }
    for (const i of a.items) { expect(i.reason).toBeTruthy(); expect(i.videoId).toMatch(/^vid\d{8}$/); expect(i.kind).toBe("match"); }
    // A match in several pools says its most telling reason: the tie is a close finish, not a top score.
    expect((await all3()).filter((i) => i.reason === "Ended in a tie").map((i) => i.title)).toEqual(["Q12: 3333 & 5555 vs 6666 · 112–112"]);
  });

  it("pages by cursor through every item once", async () => {
    const items = await all3();
    expect(items.length).toBeGreaterThan(12);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("never has 3 in a row from one event", async () => {
    const items = await all3();
    for (let i = 2; i < items.length; i++) {
      const g = (x: (typeof items)[number]) => x.event?.code;
      if (g(items[i]) === g(items[i - 1]) && g(items[i]) === g(items[i - 2])) expect(items.slice(i).every((x) => g(x) === g(items[i]))).toBe(true);
    }
  });

  it("puts a signed-out device's own team first, from what it sends", async () => {
    const a = await feed("?my=1111");
    expect(a.coldStart).toBe(false);
    expect(a.items[0].reason).toBe("Your team, 1111");
    expect(a.items[0].personal).toBe(true);
    expect(a.items.filter((i) => !i.teams.includes(1111)).every((i) => !i.personal)).toBe(true);
    expect(a.items[0].teams).toContain(1111);
  });

  it("changes after a signed-in person follows a team", async () => {
    const me = await account();
    const before = await feed("", me.cookie);
    expect(before.coldStart).toBe(true);
    await follow(me.id, [2222]);
    const after = await feed("", me.cookie);
    expect(after.coldStart).toBe(false);
    expect(after.items[0].teams).toContain(2222);
    expect(after.items[0].reason).toBe("You follow 2222");
    expect(after.items.map((i) => i.key)).not.toEqual(before.items.map((i) => i.key));
    const mine = await feed("?filter=myTeams", me.cookie);
    expect(mine.items.length).toBe(3);
    expect(mine.items.every((i) => i.teams.includes(2222))).toBe(true);
  });

  it("drops what the person isn't interested in and sinks what they finished", async () => {
    const me = await account({ tracked: [1111] });
    const first = (await feed("", me.cookie)).items;
    const [top, second] = first;
    expect((await watch({ key: top.key, kind: "match", watchedS: 5, hidden: true }, me.cookie)).status).toBe(200);
    expect((await watch({ key: second.key, kind: "match", watchedS: 40, completed: true }, me.cookie)).status).toBe(200);
    const after = await all3(me.cookie);
    expect(after.some((i) => i.key === top.key)).toBe(false);
    expect(after.findIndex((i) => i.key === second.key)).toBeGreaterThan(1);
    const rows = await all<{ item_key: string; watched_s: number; completed: number; hidden: number }>("SELECT item_key, watched_s, completed, hidden FROM video_watch WHERE user_id = ? ORDER BY item_key", [me.id]);
    expect(rows.length).toBe(2);
    // A later, shorter report never takes back a finish or a "not interested".
    await watch({ key: second.key, kind: "match", watchedS: 5 }, me.cookie);
    expect(await get("SELECT watched_s, completed FROM video_watch WHERE user_id = ? AND item_key = ?", [me.id, second.key])).toEqual({ watched_s: 40, completed: 1 });
  });

  it("never pages one signed-out device through another's list, even with the same teams", async () => {
    // Device A's first page; then device B (same follows, nothing hidden) builds its own; A's next page is still A's.
    const a1 = await feed("?my=1111");
    const hidden = a1.items[0].key;
    const aHist = encodeURIComponent(encodeHistory([{ key: hidden, state: "x" }]));
    const a1h = await feed(`?my=1111&h=${aHist}`);
    expect(a1h.items.some((i) => i.key === hidden)).toBe(false);
    const b1 = await feed("?my=1111");
    expect(b1.next).not.toBe(a1h.next);
    const a2 = await feed(`?my=1111&h=${aHist}&cursor=${a1h.next}`);
    expect(a2.items.some((i) => i.key === hidden)).toBe(false);
    expect(a2.items.some((i) => a1h.items.some((x) => x.key === i.key))).toBe(false);
    // A cursor for a list that's gone starts a fresh one rather than failing.
    const stale = await feed(`?my=1111&cursor=zzzzzzzzzzzz.12`);
    expect(stale.items.length).toBeGreaterThan(0);
  });

  it("does the same for a signed-out device's own history", async () => {
    const first = (await feed("?my=1111")).items;
    const h = encodeHistory([{ key: first[0].key, state: "x" }]);
    const after = await all3(undefined, `my=1111&h=${encodeURIComponent(h)}`);
    expect(after.some((i) => i.key === first[0].key)).toBe(false);
  });

  it("refuses an unknown filter or cursor", async () => {
    expect((await fetch(`${base}/api/videos/feed?filter=nope`, { headers: { "X-CS-Test": "1" } })).status).toBe(400);
    expect((await fetch(`${base}/api/videos/feed?cursor=abc`, { headers: { "X-CS-Test": "1" } })).status).toBe(400);
    expect((await fetch(`${base}/api/videos/feed?cursor=12`, { headers: { "X-CS-Test": "1" } })).status).toBe(400);
  });

  it("says so when a filter has nothing, and reads FTC creator videos with their tagged teams", async () => {
    const none = await feed("?filter=behindTheBot");
    expect(none.items).toEqual([]);
    expect(none.empty).toBe("No Behind the Bot episodes yet.");
    // Rows as the intake (migration 114, server/videos/creatorVideos.ts) writes them; an FRC one and one that can't be
    // embedded stay out.
    const now = new Date().toISOString();
    await run("INSERT INTO creator_channels (channel_id, title, uploads_playlist, added_at) VALUES ('UCfun', 'FUN Robotics Network', 'UUfun', ?)", [now]);
    const vid = (id: string, title: string, series: string | null, program: string, embeddable: number) => run(
      "INSERT INTO creator_videos (video_id, channel_id, title, published_at, duration_s, series, program, embeddable, last_refreshed) VALUES (?, 'UCfun', ?, ?, 900, ?, ?, ?, ?)", [id, title, now, series, program, embeddable, now]);
    await vid("btb00000001", "Behind the Bot: 1111", "behind-the-bot", "ftc", 1);
    await vid("frc00000001", "An FRC robot", null, "frc", 1);
    await vid("noembed0001", "Pits and Parts", "pits-and-parts", "ftc", 0);
    await run("INSERT INTO video_team_tags (video_id, team_number, rule) VALUES ('btb00000001', 1111, 'title:cue')");
    clearAllCaches();
    const btb = await feed("?filter=behindTheBot&my=1111");
    expect(btb.items.map((i) => [i.key, i.kind, i.reason, i.teams])).toEqual([["c:btb00000001", "creator", "Features your team, 1111", [1111]]]);
    const creators = (await feed("?filter=creators")).items;
    expect(creators.map((i) => [i.key, i.channel])).toEqual([["c:btb00000001", "FUN Robotics Network"]]);
    for (const t of ["video_team_tags", "creator_videos", "creator_channels"]) await run(`DELETE FROM ${t}`);
  });
});

describe("POST /api/videos/watch", () => {
  it("is for a signed-in account only, and checks what it's sent", async () => {
    expect((await watch({ key: "m:2025:X:qual:0:1", kind: "match", watchedS: 5 })).status).toBe(401);
    const me = await account();
    expect((await watch({ key: "../etc", kind: "match", watchedS: 5 }, me.cookie)).status).toBe(400);
    expect((await watch({ key: "m:2025:X:qual:0:1", kind: "other", watchedS: 5 }, me.cookie)).status).toBe(400);
    const r = await fetch(`${base}/api/videos/watch`, { method: "POST", headers: { "content-type": "text/plain", "X-CS-Test": "1", cookie: me.cookie }, body: "x" });
    expect(r.status).toBe(415);
  });

  it("keeps \"show more like this\" once said, without counting the card as seen", async () => {
    const me = await account();
    expect((await watch({ key: "c:vid00000099", kind: "behindTheBot", watchedS: 0, more: true }, me.cookie)).status).toBe(200);
    await watch({ key: "c:vid00000099", kind: "behindTheBot", watchedS: 5 }, me.cookie);
    expect(await get("SELECT watched_s, completed, hidden, more FROM video_watch WHERE user_id = ? AND item_key = 'c:vid00000099'", [me.id])).toEqual({ watched_s: 5, completed: 0, hidden: 0, more: 1 });
  });

  it("is deleted with the account", async () => {
    const me = await account();
    await watch({ key: "m:2025:X:qual:0:1", kind: "match", watchedS: 5 }, me.cookie);
    expect((await all("SELECT 1 FROM video_watch WHERE user_id = ?", [me.id])).length).toBe(1);
    await deleteUser(me.id);
    expect((await all("SELECT 1 FROM video_watch WHERE user_id = ?", [me.id])).length).toBe(0);
  });
});

describe("helpers", () => {
  it("cleanWatch caps and rounds the second, and keeps only true flags", () => {
    expect(cleanWatch({ key: "c:abc", kind: "creator", watchedS: 12.6, completed: "yes" })).toEqual({ key: "c:abc", kind: "creator", watchedS: 13, completed: false, hidden: false, more: false });
    expect(cleanWatch({ key: "c:abc", kind: "creator", watchedS: 0, more: true })?.more).toBe(true);
    expect(cleanWatch({ key: "c:abc", kind: "creator", watchedS: -1 })).toBeNull();
  });
  it("history round-trips, drops bad entries and keeps each key once", () => {
    const h = encodeHistory([{ key: "m:2025:A:qual:0:1", state: "d" }, { key: "bad key", state: "x" }]);
    expect(decodeHistory(`${h},m:2025:A:qual:0:1~x,c:z~q`)).toEqual([{ key: "m:2025:A:qual:0:1", state: "d" }]);
  });
  it("an upset's percent is never 0 or 100", () => {
    expect(upsetPercent(0.999, false)).toBe(1);
    expect(upsetPercent(0.001, false)).toBe(99);
    expect(upsetPercent(0.2, true)).toBe(20);
  });
});
