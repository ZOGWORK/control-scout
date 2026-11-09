// An event's address without its season (/events/USNJNEM2) is a 301 to the newest season's page, query kept;
// an unknown code is still the 404 page. Real app over HTTP, in-memory database.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { pageMeta } from "./seoMeta";

let server: Server;
let base = "";
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [season, code] of [[2025, "USNJNEM2"], [2026, "USNJNEM2"], [2024, "USNJQ9"], [2019, "2019INMeet10"], [2024, "USNJCASE"], [2025, "UsNjCase"]] as const) {
    await run("INSERT INTO events (season, code, name, type, start, end, source, synced_at) VALUES (?, ?, 'Meet', 'LeagueMeet', '2025-11-01', '2025-11-01', 'first', 'x')", [season, code]);
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("event address without a season", () => {
  it("301s to the newest season's page, in the code's canonical spelling, query kept", async () => {
    for (const [from, to] of [
      ["/events/USNJNEM2", "/events/2026/USNJNEM2"],
      ["/events/usnjnem2?tab=teams", "/events/2026/USNJNEM2?tab=teams"],
      ["/events/USNJQ9", "/events/2024/USNJQ9"],
      ["/events/2019inmeet10", "/events/2019/2019INMEET10"],
      // The newest season wins whatever case each season stores the code in.
      ["/events/USNJCASE", "/events/2025/USNJCASE"],
    ]) {
      const res = await fetch(`${base}${from}`, { redirect: "manual" });
      expect(res.status, from).toBe(301);
      expect(new URL(res.headers.get("location")!, base).pathname + new URL(res.headers.get("location")!, base).search, from).toBe(to);
    }
  });

  it("an unknown code, or a bare season, is not redirected", async () => {
    for (const p of ["/events/NOSUCH", "/events/2026"]) expect((await fetch(`${base}${p}`, { redirect: "manual" })).status, p).not.toBe(301);
  });

  it("an address that isn't redirected is a 404 page, never indexed", async () => {
    for (const p of ["/events/NOSUCH", "/events/2026"]) expect((await pageMeta(p)).notFound, p).toBe(true);
  });

  it("the app's lookup answers the same, and 404s an unknown code", async () => {
    expect(await (await fetch(`${base}/api/event-code/usnjnem2`)).json()).toEqual({ season: 2026, code: "USNJNEM2" });
    expect((await fetch(`${base}/api/event-code/NOSUCH`)).status).toBe(404);
  });
});
