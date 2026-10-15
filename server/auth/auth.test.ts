// Accounts end to end over HTTP, against the real app on an in-memory database:
// email code → session → personal sync (newer wins) → first-sign-in migration
// → scouting sync → code limits → logout. The mailer is swapped to capture codes.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "./email";

let server: Server;
let base = "";
const inbox = new Map<string, string>();

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _subject, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { setMailer(null); server?.close(); });

/** A browser-ish client: keeps its cookie, sends JSON with a same-origin header. */
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
}

async function signIn(call: ReturnType<typeof client>, email: string) {
  expect((await call("POST", "/api/auth/email/start", { email })).status).toBe(200);
  const r = await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email.toLowerCase()) });
  expect(r.status).toBe(200);
  return r.json.user;
}

describe("accounts", () => {
  it("signs in with an emailed code and knows who you are", async () => {
    const call = client();
    expect((await call("GET", "/api/auth/me")).json.user).toBeNull();
    const user = await signIn(call, "Coach@Example.com");
    expect(user.email).toBe("coach@example.com");
    expect((await call("GET", "/api/auth/me")).json.user.email).toBe("coach@example.com");
  });

  it("rejects a wrong code and burns the code after 5 tries", async () => {
    const call = client();
    await call("POST", "/api/auth/email/start", { email: "tries@example.com" });
    const right = inbox.get("tries@example.com")!;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/auth/email/verify", { email: "tries@example.com", code: wrong })).status).toBe(400);
    const r = await call("POST", "/api/auth/email/verify", { email: "tries@example.com", code: right });
    expect(r.status).toBe(400);
    expect(r.json.reason).toBe("attempts");
  });

  it("a code works once", async () => {
    const a = client(), b = client();
    await a("POST", "/api/auth/email/start", { email: "once@example.com" });
    const code = inbox.get("once@example.com");
    expect((await a("POST", "/api/auth/email/verify", { email: "once@example.com", code })).status).toBe(200);
    expect((await b("POST", "/api/auth/email/verify", { email: "once@example.com", code })).status).toBe(400);
  });

  it("syncs personal state across devices, newer write wins", async () => {
    const phone = client();
    await signIn(phone, "sync@example.com");
    expect((await phone("PUT", "/api/me/state/bookmarks", { value: [18360], updatedAt: 2000 })).status).toBe(200);
    // An older write (another device that was offline) doesn't clobber it; the reply carries the stored newer value.
    const stale = await phone("PUT", "/api/me/state/bookmarks", { value: [1], updatedAt: 1000 });
    expect(stale.json.stored.value).toEqual([18360]);
    const state = (await phone("GET", "/api/me/state")).json.state;
    expect(state.bookmarks.value).toEqual([18360]);
    expect(state.bookmarks.updatedAt).toBe(2000);
  });

  it("first sign-in merges this device's anonymous data into the account", async () => {
    const call = client();
    await signIn(call, "merge@example.com");
    // The account already has a newer myTeam and a shortlist from elsewhere…
    await call("PUT", "/api/me/state/myTeam", { value: 4215, updatedAt: 5000 });
    await call("PUT", "/api/me/state/bookmarks", { value: [18360], updatedAt: 5000 });
    // …and the device brings an older myTeam plus its own shortlisted team.
    const r = await call("POST", "/api/me/migrate", {
      state: { myTeam: { value: 10820, updatedAt: 1000 }, bookmarks: { value: [16321], updatedAt: 1500 } },
      scout: [],
    });
    expect(r.status).toBe(200);
    expect(r.json.state.myTeam.value).toBe(4215);                              // newer account value kept
    expect([...r.json.state.bookmarks.value].sort()).toEqual([16321, 18360]); // shortlists united, nothing lost
  });

  it("syncs the shortlist's pick order and notes; an older client's shortlist still works", async () => {
    const laptop = client(), phone = laptop; // one session: the code limiter allows few sign-ins per test run
    await signIn(laptop, "picks@example.com");
    // An older client only knows bookmarks: it writes them, nothing else is needed.
    expect((await phone("PUT", "/api/me/state/bookmarks", { value: [3, 1, 2], updatedAt: 1000 })).status).toBe(200);
    // The new client reorders (bookmarks' order is the pick order) and adds notes.
    expect((await laptop("PUT", "/api/me/state/bookmarks", { value: [2, 3, 1], updatedAt: 2000 })).status).toBe(200);
    const put = await laptop("PUT", "/api/me/state/shortlistNotes", { value: { "2": " first pick ", bad: "x" }, updatedAt: 2000 });
    expect(put.status).toBe(200);
    expect(put.json.stored.value).toEqual({ "2": "first pick" });
    const state = (await phone("GET", "/api/me/state")).json.state;
    expect(state.bookmarks.value).toEqual([2, 3, 1]);
    expect(state.shortlistNotes.value).toEqual({ "2": "first pick" });
    // A device's notes merge into the account on its first sign-in.
    const m = await laptop("POST", "/api/me/migrate", { state: { shortlistNotes: { value: { "3": "defense" }, updatedAt: 500 } }, scout: [] });
    expect(m.json.state.shortlistNotes.value).toEqual({ "2": "first pick", "3": "defense" });
  });

  it("syncs scouting entries and keeps them private to the account", async () => {
    const mine = client(), other = client();
    await signIn(mine, "scout@example.com");
    await signIn(other, "other@example.com");
    const entry = { uuid: "11111111-1111-4111-8111-111111111111", season: 2025, team: 18360, eventCode: "AUBRQ2", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000, deleted: false };
    expect((await mine("POST", "/api/me/scout/sync", { entries: [entry] })).status).toBe(200);
    const back = (await mine("GET", "/api/me/scout")).json.entries;
    expect(back.map((e: any) => e.uuid)).toContain(entry.uuid);
    expect((await other("GET", "/api/me/scout")).json.entries).toEqual([]);
  });

  it("logout ends the session", async () => {
    const call = client();
    await signIn(call, "bye@example.com");
    await call("POST", "/api/auth/logout", {});
    expect((await call("GET", "/api/auth/me")).json.user).toBeNull();
    expect((await call("GET", "/api/me/state")).status).toBe(401);
  });
});
