// Shared accounts (docs/shared-accounts.md) against a stub Control Point that
// implements the contract: linking on sign-in (never blocking it), retry on
// /me, and the "Continue with Control Point" hand-off.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "./email";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

// --- stub Control Point -----------------------------------------------------
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] } }>();
const handoffs = new Map<string, { email: string; state: string; used: boolean }>();
const resolveCalls: { email: string; verifiedBy: string }[] = [];
let cpDown = false;
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 1000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => {
    if (cpDown) { res.status(500).json({ error: "down" }); return; }
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    next();
  });
  stub.post("/internal/accounts/resolve", (req, res) => {
    resolveCalls.push({ email: req.body.email, verifiedBy: req.body.verifiedBy });
    res.json({ account: accountFor(String(req.body.email).toLowerCase()) });
  });
  stub.post("/internal/handoff/redeem", (req, res) => {
    const h = handoffs.get(req.body.code);
    if (!h || h.used || h.state !== req.body.state) { res.status(400).json({ error: "invalid code" }); return; }
    h.used = true;
    res.json({ account: accountFor(h.email) });
  });
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
  cpDown = false;
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  const req = async (path: string, init: { method?: string; json?: unknown } = {}) => {
    const r = await fetch(base + path, {
      method: init.method ?? "GET", redirect: "manual",
      headers: { ...(init.json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
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
    return req("/api/auth/email/verify", { method: "POST", json: { email, code: inbox.get(email) } });
  };
  return { req, signIn, cookie: () => cookie };
}
const me = async (c: ReturnType<typeof client>) => (await c.req("/api/auth/me")).json();

describe("shared accounts", () => {
  it("is off without the CONTROL_POINT_* settings", async () => {
    delete process.env.CONTROL_POINT_INTERNAL_KEY;
    const c = client();
    expect((await me(c)).providers.controlPoint).toBe(false);
    expect((await c.req("/api/auth/control-point/start")).status).toBe(503);
  });

  it("links an email sign-in to the shared account", async () => {
    const c = client();
    expect((await c.signIn("ada@example.com")).status).toBe(200);
    expect(resolveCalls.at(-1)).toEqual({ email: "ada@example.com", verifiedBy: "scout-email-code" });
    const m = await me(c);
    expect(m.providers.controlPoint).toBe(true);
    expect(m.user.controlPointLinked).toBe(true);
    const ids = await all<any>("SELECT provider, subject FROM identities WHERE provider = 'control-point'");
    expect(ids).toContainEqual({ provider: "control-point", subject: String(accounts.get("ada@example.com")!.id) });
  });

  it("never blocks sign-in when Control Point is down, and links on the next /me", async () => {
    cpDown = true;
    const c = client();
    expect((await c.signIn("grace@example.com")).status).toBe(200);
    expect((await me(c)).user.controlPointLinked).toBe(false);
    cpDown = false;
    expect((await me(c)).user.controlPointLinked).toBe(true);
  });

  it("Continue with Control Point: state cookie, redirect, redeem, session", async () => {
    const c = client();
    const start = await c.req("/api/auth/control-point/start");
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://cp.test/api/auth/scout/start");
    const state = to.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(c.cookie()).toContain("cs_cp_state=");

    // Control Point signed the visitor in as ada@example.com and sends them back.
    handoffs.set("code-1", { email: "ada@example.com", state, used: false });
    const back = await c.req(`/api/auth/control-point/callback?code=code-1&state=${state}`);
    expect(back.headers.get("location")).toBe("/my-team?signin=ok");
    const m = await me(c);
    // Same email as the earlier email sign-in → the same Scout user, not a new one.
    expect(m.user.email).toBe("ada@example.com");
    const users = await all<any>("SELECT id FROM users WHERE email = 'ada@example.com'");
    expect(users).toHaveLength(1);
    expect(m.user.id).toBe(Number(users[0].id));
  });

  it("rejects a callback whose state doesn't match, and a reused code", async () => {
    const c = client();
    const start = await c.req("/api/auth/control-point/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    handoffs.set("code-2", { email: "lin@example.com", state, used: false });
    const bad = await c.req(`/api/auth/control-point/callback?code=code-2&state=not-the-state-${state}`);
    expect(bad.headers.get("location")).toBe("/settings?signin=failed");
    expect((await me(c)).user).toBeNull();

    // The state cookie is single use too: a second callback can't reuse it.
    const again = await c.req(`/api/auth/control-point/callback?code=code-2&state=${state}`);
    expect(again.headers.get("location")).toBe("/settings?signin=failed");
  });
});
