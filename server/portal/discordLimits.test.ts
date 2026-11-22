// The owner console's Discord chat caps (server/portal/discordLimits.ts, bot/quota.ts) against the real app on an
// in-memory database: owner only; every server the bot kept something for listed with the cap it has and what it has
// used; setting a server's own cap and clearing it back to the default, both audited; and either write starting that
// server's counters afresh, so a cap set after chats under the default isn't refused at once.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { DEFAULT_LIMIT, chatWindows } from "../../bot/quota";

let server: Server;
let base = "";
const saved = { owners: process.env.OWNER_EMAILS };
let ownerCookie = "", otherCookie = "";
const G1 = "111111111111111111";
const G2 = "222222222222222222";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

let auditFrom = 0;
const audit = () => all<{ actor: string; action: string; details: string | null; old_value: string | null; new_value: string | null }>(
  "SELECT * FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom]);

const at = new Date().toISOString();
/** A follow, today's counts and a team asked about, for one server. */
async function seed(guild: string, used = 4) {
  const w = chatWindows();
  await run("INSERT INTO discord_follows (guild_id, channel_id, team, created_at, created_by) VALUES (?, ?, 4215, ?, 'u1')", [guild, `c-${guild}`, at]);
  await run("INSERT INTO discord_chat_usage (guild_id, window, used) VALUES (?, ?, ?), (?, ?, ?)", [guild, w.hour, used, guild, w.day, used]);
  await run("INSERT INTO discord_guild_teams (guild_id, team, asks, last_at) VALUES (?, 4215, 1, ?)", [guild, at]);
}

const serverRow = (body: any, guild: string) => body.servers.find((s: any) => s.guild === guild);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  server?.close();
  if (saved.owners === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved.owners;
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  for (const t of ["discord_follows", "discord_chat_usage", "discord_limits", "discord_guild_teams", "discord_people", "discord_threads"]) {
    await run(`DELETE FROM ${t}`);
  }
  auditFrom = Number((await get<{ n: number }>("SELECT COALESCE(MAX(id), 0) n FROM owner_audit"))!.n);
});

describe("the owner console's Discord caps", () => {
  it("answers 403 to visitors and non-owners on every route, and changes nothing", async () => {
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/owner/discord/limits"],
      ["PUT", `/api/owner/discord/limits/${G1}`, { perHour: 5, perDay: 5 }],
      ["DELETE", `/api/owner/discord/limits/${G1}`, {}],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, { body })).status, path).toBe(403);
      expect((await call(method, path, { body, cookie: otherCookie })).status, path).toBe(403);
    }
    expect(await get("SELECT 1 FROM discord_limits")).toBeUndefined();
    expect(await get("SELECT 1 FROM owner_audit WHERE action = 'discord.limit'")).toBeUndefined();
  });

  it("lists every server the bot kept something for, its cap and today's counts", async () => {
    await seed(G1, 4);
    // A server that left only a thread behind is still one the bot knows.
    await run("INSERT INTO discord_threads (root_id, turns, updated_at, guild_id) VALUES ('r1', '[]', ?, ?)", [at, G2]);
    const r = await call("GET", "/api/owner/discord/limits", { cookie: ownerCookie });
    expect(r.status).toBe(200);
    expect(r.json.defaultLimit).toEqual({ ...DEFAULT_LIMIT });
    expect(r.json.servers.map((s: any) => s.guild)).toEqual([G1, G2]);
    expect(serverRow(r.json, G1)).toMatchObject({
      perHour: DEFAULT_LIMIT.perHour, perDay: DEFAULT_LIMIT.perDay, custom: false, usedHour: 4, usedDay: 4, follows: 1, lastAsk: at,
    });
    expect(serverRow(r.json, G2)).toMatchObject({ custom: false, follows: 0, usedHour: 0 });
    // A server's counts are its own.
    expect(serverRow(r.json, G2).usedDay).toBe(0);
  });

  it("sets one server's cap, audited, and starts its counters afresh; clearing it is the way back", async () => {
    await seed(G1, 4);
    const put = await call("PUT", `/api/owner/discord/limits/${G1}`, { cookie: ownerCookie, body: { perHour: 10, perDay: null } });
    expect(put.status).toBe(200);
    expect(serverRow(put.json, G1)).toMatchObject({ perHour: 10, perDay: null, custom: true, usedHour: 0, usedDay: 0, updatedBy: "owner@example.com" });
    // Nothing it asked under the default is counted against its own cap.
    expect(await get("SELECT 1 FROM discord_chat_usage WHERE guild_id = ?", [G1])).toBeUndefined();
    const set = await audit();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ actor: "owner@example.com", action: "discord.limit" });
    expect(JSON.parse(set[0].details!)).toMatchObject({ guild: G1, perHour: 10, perDay: null });
    expect(JSON.parse(set[0].old_value!)).toMatchObject({ perHour: 30, perDay: 100, custom: false });

    // 0 (like a blank box) is no cap for that window, not the default.
    const none = await call("PUT", `/api/owner/discord/limits/${G1}`, { cookie: ownerCookie, body: { perHour: 0, perDay: 0 } });
    expect(serverRow(none.json, G1)).toMatchObject({ perHour: null, perDay: null, custom: true });

    // Clearing the row puts it back on the default every server has, its counts gone with it.
    await run("INSERT INTO discord_chat_usage (guild_id, window, used) VALUES (?, ?, 7)", [G1, chatWindows().day]);
    const del = await call("DELETE", `/api/owner/discord/limits/${G1}`, { cookie: ownerCookie, body: {} });
    expect(del.status).toBe(200);
    expect(serverRow(del.json, G1)).toMatchObject({ perHour: 30, perDay: 100, custom: false, usedHour: 0, usedDay: 0 });
    expect(await get("SELECT 1 FROM discord_chat_usage WHERE guild_id = ?", [G1])).toBeUndefined();
    const cleared = await audit();
    expect(cleared.map((a) => JSON.parse(a.details!).clear === true ? "clear" : "set")).toEqual(["set", "set", "clear"]);
    expect(JSON.parse(cleared[2].new_value!)).toMatchObject({ perHour: 30, perDay: 100, custom: false });

    // A server already on the default has nothing to clear.
    expect((await call("DELETE", `/api/owner/discord/limits/${G1}`, { cookie: ownerCookie, body: {} })).status).toBe(409);
  });

  it("refuses a server id that isn't one, and a cap that isn't a count", async () => {
    expect((await call("PUT", "/api/owner/discord/limits/not-a-server", { cookie: ownerCookie, body: { perHour: 5 } })).status).toBe(404);
    expect((await call("DELETE", "/api/owner/discord/limits/42", { cookie: ownerCookie, body: {} })).status).toBe(404);
    for (const bad of [{ perHour: 1.5, perDay: 5 }, { perHour: -1, perDay: 5 }, { perHour: 100_001, perDay: 5 }, { perHour: "many", perDay: 5 }]) {
      expect((await call("PUT", `/api/owner/discord/limits/${G1}`, { cookie: ownerCookie, body: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await get("SELECT 1 FROM discord_limits WHERE guild_id = ?", [G1])).toBeUndefined();
    expect(await audit()).toHaveLength(0);
  });
});
