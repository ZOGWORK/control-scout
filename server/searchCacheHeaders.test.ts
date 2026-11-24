// Follow-ups and related searches are the same for everyone asking the same address, so the edge may keep them
// (docs/cloudflare-cache.md): a minute fresh, five minutes stale while a fresh copy is asked for, said to Cloudflare
// too. Real app over HTTP, in-memory database.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";

let server: Server;
let base = "";
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics')");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("search follow-ups at the edge", () => {
  it.each(["/api/search/follow?q=4215", "/api/search/related?q=4215"])("%s: public, a minute, stale-while-revalidate, for Cloudflare too", async (path) => {
    const r = await fetch(base + path);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(r.headers.get("cloudflare-cdn-cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
