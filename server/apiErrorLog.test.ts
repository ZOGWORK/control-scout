// A 5xx in the log names its route as the owner portal does (method + pattern, no ids or queries), so a driver error
// whose stack ends in node_modules (SQLITE_BUSY) can still be told to a route.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, setDb } from "./db";
import { createApp } from "./app";

let server: Server;
let base = "";
beforeAll(async () => {
  setDb(openDb(":memory:")); // no tables: every read fails as a driver error would
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("the [api] error log", () => {
  it("names the method and route pattern, never the team number or the query", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await fetch(`${base}/api/teams/16236?season=2025&secret=abc`);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "Something went wrong on our side." });
      const lines = spy.mock.calls.filter((c) => typeof c[0] === "string" && c[0].startsWith("[api]"));
      expect(lines.map((c) => c[0])).toContain("[api] GET /api/teams/:n");
      expect(lines.every((c) => !String(c[0]).includes("16236") && !String(c[0]).includes("secret"))).toBe(true);
      expect(lines.find((c) => c[0] === "[api] GET /api/teams/:n")![1]).toBeInstanceOf(Error);
    } finally { spy.mockRestore(); }
  });
});
