// Google sign-in must start on the APP_URL host: the site also answers on
// aliases (www, scout.tryctrlpoint.org), but Google returns to APP_URL and the
// state cookie is host-only, so a start on an alias could never finish.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "../db";
import { createApp } from "../app";

let server: Server;
let port = 0;
const saved = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-id", GOOGLE_CLIENT_SECRET: "test-secret", APP_URL: "https://controlscout.org" });
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { process.env = saved; server?.close(); });

/** GET with a chosen Host header (fetch can't set Host). */
const get = (path: string, host: string) => new Promise<{ status: number; location?: string; cookie?: string[] }>((done, fail) => {
  request({ port, path, headers: { host } }, (res) => { res.resume(); done({ status: res.statusCode!, location: res.headers.location, cookie: res.headers["set-cookie"] }); }).on("error", fail).end();
});

describe("Google sign-in host", () => {
  it("sends an alias to the APP_URL host first, without setting the state cookie", async () => {
    const r = await get("/api/auth/google/start", "www.controlscout.org");
    expect(r.status).toBe(302);
    expect(r.location).toBe("https://controlscout.org/api/auth/google/start");
    expect(r.cookie ?? []).not.toContainEqual(expect.stringContaining("cs_oauth_state"));
  });
  it("starts the Google flow on the APP_URL host", async () => {
    const r = await get("/api/auth/google/start", "controlscout.org");
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(r.cookie ?? []).toContainEqual(expect.stringContaining("cs_oauth_state"));
  });
});
