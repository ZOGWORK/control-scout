// The shutdown message (server/shutdownGate.ts) against the real app on an in-memory database: with publicAccess off,
// an outsider gets only the 503 message (pages, API, Lite, packs), signed-in accounts and the keyed uptime monitor get
// the site with private answers, sign-in stays open but no new account is made; with it on, nothing changes.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { setMailer } from "./auth/email";
import { deleteUser, sha256, SignupsClosedError, userForIdentity } from "./auth/session";
import { forgetPublicAccess, invalidateFlags, setFlag } from "./flags";
import { resetGateSessions } from "./shutdownGate";

let server: Server;
let base = "";
const inbox = new Map<string, string>();
const savedKey = process.env.UPTIME_GATE_KEY;

async function session(email: string, expires = Date.now() + 864e5): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(expires).toISOString()]);
  return `cs_session=${t}`;
}

const call = (path: string, init: { cookie?: string; headers?: Record<string, string>; method?: string; body?: unknown } = {}) =>
  fetch(base + path, {
    method: init.method ?? "GET", redirect: "manual",
    headers: { Accept: "text/html", ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _subject, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  const dist = mkdtempSync(join(tmpdir(), "cs-gate-"));
  writeFileSync(join(dist, "index.html"), "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "index-AAAA1111.js"), "export const v = 1;");
  writeFileSync(join(dist, "robots.txt"), "User-agent: *\n");
  server = createApp({ dist }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null);
  server?.close();
  if (savedKey === undefined) delete process.env.UPTIME_GATE_KEY; else process.env.UPTIME_GATE_KEY = savedKey;
});
beforeEach(async () => {
  await run("DELETE FROM feature_flags");
  invalidateFlags();
  forgetPublicAccess();
  resetGateSessions();
  delete process.env.UPTIME_GATE_KEY;
});
const shutDown = () => setFlag("publicAccess", false, "owner@example.com");

describe("with publicAccess off", () => {
  it("an outsider gets only the message: 503, two days' Retry-After, never cached", async () => {
    await shutDown();
    const r = await call("/");
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("172800");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("vary")).toMatch(/Cookie/);
    const html = await r.text();
    expect(html).toContain("Control Scout is under construction.");
    expect(html).toContain("We'll be back in a couple of days.");
    expect(html).toContain("Have an account?");
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain("New accounts can't be made right now.");
    expect(await (await call("/?signin=closed")).text()).toContain("New accounts can't be made right now.");
  });

  it("covers every page, the API, Lite and the packs", async () => {
    await shutDown();
    for (const p of ["/teams/123", "/events/2025/USNJQ1", "/lite", "/lite/teams/123", "/packs/latest.json", "/sitemap.xml"]) {
      const r = await call(p);
      expect(r.status, p).toBe(503);
      expect(await r.text(), p).toContain("under construction");
    }
    const api = await call("/api/teams/123");
    expect(api.status).toBe(503);
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(await api.json()).toEqual({ error: "unavailable", message: "Control Scout is under construction. We'll be back in a couple of days." });
  });

  it("leaves sign-in, the flags, assets and robots.txt reachable", async () => {
    await shutDown();
    const me = await call("/api/auth/me");
    expect(me.status).toBe(200);
    expect((await me.json()).user).toBeNull();
    expect((await call("/api/flags")).status).toBe(200);
    expect((await call("/assets/index-AAAA1111.js")).status).toBe(200);
    expect((await call("/robots.txt")).status).toBe(200);
    // The page's own look: the logo, the mark and the fonts it draws with.
    for (const p of ["/logo-56.webp", "/mark.webp", "/fonts/Inter.woff2"]) expect((await call(p)).status, p).not.toBe(503);
  });

  it("a signed-in account gets the site, every answer private", async () => {
    await shutDown();
    const cookie = await session("member@example.com");
    const page = await call("/", { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="root"');
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("vary")).toMatch(/Cookie/);
    const api = await call("/api/meta", { cookie });
    expect(api.status).not.toBe(503);
    expect(api.headers.get("cache-control")).toBe("private, no-store");
    const lite = await call("/lite", { cookie });
    expect(lite.status).not.toBe(503);
    expect(lite.headers.get("cache-control")).toBe("private, no-store");
  });

  it("an expired or unknown session is an outsider", async () => {
    await shutDown();
    expect((await call("/", { cookie: await session("old@example.com", Date.now() - 1000) })).status).toBe(503);
    expect((await call("/", { cookie: "cs_session=nobody" })).status).toBe(503);
  });

  it("a signed-out or deleted account is an outsider at once, never passed on a kept answer", async () => {
    await shutDown();
    const cookie = await session("leaving@example.com");
    expect((await call("/", { cookie })).status).toBe(200);
    const out = await call("/api/auth/logout", { cookie, method: "POST", body: {}, headers: { Origin: base } });
    expect(out.status).toBe(200);
    expect((await call("/", { cookie })).status).toBe(503);
    const gone = await session("gone@example.com");
    expect((await call("/", { cookie: gone })).status).toBe(200);
    const u = await get<{ id: number }>("SELECT id FROM users WHERE email = ?", ["gone@example.com"]);
    await deleteUser(u!.id);
    expect((await call("/", { cookie: gone })).status).toBe(503);
  });

  it("lets the uptime monitor in only with the right key, and never without UPTIME_GATE_KEY", async () => {
    await shutDown();
    expect((await call("/", { headers: { "x-uptime-key": "" } })).status).toBe(503);
    expect((await call("/", { headers: { "x-uptime-key": "anything" } })).status).toBe(503);
    process.env.UPTIME_GATE_KEY = "uptime-secret";
    expect((await call("/", { headers: { "x-uptime-key": "wrong" } })).status).toBe(503);
    const r = await call("/", { headers: { "x-uptime-key": "uptime-secret" } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<div id="root">');
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("signs in an existing account by email, but makes no new one", async () => {
    await shutDown();
    await run("INSERT INTO users (email, created_at) VALUES ('known@example.com', ?)", [new Date().toISOString()]);
    for (const [email, ok] of [["known@example.com", true], ["stranger@example.com", false]] as const) {
      expect((await call("/api/auth/email/start", { method: "POST", body: { email } })).status).toBe(200);
      const r = await call("/api/auth/email/verify", { method: "POST", body: { email, code: inbox.get(email) } });
      if (ok) {
        expect(r.status).toBe(200);
        expect(r.headers.get("set-cookie")).toMatch(/cs_session=/);
      } else {
        expect(r.status).toBe(403);
        expect(await r.json()).toEqual({ error: "signups_closed", message: "New accounts can't be made right now." });
      }
    }
    expect(await get("SELECT id FROM users WHERE email = 'stranger@example.com'")).toBeUndefined();
  });

  it("finds an existing account by identity or email from any provider, and refuses a new one", async () => {
    await shutDown();
    await run("INSERT INTO users (email, created_at) VALUES ('coach@example.com', ?)", [new Date().toISOString()]);
    expect((await userForIdentity("google", "g-1", "coach@example.com")).email).toBe("coach@example.com");
    expect((await userForIdentity("google", "g-1", null)).email).toBe("coach@example.com");
    await expect(userForIdentity("google", "g-2", "new@example.com")).rejects.toBeInstanceOf(SignupsClosedError);
  });
});

describe("when the flags can't be read yet (a restart)", () => {
  const unreadable = async (check: () => Promise<void>) => {
    await run("ALTER TABLE feature_flags RENAME TO feature_flags_away");
    try { invalidateFlags(); await check(); } finally { await run("ALTER TABLE feature_flags_away RENAME TO feature_flags"); invalidateFlags(); }
  };
  it("keeps the message up and sign-ups closed when the switch was last read off", async () => {
    await shutDown();
    expect((await call("/")).status).toBe(503);
    await unreadable(async () => {
      expect((await call("/")).status).toBe(503);
      await expect(userForIdentity("email", "new@example.com", "new@example.com")).rejects.toBeInstanceOf(SignupsClosedError);
    });
  });
  it("keeps the site open when the switch was last read on, or never read", async () => {
    await unreadable(async () => { expect((await call("/")).status).toBe(200); });
    expect((await call("/")).status).toBe(200);
    await unreadable(async () => { expect((await call("/")).status).toBe(200); });
  });
});

describe("with publicAccess on (the default)", () => {
  it("changes nothing: pages and data answer as before, with their usual caching", async () => {
    const page = await call("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("retry-after")).toBeNull();
    expect(page.headers.get("cache-control")).not.toContain("private");
    const api = await call("/api/meta");
    expect(api.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect((await userForIdentity("email", "fresh@example.com", "fresh@example.com")).email).toBe("fresh@example.com");
  });
});
