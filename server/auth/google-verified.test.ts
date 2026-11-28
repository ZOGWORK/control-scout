// Google sign-in links by email (userForIdentity), so it only takes an address Google says it verified:
// email_verified must be true. Missing (or false) must not sign in, nor attach Google to an existing account.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { userForIdentity } from "./session";

let server: Server;
let port = 0;
const saved = { ...process.env };
let info: Record<string, unknown> = {};
const realFetch = globalThis.fetch;

beforeAll(async () => {
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-id", GOOGLE_CLIENT_SECRET: "test-secret", APP_URL: "https://controlscout.org" });
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
  // Google's token and userinfo endpoints, answered here; anything else goes out as usual.
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Promise.resolve(Response.json({ access_token: "at" }));
    if (u.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return Promise.resolve(Response.json(info));
    return realFetch(url, init);
  });
});
afterAll(() => { vi.unstubAllGlobals(); process.env = saved; server?.close(); });
beforeEach(() => { info = {}; });

/** The callback with a matching state cookie: where it redirects. */
const callback = () => new Promise<string | undefined>((done, fail) => {
  request({ port, path: "/api/auth/google/callback?state=s&code=c", headers: { host: "controlscout.org", cookie: "cs_oauth_state=s" } },
    (res) => { res.resume(); done(res.headers.location); }).on("error", fail).end();
});
const googleIdentities = () => all<any>("SELECT subject FROM identities WHERE provider = 'google'");

describe("Google sign-in: verified email only", () => {
  it("refuses an address with no email_verified, and doesn't link it to the account that has it", async () => {
    await userForIdentity("email", "victim@example.com", "victim@example.com");
    info = { sub: "g-1", email: "victim@example.com", name: "Mallory" };
    expect(await callback()).toBe("/settings?section=profile&signin=failed");
    info = { sub: "g-1", email: "victim@example.com", email_verified: false };
    expect(await callback()).toBe("/settings?section=profile&signin=failed");
    info = { sub: "g-1", email: "victim@example.com", email_verified: "true" }; // only the boolean counts
    expect(await callback()).toBe("/settings?section=profile&signin=failed");
    expect(await googleIdentities()).toEqual([]);
  });

  it("signs in with a verified address", async () => {
    info = { sub: "g-2", email: "real@example.com", email_verified: true };
    expect(await callback()).toBe("/my-team?signin=ok");
    expect(await googleIdentities()).toEqual([{ subject: "g-2" }]);
  });
});
