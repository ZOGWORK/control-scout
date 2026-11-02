// The supporters list from GitHub Sponsors (server/sponsors.ts): public sponsors by name, oldest first, one row
// each; private ones only counted; never an amount. No token: "not set up". GitHub down: the last good list.
// And GET /api/supporters over HTTP, with GitHub answered by a stand-in.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { createApp } from "./app";
import { clearAllCaches } from "./caches";
import { SUPPORTERS_TTL_MS, setSponsorsFetch, supporters, toSupporters } from "./sponsors";

const node = (privacyLevel: "PUBLIC" | "PRIVATE", login: string | null, createdAt: string, name: string | null = null) =>
  ({ privacyLevel, createdAt, sponsorEntity: login ? { login, name } : null });
const NODES = [
  node("PUBLIC", "bea", "2026-12-01T00:00:00Z", "Bea B"),
  node("PRIVATE", "secret1", "2026-11-05T00:00:00Z", "Hidden Name"),
  node("PUBLIC", "amy", "2026-11-10T00:00:00Z"),
  node("PUBLIC", "Bea", "2026-11-20T00:00:00Z", "Bea B"), // the same sponsor again, earlier
  node("PRIVATE", "secret1", "2026-12-05T00:00:00Z"),
  node("PRIVATE", null, "2026-12-06T00:00:00Z"), // a deleted account
  node("PRIVATE", "amy", "2026-12-07T00:00:00Z"), // public once: stays listed
];
const reply = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) =>
  new Response(JSON.stringify({ data: { viewer: { sponsorshipsAsMaintainer: { pageInfo: { hasNextPage, endCursor }, nodes } } } }), { status: 200 });

const saved = process.env.GITHUB_SPONSORS_TOKEN;
afterEach(() => { setSponsorsFetch(null); clearAllCaches(); if (saved === undefined) delete process.env.GITHUB_SPONSORS_TOKEN; else process.env.GITHUB_SPONSORS_TOKEN = saved; });

describe("toSupporters", () => {
  it("lists public sponsors once, oldest first, and only counts the private ones", () => {
    const r = toSupporters(NODES);
    expect(r.supporters).toEqual([
      { login: "amy", name: null, since: "2026-11-10T00:00:00Z" },
      { login: "Bea", name: "Bea B", since: "2026-11-20T00:00:00Z" },
    ]);
    expect(r.anonymous).toBe(2); // secret1 (twice) + the deleted account
    expect(JSON.stringify(r)).not.toMatch(/secret1|Hidden Name/);
  });
});

describe("supporters()", () => {
  it("no token: not set up, and GitHub is never asked", async () => {
    delete process.env.GITHUB_SPONSORS_TOKEN;
    let asked = 0;
    setSponsorsFetch((async () => { asked++; return reply([]); }) as typeof fetch);
    expect(await supporters()).toEqual({ configured: false, supporters: [], anonymous: 0, updatedAt: null });
    expect(asked).toBe(0);
  });

  it("reads every page with the token, caches an hour, and keeps the last good list when GitHub fails", async () => {
    process.env.GITHUB_SPONSORS_TOKEN = "test-token";
    const calls: { auth: string | null; after: unknown }[] = [];
    let down = false;
    setSponsorsFetch((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ auth: new Headers(init.headers).get("authorization"), after: body.variables.after });
      if (down) return new Response("", { status: 502 });
      return body.variables.after ? reply(NODES.slice(3)) : reply(NODES.slice(0, 3), true, "c1");
    }) as unknown as typeof fetch);
    const t0 = Date.UTC(2026, 11, 10);
    const first = await supporters(t0);
    expect(calls).toEqual([{ auth: "Bearer test-token", after: null }, { auth: "Bearer test-token", after: "c1" }]);
    expect(first.configured).toBe(true);
    expect(first.supporters.map((s) => s.login)).toEqual(["amy", "Bea"]);
    expect(await supporters(t0 + 1000)).toBe(first);
    expect(calls.length).toBe(2);
    down = true;
    expect(await supporters(t0 + SUPPORTERS_TTL_MS + 1)).toBe(first);
    // …and doesn't ask again on the very next visit.
    const n = calls.length;
    await supporters(t0 + SUPPORTERS_TTL_MS + 2);
    expect(calls.length).toBe(n);
  });
});

describe("supporters() before any good list", () => {
  it("a failure with nothing cached throws, and GitHub isn't asked again for 5 minutes", async () => {
    process.env.GITHUB_SPONSORS_TOKEN = "bad-token";
    let asked = 0;
    setSponsorsFetch((async () => { asked++; return new Response("", { status: 401 }); }) as unknown as typeof fetch);
    const t0 = Date.UTC(2026, 11, 10);
    await expect(supporters(t0)).rejects.toThrow();
    await expect(supporters(t0 + 60_000)).rejects.toThrow();
    expect(asked).toBe(1);
    await expect(supporters(t0 + 5 * 60_000 + 1)).rejects.toThrow();
    expect(asked).toBe(2);
  });
});

describe("GET /api/supporters", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });

  it("answers the list, with no private names and no amounts", async () => {
    process.env.GITHUB_SPONSORS_TOKEN = "test-token";
    setSponsorsFetch((async () => reply(NODES)) as unknown as typeof fetch);
    const res = await fetch(`${base}/api/supporters`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.supporters.map((s: { login: string }) => s.login)).toEqual(["amy", "Bea"]);
    expect(body.anonymous).toBe(2);
    expect(JSON.stringify(body)).not.toMatch(/secret1|Hidden Name|amount|tier/i);
  });
});
