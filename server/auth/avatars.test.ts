// Profile pictures (server/auth/avatars.ts, docs/shared-accounts.md "Profile pictures") against a stub Control Point
// that keeps one picture per shared account, as its internal API does.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "./email";
import { clearInfoCache } from "./controlPoint";
import { resetAvatarLimits, sniffImage } from "./avatars";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

// Tiny real-looking images: only the first bytes are checked.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 body")]);

// --- stub Control Point -----------------------------------------------------
interface Pic { id: string; mime: string; data: Buffer }
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; avatar?: { id: string } | null }>();
const pics = new Map<number, Pic>();
let nextPic = 1;
let cpDown = false;
/** An older Control Point: no avatar field, no avatar routes. */
let oldCp = false;
/** Delay (ms) for account reads; the answer is what Control Point had when the read arrived. */
let slowReads = 0;
const pushes: { id: number; mime: string; bytes: number }[] = [];
const deletes: number[] = [];
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 2000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const view = (a: ReturnType<typeof accountFor>) => {
  if (oldCp) { const { avatar: _drop, ...rest } = a; return rest; }
  const p = pics.get(a.id);
  return { ...a, avatar: p ? { id: p.id } : null };
};
/** A picture set in Control Point itself. */
const setInCp = (email: string, data: Buffer, mime: string) => { pics.set(accountFor(email).id, { id: String(nextPic++), mime, data }); };

beforeAll(async () => {
  const stub = express();
  stub.use("/internal", (req, res, next) => {
    if (cpDown) { res.status(500).json({ error: "down" }); return; }
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    if (oldCp && /\/avatar$/.test(req.path)) { res.status(404).json({ error: "Not found" }); return; }
    next();
  });
  stub.post("/internal/accounts/resolve", express.json(), (req, res) => { res.json({ account: view(accountFor(String(req.body.email).toLowerCase())) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    const a = [...accounts.values()].find((x) => x.id === Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    const answer = view(a);
    if (slowReads) setTimeout(() => res.json({ account: answer }), slowReads); else res.json({ account: answer });
  });
  stub.get("/internal/accounts/:id/avatar", (req, res) => {
    const p = pics.get(Number(req.params.id));
    if (!p) { res.status(404).json({ error: "no_avatar" }); return; }
    res.setHeader("Content-Type", p.mime); res.setHeader("X-Avatar-Id", p.id); res.end(p.data);
  });
  stub.put("/internal/accounts/:id/avatar", express.raw({ type: "image/*", limit: "512kb" }), (req, res) => {
    const id = Number(req.params.id);
    pushes.push({ id, mime: String(req.get("content-type")), bytes: (req.body as Buffer).length });
    const p = { id: String(nextPic++), mime: String(req.get("content-type")), data: req.body as Buffer };
    pics.set(id, p);
    res.json({ avatar: { id: p.id } });
  });
  stub.delete("/internal/accounts/:id/avatar", (req, res) => { deletes.push(Number(req.params.id)); pics.delete(Number(req.params.id)); res.json({ ok: true }); });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
  cp = stub.listen(0);
  await new Promise((r) => cp.once("listening", r));
  cpBase = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;

  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"]) delete process.env[k];
});
beforeEach(() => {
  cpDown = false; oldCp = false; pushes.length = 0; deletes.length = 0;
  clearInfoCache(); resetAvatarLimits();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  const req = async (path: string, init: { method?: string; json?: unknown; type?: string; body?: string } = {}) => {
    const r = await fetch(base + path, {
      method: init.method ?? "GET", redirect: "manual",
      headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : init.type ? { "Content-Type": init.type } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    return r;
  };
  const signIn = async (email: string) => {
    await req("/api/auth/email/start", { method: "POST", json: { email } });
    const r = await req("/api/auth/email/verify", { method: "POST", json: { email, code: inbox.get(email) } });
    expect(r.status).toBe(200);
  };
  const me = async () => { clearInfoCache(); return (await (await req("/api/auth/me")).json()).user; };
  const upload = (buf: Buffer) => req("/api/me/avatar", { method: "PUT", json: { image: buf.toString("base64") } });
  return { req, signIn, me, upload };
}
const bytesAt = async (url: string) => Buffer.from(await (await fetch(base + url)).arrayBuffer());

describe("sniffImage", () => {
  it("knows PNG, JPEG, WebP and GIF by their first bytes, and nothing else", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(Buffer.from("GIF89a...."))).toBe("image/gif");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("profile pictures", () => {
  it("any signed-in account sets one; it is served cached for good and sent to Control Point", async () => {
    const c = client();
    await c.signIn("pic1@example.com");
    expect((await c.me()).avatarUrl).toBeNull();
    const r = await c.upload(PNG);
    expect(r.status).toBe(200);
    const { avatarUrl } = await r.json();
    expect(avatarUrl).toMatch(/^\/api\/avatars\/\d+\/[A-Za-z0-9_-]+$/);
    expect((await c.me()).avatarUrl).toBe(avatarUrl);
    const img = await fetch(base + avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    // Control Point has it, and Scout knows it's synced.
    const acct = accountFor("pic1@example.com");
    expect(pushes).toEqual([{ id: acct.id, mime: "image/png", bytes: PNG.length }]);
    expect(pics.get(acct.id)!.data.equals(PNG)).toBe(true);
    expect((await get<any>("SELECT pending, cp_id FROM user_avatars"))).toMatchObject({ pending: null, cp_id: pics.get(acct.id)!.id });
    // A new picture gets a new URL; the old one is gone.
    const next = (await (await c.upload(JPEG)).json()).avatarUrl;
    expect(next).not.toBe(avatarUrl);
    expect((await fetch(base + avatarUrl)).status).toBe(404);
    expect((await bytesAt(next)).equals(JPEG)).toBe(true);
  });

  it("refuses what isn't a picture, too large a file, a signed-out caller and a non-JSON body", async () => {
    const c = client();
    await c.signIn("pic2@example.com");
    expect((await c.upload(Buffer.from("<svg onload=alert(1)>"))).status).toBe(400);
    expect((await c.req("/api/me/avatar", { method: "PUT", json: { image: "" } })).status).toBe(400);
    expect((await c.upload(Buffer.concat([PNG, Buffer.alloc(600 * 1024)]))).status).toBe(413);
    expect((await c.req("/api/me/avatar", { method: "PUT", type: "image/png", body: "x" })).status).toBe(415);
    expect((await client().upload(PNG)).status).toBe(401);
    expect((await c.me()).avatarUrl).toBeNull();
    expect((await fetch(`${base}/api/avatars/1/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/avatars/x/../../etc`)).status).toBe(404);
  });

  it("removing it here removes it in Control Point too", async () => {
    const c = client();
    await c.signIn("pic3@example.com");
    const url = (await (await c.upload(WEBP)).json()).avatarUrl;
    expect((await c.req("/api/me/avatar", { method: "DELETE", json: {} })).status).toBe(200);
    expect((await c.me()).avatarUrl).toBeNull();
    expect((await fetch(base + url)).status).toBe(404);
    expect(deletes).toEqual([accountFor("pic3@example.com").id]);
    expect(pics.has(accountFor("pic3@example.com").id)).toBe(false);
    expect(await get("SELECT 1 FROM user_avatars WHERE user_id = (SELECT id FROM users WHERE email = 'pic3@example.com')")).toBeUndefined();
  });

  it("a picture set in Control Point shows here, and its removal there removes it here", async () => {
    setInCp("pic4@example.com", JPEG, "image/jpeg");
    const c = client();
    await c.signIn("pic4@example.com"); // the sign-in's account answer carries the picture
    const u = await c.me();
    expect(u.avatarUrl).toMatch(/^\/api\/avatars\//);
    expect((await bytesAt(u.avatarUrl)).equals(JPEG)).toBe(true);
    // Changed in Control Point: the next account read follows it, with a new URL.
    setInCp("pic4@example.com", PNG, "image/png");
    const changed = (await c.me()).avatarUrl;
    expect(changed).not.toBe(u.avatarUrl);
    expect((await bytesAt(changed)).equals(PNG)).toBe(true);
    // Unchanged: no new URL.
    expect((await c.me()).avatarUrl).toBe(changed);
    // Removed in Control Point.
    pics.delete(accountFor("pic4@example.com").id);
    expect((await c.me()).avatarUrl).toBeNull();
    expect(pushes).toEqual([]);
  });

  it("a change made while Control Point is down waits, and is sent on the next account read", async () => {
    const c = client();
    await c.signIn("pic5@example.com");
    cpDown = true;
    const url = (await (await c.upload(PNG)).json()).avatarUrl;
    expect((await c.me()).avatarUrl).toBe(url); // shown here at once
    expect(pushes).toEqual([]);
    cpDown = false;
    // Control Point's answer says "no picture", but the pending change goes first: it is sent, not dropped.
    expect((await c.me()).avatarUrl).toBe(url);
    expect(pushes.map((p) => p.id)).toEqual([accountFor("pic5@example.com").id]);
    expect(await get<any>("SELECT pending FROM user_avatars WHERE version IS NOT NULL AND cp_id IS NOT NULL")).toMatchObject({ pending: null });
  });

  it("an older Control Point (no avatar field) never drops a picture; the change waits for one that has it", async () => {
    oldCp = true;
    const c = client();
    await c.signIn("pic6@example.com");
    const url = (await (await c.upload(PNG)).json()).avatarUrl;
    expect((await c.me()).avatarUrl).toBe(url);
    expect((await c.me()).avatarUrl).toBe(url);
    expect(pushes).toEqual([]);
    oldCp = false;
    expect((await c.me()).avatarUrl).toBe(url);
    expect(pushes.map((p) => p.id)).toEqual([accountFor("pic6@example.com").id]);
  });

  it("an account answer asked before a change here never undoes it", async () => {
    const c = client();
    await c.signIn("pic7@example.com");
    setInCp("pic7@example.com", JPEG, "image/jpeg");
    // Control Point is slow: its answer is taken now (naming the JPEG) and arrives after a new picture is set here.
    slowReads = 300;
    clearInfoCache();
    const reading = c.req("/api/auth/me");
    await new Promise((r) => setTimeout(r, 80));
    slowReads = 0;
    const url = (await (await c.upload(PNG)).json()).avatarUrl;
    await reading;
    expect((await get<any>("SELECT version FROM user_avatars WHERE user_id = (SELECT id FROM users WHERE email = 'pic7@example.com')")).version).toBe(url.split("/").pop());
    expect((await bytesAt(url)).equals(PNG)).toBe(true);
    // The next (fresh) answer names the pushed picture: still the same URL.
    expect((await c.me()).avatarUrl).toBe(url);
  });

  it("goes with the account when it is deleted", async () => {
    const c = client();
    await c.signIn("pic8@example.com");
    const url = (await (await c.upload(PNG)).json()).avatarUrl;
    expect((await c.req("/api/me", { method: "DELETE", json: { confirm: "DELETE" } })).status).toBe(200);
    expect((await fetch(base + url)).status).toBe(404);
  });
});
