// Event streams end to end on the real app: the owner sets one (the event page's detail then carries it and
// the events list marks the row), a bad or non-YouTube link is refused with nothing saved, removing it takes
// the section and the dot away again, and nobody but the owner can change one.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { clearAllCaches } from "../caches";

let server: Server;
let base = "";
const saved = process.env.OWNER_EMAILS;
let owner = "", other = "";
const S = 2026;
const ID = "dQw4w9WgXcQ";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}
async function call(method: string, path: string, cookie?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const today = new Date().toISOString().slice(0, 10);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'USCAQ1', 'California Qualifier', 'Qualifier', ?, ?, 0, 0, 'test')", [S, today, today]);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
  await kvSet("data:version", "v1");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = await signIn("owner@example.com");
  other = await signIn("scout@example.com");
});
afterAll(() => { server?.close(); if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved; });
beforeEach(async () => { process.env.OWNER_EMAILS = "owner@example.com"; await run("DELETE FROM event_streams"); clearAllCaches(); });

const detail = async () => (await call("GET", `/api/events/${S}/USCAQ1`)).json.event;
const row = async () => (await call("GET", `/api/events?season=${S}&all=1`)).json.events.find((e: any) => e.code === "USCAQ1");

describe("event streams", () => {
  it("set by the owner: the event's detail carries the nocookie embed, and its list row is marked", async () => {
    expect((await detail()).stream).toBeUndefined();
    const r = await call("PUT", `/api/owner/streams/${S}/uscaq1`, owner, { url: `https://youtu.be/${ID}` });
    expect(r.status).toBe(200);
    expect(r.json.stream).toEqual({ videoId: ID, streamUrl: `https://www.youtube-nocookie.com/embed/${ID}` });
    // Stored as a full link to the video, whatever form was pasted.
    expect(r.json.streams).toMatchObject([{ season: S, code: "USCAQ1", name: "California Qualifier", url: `https://www.youtube.com/watch?v=${ID}` }]);
    expect((await detail()).stream).toEqual({ videoId: ID, streamUrl: `https://www.youtube-nocookie.com/embed/${ID}` });
    expect((await row()).stream).toBe(true);
    expect(await all("SELECT action FROM owner_audit WHERE action LIKE 'stream.%'")).toEqual([{ action: "stream.set" }]);
  });

  it("a non-YouTube or unusable link is refused with its reason, and nothing is saved", async () => {
    for (const url of ["https://www.twitch.tv/first", "https://www.youtube.com/@FIRST/live", "not a link"]) {
      const r = await call("PUT", `/api/owner/streams/${S}/USCAQ1`, owner, { url });
      expect(r.status, url).toBe(400);
      expect(r.json.error.length).toBeGreaterThan(10);
    }
    expect(await all("SELECT * FROM event_streams")).toEqual([]);
    expect((await detail()).stream).toBeUndefined();
  });

  it("removing it (an empty link) takes the section and the dot away", async () => {
    await call("PUT", `/api/owner/streams/${S}/USCAQ1`, owner, { url: `https://www.youtube.com/watch?v=${ID}` });
    const r = await call("PUT", `/api/owner/streams/${S}/USCAQ1`, owner, { url: "" });
    expect(r.json).toMatchObject({ stream: null, streams: [] });
    expect((await detail()).stream).toBeUndefined();
    expect((await row()).stream).toBeUndefined();
  });

  it("an unknown event is a 404; anyone but the owner gets the portal's 404", async () => {
    expect((await call("PUT", `/api/owner/streams/${S}/NOPE`, owner, { url: `https://youtu.be/${ID}` })).status).toBe(404);
    expect((await call("PUT", `/api/owner/streams/${S}/USCAQ1`, other, { url: `https://youtu.be/${ID}` })).status).toBe(404);
    expect((await call("GET", "/api/owner/streams")).status).toBe(404);
  });
});
