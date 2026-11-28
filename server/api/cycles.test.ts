// Cycles and video reactions against the real app on an in-memory database: only short FTC videos, never twice in one
// scroll, a shared link first, likes, reactions and shares counted, and the feed learning: a person who loves Quality
// Control's videos gets Quality Control first, and "people who loved this also loved that".
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { deleteUser, sha256 } from "../auth/session";
import { clearAllCaches } from "../caches";
import type { CyclesAnswer, Engagement } from "../../src/shared/cycles";

let server: Server;
let base = "";
const vid = (n: number) => `cyc${String(n).padStart(8, "0")}`;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const QC = 21229;
const OTHERS = [1111, 2222, 3333, 4444, 5555];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, state, country) VALUES (?, 'Quality Control', 'NJ', 'USA')", [QC]);
  for (const n of OTHERS) await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, 'TX', 'USA')", [n, `Team ${n}`]);
  await run("INSERT INTO creator_channels (channel_id, title, uploads_playlist, added_at) VALUES ('UCfun', 'FUN Robotics Network', 'UUfun', ?)", [ago(30)]);
  // 1–6: Quality Control shorts. 7–30: other teams' shorts. 31: long. 32: FRC short. 33: not embeddable. 34: 2 s.
  const add = async (n: number, o: { team?: number; dur?: number; program?: string; embeddable?: number; series?: string | null } = {}) => {
    await run(`INSERT INTO creator_videos (video_id, channel_id, title, published_at, duration_s, series, program, embeddable, last_refreshed)
      VALUES (?, 'UCfun', ?, ?, ?, ?, ?, ?, ?)`, [vid(n), `Short ${n}`, ago(n), o.dur ?? 45, o.series ?? null, o.program ?? "ftc", o.embeddable ?? 1, ago(0)]);
    if (o.team) await run("INSERT INTO video_team_tags (video_id, team_number, rule) VALUES (?, ?, 'cue')", [vid(n), o.team]);
  };
  for (let i = 1; i <= 6; i++) await add(i, { team: QC, series: i <= 3 ? "behind-the-bot" : null });
  for (let i = 7; i <= 30; i++) await add(i, { team: OTHERS[i % OTHERS.length] });
  await add(31, { team: 1111, dur: 900 });
  await add(32, { program: "frc" });
  await add(33, { embeddable: 0 });
  await add(34, { dur: 2 });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(() => { clearAllCaches(); });

let n = 0;
async function account() {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [`cyc${++n}@example.test`, new Date().toISOString()]);
  const id = Number(u!.id);
  const t = `tok-cyc-${n}-${Math.random()}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return { id, cookie: `cs_session=${t}` };
}
const headers = (cookie?: string, json = false) => ({ "X-CS-Test": "1", ...(json ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) });
const cycles = async (q = "", cookie?: string): Promise<CyclesAnswer> => {
  const r = await fetch(`${base}/api/cycles${q}`, { headers: headers(cookie) });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  return r.json();
};
const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}/api${path}`, { method: "POST", headers: headers(cookie, true), body: JSON.stringify(body) });
const scrollAll = async (cookie?: string) => {
  const out: CyclesAnswer["items"] = [];
  let cursor: string | null = null;
  do {
    const a: CyclesAnswer = await cycles(cursor ? `?cursor=${cursor}` : "", cookie);
    out.push(...a.items);
    cursor = a.next;
  } while (cursor && out.length < 200);
  return out;
};

describe("the list", () => {
  it("only short FTC videos that can play here, each once in a scroll", async () => {
    const items = await scrollAll();
    const ids = items.map((i) => i.videoId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Array.from({ length: 30 }, (_, i) => vid(i + 1)).sort());
    const qc = items.find((i) => i.videoId === vid(1))!;
    expect(qc.teams).toEqual([{ number: QC, name: "Quality Control" }]);
    expect(qc.creator.name).toBe("FUN Robotics Network");
    expect(qc.engagement).toEqual({ likes: 0, reactions: {}, shares: 0 });
  });

  it("a shared link's video comes first, even a long one", async () => {
    expect((await cycles(`?start=${vid(20)}`)).items[0].videoId).toBe(vid(20));
    expect((await cycles(`?start=${vid(31)}`)).items[0].videoId).toBe(vid(31));
    expect((await fetch(`${base}/api/cycles?start=nope`, { headers: headers() })).status).toBe(400);
    expect((await fetch(`${base}/api/cycles?cursor=nope`, { headers: headers() })).status).toBe(400);
  });

  it("never runs one team: no three of a team in a row", async () => {
    const items = await scrollAll();
    let run3 = 0, worst = 0, last = -1;
    for (const i of items) { const t = i.teams[0]?.number ?? -1; run3 = t === last ? run3 + 1 : 1; last = t; worst = Math.max(worst, run3); }
    expect(worst).toBeLessThanOrEqual(2);
  });
});

describe("likes, reactions, shares", () => {
  it("a like and a reaction need an account; a share doesn't", async () => {
    expect((await post("/videos/like", { key: `c:${vid(5)}`, on: true })).status).toBe(401);
    expect((await post("/videos/react", { key: `c:${vid(5)}`, emoji: "🔥" })).status).toBe(401);
    const r = await post("/videos/share", { key: `c:${vid(5)}` });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Engagement).shares).toBe(1);
  });

  it("counts a like once, takes it back, keeps one reaction per person, and shows each person their own", async () => {
    const a = await account(), b = await account();
    const key = `c:${vid(7)}`;
    let e: Engagement = await (await post("/videos/like", { key, on: true }, a.cookie)).json();
    expect(e).toMatchObject({ likes: 1, mine: { liked: true, reaction: null } });
    e = await (await post("/videos/like", { key, on: true }, a.cookie)).json();
    expect(e.likes).toBe(1);
    await post("/videos/react", { key, emoji: "🔥" }, a.cookie);
    e = await (await post("/videos/react", { key, emoji: "🤯" }, a.cookie)).json();
    expect(e.reactions).toEqual({ "🤯": 1 });
    e = await (await post("/videos/react", { key, emoji: "🤯" }, b.cookie)).json();
    expect(e).toMatchObject({ reactions: { "🤯": 2 }, likes: 1, mine: { liked: false, reaction: "🤯" } });
    e = await (await post("/videos/like", { key, on: false }, a.cookie)).json();
    expect(e.likes).toBe(0);
    expect((await post("/videos/react", { key, emoji: "❤️" }, a.cookie)).status).toBe(400);
    expect((await post("/videos/like", { key: "nope", on: true }, a.cookie)).status).toBe(400);
    // Shared twice in a day by one account: one share.
    await post("/videos/share", { key }, a.cookie);
    e = await (await post("/videos/share", { key }, a.cookie)).json();
    expect(e.shares).toBe(1);
    const got = await (await fetch(`${base}/api/videos/engagement?keys=${encodeURIComponent(key)}`, { headers: headers(b.cookie) })).json();
    expect(got[key]).toMatchObject({ likes: 0, reactions: { "🤯": 2 }, mine: { reaction: "🤯" } });
  });

  it("all of it goes with the account", async () => {
    const a = await account();
    await post("/videos/like", { key: `c:${vid(8)}`, on: true }, a.cookie);
    await post("/videos/react", { key: `c:${vid(8)}`, emoji: "👏" }, a.cookie);
    await post("/videos/share", { key: `c:${vid(8)}` }, a.cookie);
    await deleteUser(a.id);
    for (const t of ["video_likes", "video_reactions", "video_shares"]) expect(await all(`SELECT 1 FROM ${t} WHERE user_id = ?`, [a.id])).toEqual([]);
  });
});

describe("the feed learns", () => {
  it("someone who loves Quality Control's videos gets Quality Control first, and says why", async () => {
    const a = await account();
    for (const i of [1, 2, 3]) {
      await post("/videos/watch", { key: `c:${vid(i)}`, kind: "behindTheBot", watchedS: 45, completed: true }, a.cookie);
      await post("/videos/like", { key: `c:${vid(i)}`, on: true }, a.cookie);
    }
    clearAllCaches();
    const page = (await cycles("", a.cookie)).items;
    expect(page[0].teams[0]?.number).toBe(QC);
    expect(page[0].reason).toBe(`Because you like ${QC} Quality Control`);
    // The ones they finished sink below the ones they haven't seen.
    expect([vid(4), vid(5), vid(6)]).toContain(page[0].videoId);
  });

  it("people who loved this also loved that", async () => {
    // Two people love 9 and 23; a third loves 9: 23 comes early for them.
    for (let k = 0; k < 3; k++) {
      const p = await account();
      for (const i of [9, 23]) await post("/videos/like", { key: `c:${vid(i)}`, on: true }, p.cookie);
    }
    const c = await account();
    await post("/videos/like", { key: `c:${vid(9)}`, on: true }, c.cookie);
    clearAllCaches();
    const page = (await cycles("", c.cookie)).items;
    const at = page.findIndex((i) => i.videoId === vid(23));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(page[at].reason).toMatch(/Loved by people who like what you like|Because you like/);
  });

  it("learns within one scroll: a like on this page lifts that team on the next", async () => {
    const a = await account();
    const first = await cycles("", a.cookie);
    const other = first.items.find((i) => i.teams[0]?.number !== QC && i.teams.length)!;
    const team = other.teams[0].number;
    await post("/videos/like", { key: other.key, on: true }, a.cookie);
    await post("/videos/watch", { key: other.key, kind: "creator", watchedS: 45, completed: true, loops: 2 }, a.cookie);
    const next = await cycles(`?cursor=${first.next}`, a.cookie);
    expect(next.items.slice(0, 3).some((i) => i.teams.some((t) => t.number === team))).toBe(true);
    expect(next.items.some((i) => first.items.some((f) => f.key === i.key))).toBe(false);
    expect((await get<{ loops: number }>("SELECT loops FROM video_watch WHERE user_id = ? AND item_key = ?", [a.id, other.key]))!.loops).toBe(2);
  });

  it("a signed-out device's history counts too", async () => {
    const h = [1, 2, 3].map((i) => `c:${vid(i)}~d`).join(",");
    const page = (await cycles(`?h=${encodeURIComponent(h)}`)).items;
    expect(page[0].teams[0]?.number).toBe(QC);
  });
});
