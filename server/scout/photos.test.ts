// Entry photos end to end against the in-process stand-in for R2 (fakeR2.ts,
// R2_FAKE=1: never the real bucket) and a stub Control Point: membership on
// every route, the per-entry and size limits, the soft cap under racing
// uploads, recording only what's really in storage, removal rules, live
// publishing, the nightly expiry and the 7/9 GB guardrails with the owner alert.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { subscribe, type LiveEntry } from "./bus";
import { fakeR2 } from "./fakeR2";
import { expiresAt, MAY_NOT_REMOVE, NOT_SYNCED, runPhotoMaintenance, sweepStaleReservations, TOO_MANY } from "./photos";
import { PHOTO_LIMITS, STORAGE_FULL } from "../../src/shared/photos";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();
const DAY = 864e5;

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 3000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL", "R2_FAKE", "R2_ENDPOINT", "R2_SOFT_CAP_GB", "OWNER_EMAILS", "R2_FAKE_DIR"];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => { if (req.get("X-Internal-Key") !== KEY) { res.status(401).end(); return; } next(); });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: accountFor(String(req.body.email).toLowerCase()) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    const a = [...accounts.values()].find((x) => x.id === Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ account: a });
  });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
  cp = stub.listen(0);
  await new Promise((r) => cp.once("listening", r));
  cpBase = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;

  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  delete process.env.R2_FAKE_DIR;
  process.env.R2_FAKE = "1"; // before createApp: it mounts the stand-in
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
beforeEach(async () => {
  clearInfoCache();
  Object.assign(process.env, {
    CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1",
    R2_FAKE: "1", R2_ENDPOINT: `${base}/__fake-r2`, OWNER_EMAILS: "owner@example.com",
  });
  delete process.env.R2_SOFT_CAP_GB;
  await setFlag("photos", true, "test");
  await setFlag("workspaceScouting", true, "test");
  await run("DELETE FROM entry_photos");
  await run("DELETE FROM owner_alerts");
  fakeR2.clear();
});
afterEach(() => { invalidateFlags(); });

let clients = 0;
function client() {
  let cookie = "";
  // Each test person signs in from their own address (sign-in is rate limited per IP).
  const ip = `10.9.${Math.floor(++clients / 250)}.${clients % 250}`;
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, redirect: "manual", headers: { "X-Forwarded-For": ip, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: r.status, json: body, headers: r.headers };
  };
  return call;
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `p${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: null, kind: "pit", data: { drivetrain: "Mecanum" }, notes: "clean wiring", updatedAt: 1000 + n, ...over });
const push = async (call: Call, ws: string, e: Record<string, unknown>) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries: [e] });
  expect(r.status).toBe(200);
  return r.json.results[0].entry;
};
const jpeg = (size: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(Math.max(0, size - 4), 7)]);

/** The whole upload: presign, PUT to storage, complete. */
async function upload(call: Call, ws: string, uuid: string, size = 2000, opts: { put?: Buffer | null } = {}) {
  const slot = await call("POST", "/api/scout/photos/presign", { workspaceId: ws, entryUuid: uuid, bytes: size });
  if (slot.status !== 200) return { slot, done: null as any };
  const body = opts.put === undefined ? jpeg(size) : opts.put;
  if (body) {
    const put = await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body });
    // The URL is signed for exactly the reserved size: storage refuses any other.
    expect(put.status).toBe(body.length === size ? 200 : 403);
  }
  const done = await call("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: ws });
  return { slot, done };
}

/** The owner (OWNER_EMAILS), signed in once: a second code for the same address would wait out the cooldown. */
let ownerCall: Call | null = null;
const asOwner = async () => (ownerCall ??= await signIn("owner@example.com"));

let wsN = 0;
/** A fresh workspace with an admin (Ada), two members (Ben, Cy), and an outsider (Dee, in another workspace). */
async function team() {
  const ws = `ws${++wsN}`;
  const mk = async (who: string, role: "admin" | "member", space = ws) => {
    const email = `${who.toLowerCase()}${wsN}@example.com`;
    accountFor(email).workspaces = [{ id: space, name: "Team", role }];
    return { call: await signIn(email, who), id: accountFor(email).id };
  };
  return { ws, ada: await mk("Ada", "admin"), ben: await mk("Ben", "member"), cy: await mk("Cy", "member"), dee: await mk("Dee", "admin", `${ws}-other`) };
}

describe("entry photos: availability", () => {
  it("R2 unset: every photo route 404s and the app is told photos are off", async () => {
    const t = await team();
    const e = await push(t.ben.call, t.ws, entry());
    expect((await t.ben.call("GET", "/api/flags")).json.flags.photos).toBe(true);
    delete process.env.R2_FAKE;
    expect((await t.ben.call("GET", "/api/flags")).json.flags.photos).toBe(false);
    for (const [m, p] of [["POST", "/api/scout/photos/presign"], ["POST", "/api/scout/photos/00000000-0000-0000-0000-000000000000/complete"], ["DELETE", `/api/scout/photos/00000000-0000-0000-0000-000000000000?workspaceId=${t.ws}`], ["GET", `/api/scout/photos/00000000-0000-0000-0000-000000000000?workspaceId=${t.ws}`]] as const) {
      const r = await t.ben.call(m, p, m === "POST" ? { workspaceId: t.ws, entryUuid: e.uuid, bytes: 10 } : undefined);
      expect(r.status).toBe(404);
    }
    // Entries carry no photos and nothing else changes.
    expect((await t.ben.call("GET", `/api/scout/sync?workspaceId=${t.ws}`)).json.entries[0]).toMatchObject({ uuid: e.uuid, photos: [], photoExpired: false });
  });

  it("the photos switch off: 404 too, and the app hides photos", async () => {
    const t = await team();
    const e = await push(t.ben.call, t.ws, entry());
    await setFlag("photos", false, "test");
    expect((await t.ben.call("GET", "/api/flags")).json.flags.photos).toBe(false);
    expect((await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 10 })).status).toBe(404);
  });

  it("refuses to sign anything for a non-local endpoint under test, real secrets or not", async () => {
    delete process.env.R2_FAKE;
    Object.assign(process.env, { R2_ACCESS_KEY_ID: "x", R2_SECRET_ACCESS_KEY: "y", R2_BUCKET: "control-scout-photos", R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com" });
    try {
      const { r2 } = await import("./r2");
      expect(r2()).toBeNull();
    } finally { for (const k of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k]; }
  });
});

describe("entry photos: upload", () => {
  it("presign needs a signed-in member and a synced entry", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry());
    expect((await client()("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 10 })).status).toBe(401);
    const outsider = await t.dee.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 10 });
    expect(outsider.status).toBe(403);
    // The outsider's own workspace doesn't reach this entry either.
    expect((await t.dee.call("POST", "/api/scout/photos/presign", { workspaceId: `${t.ws}-other`, entryUuid: e.uuid, bytes: 10 })).json.error).toBe(NOT_SYNCED);
    expect((await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: "pnotsynced000", bytes: 10 })).json.error).toBe(NOT_SYNCED);
    expect(await all("SELECT * FROM entry_photos")).toEqual([]);
    expect(fakeR2.keys()).toEqual([]);
  });

  it("a member adds a photo to someone else's pit entry: stored under the event's key, recorded with its size, viewable", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry());
    const { slot, done } = await upload(t.ben.call, t.ws, e.uuid, 3000);
    expect(slot.status).toBe(200);
    expect(slot.json.uploadUrl).toContain("/__fake-r2/control-scout-photos/photos/2025/USNJQ1/");
    expect(done.status).toBe(200);
    expect(done.json.entry).toMatchObject({ uuid: e.uuid, notes: "clean wiring", photoExpired: false, photosRev: 1,
      photos: [{ id: slot.json.photoId, bytes: 3000, addedByAccountId: t.ben.id, addedByName: "Ben", expired: false }] });
    expect(fakeR2.keys()).toEqual([`photos/2025/USNJQ1/${e.uuid}/${slot.json.photoId}.jpg`]);
    const row = await get<any>("SELECT status, bytes FROM entry_photos WHERE id = ?", [slot.json.photoId]);
    expect({ ...row }).toEqual({ status: "ready", bytes: 3000 });
    // Members see it through a short-lived signed link; the outsider doesn't.
    const view = await t.cy.call("GET", `/api/scout/photos/${slot.json.photoId}?workspaceId=${t.ws}`);
    expect(view.status).toBe(302);
    expect(view.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    const img = await fetch(view.headers.get("location")!);
    expect(img.status).toBe(200);
    expect(Buffer.from(await img.arrayBuffer()).length).toBe(3000);
    expect((await t.dee.call("GET", `/api/scout/photos/${slot.json.photoId}?workspaceId=${t.ws}`)).status).toBe(403);
    // A tampered link doesn't open anything.
    const bad = new URL(view.headers.get("location")!);
    bad.searchParams.set("X-Amz-Expires", "999999");
    expect((await fetch(bad)).status).toBe(403);
    // The text edit that follows keeps the photo (photos are the server's).
    const edited = await push(t.ada.call, t.ws, { ...entry(), uuid: e.uuid, notes: "rewired", updatedAt: 9_000 });
    expect(edited).toMatchObject({ notes: "rewired", photos: [{ id: slot.json.photoId }] });
  });

  it("records only what's really in storage, and only as large as declared", async () => {
    const t = await team();
    const e = await push(t.ben.call, t.ws, entry());
    const status = async (id: string) => (await get<any>("SELECT status FROM entry_photos WHERE id = ?", [id]))?.status;
    // Completed before uploading: refused, and the reservation stays counted while its URL still works.
    const missing = await upload(t.ben.call, t.ws, e.uuid, 1000, { put: null });
    expect(missing.done.status).toBe(409);
    expect(await status(missing.slot.json.photoId)).toBe("pending");
    // The upload landing afterwards is tracked by that reservation: completing again records it.
    expect((await fetch(missing.slot.json.uploadUrl, { method: "PUT", headers: missing.slot.json.headers, body: jpeg(1000) })).status).toBe(200);
    expect((await t.ben.call("POST", `/api/scout/photos/${missing.slot.json.photoId}/complete`, { workspaceId: t.ws })).status).toBe(200);
    // A body larger than reserved never gets stored (the size is signed), so there's nothing to record.
    const bigger = await upload(t.ben.call, t.ws, e.uuid, 1000, { put: jpeg(5000) });
    expect(bigger.done.status).toBe(409);
    expect(fakeR2.keys()).toHaveLength(1);
    expect(await status(bigger.slot.json.photoId)).toBe("pending");
    await t.ben.call("DELETE", `/api/scout/photos/${missing.slot.json.photoId}?workspaceId=${t.ws}`);
    // Nor can a finished upload's URL be used again to swap in a larger image.
    const ok = await upload(t.ben.call, t.ws, e.uuid, 1000);
    expect(ok.done.status).toBe(200);
    expect((await fetch(ok.slot.json.uploadUrl, { method: "PUT", headers: ok.slot.json.headers, body: jpeg(900_000) })).status).toBe(403);
    expect((await fetch(ok.slot.json.uploadUrl, { method: "PUT", headers: { ...ok.slot.json.headers, "Content-Length": "900000" }, body: jpeg(1000) }).catch(() => ({ status: 0 }))).status).not.toBe(200);
    expect(Number((await get<any>("SELECT bytes FROM entry_photos WHERE id = ?", [ok.slot.json.photoId]))!.bytes)).toBe(1000);
    await t.ben.call("DELETE", `/api/scout/photos/${ok.slot.json.photoId}?workspaceId=${t.ws}`);
    // Only the uploader finishes an upload.
    const slot = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 100 });
    await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body: jpeg(100) });
    expect((await t.cy.call("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: t.ws })).status).toBe(403);
    // An upload URL is for a JPEG only: another content type doesn't match its signature.
    expect((await fetch(slot.json.uploadUrl, { method: "PUT", headers: { "Content-Type": "text/html" }, body: "<b>x</b>" })).status).toBe(403);
  });

  it("size and count limits: over the size refused up front, a 7th photo refused", async () => {
    const t = await team();
    const e = await push(t.ben.call, t.ws, entry());
    const big = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: PHOTO_LIMITS.maxBytes + 1 });
    expect(big.status).toBe(413);
    for (let i = 0; i < PHOTO_LIMITS.perEntry; i++) expect((await upload(t.ben.call, t.ws, e.uuid, 500)).done.status).toBe(200);
    const seventh = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 500 });
    expect(seventh.status).toBe(409);
    expect(seventh.json.error).toBe(TOO_MANY);
    const pulled = (await t.cy.call("GET", `/api/scout/sync?workspaceId=${t.ws}`)).json.entries.find((x: any) => x.uuid === e.uuid);
    expect(pulled.photos).toHaveLength(6);
  });

  it("the soft cap refuses with the friendly message, and racing uploads can't both take the last space", async () => {
    const t = await team();
    const e1 = await push(t.ben.call, t.ws, entry());
    const e2 = await push(t.ben.call, t.ws, entry());
    process.env.R2_SOFT_CAP_GB = "0.000001"; // 1000 bytes
    const tries = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: i % 2 ? e1.uuid : e2.uuid, bytes: 300 })));
    expect(tries.filter((r) => r.status === 200)).toHaveLength(3);
    const refused = tries.filter((r) => r.status !== 200);
    expect(refused.every((r) => r.status === 507 && r.json.error === STORAGE_FULL)).toBe(true);
    const reserved = await get<{ b: number }>("SELECT SUM(bytes) b FROM entry_photos WHERE status = 'pending'");
    expect(Number(reserved!.b)).toBe(900);
    expect(STORAGE_FULL).toBe("Photo storage is full — ask your admin to free space");
  });
});

describe("entry photos: removal and live updates", () => {
  it("removing deletes the object; members remove their own photos or any on their own entry, admins any", async () => {
    const t = await team();
    const adas = await push(t.ada.call, t.ws, entry());
    const bens = await push(t.ben.call, t.ws, entry());
    const onAdas = (await upload(t.cy.call, t.ws, adas.uuid)).slot.json.photoId; // Cy's photo on Ada's entry
    const cyOnBens = (await upload(t.cy.call, t.ws, bens.uuid)).slot.json.photoId; // Cy's photo on Ben's entry
    const adaOnBens = (await upload(t.ada.call, t.ws, bens.uuid)).slot.json.photoId;
    const del = (call: Call, id: string) => call("DELETE", `/api/scout/photos/${id}?workspaceId=${t.ws}`);
    // Ben: not his photo, not his entry.
    const refused = await del(t.ben.call, onAdas);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe(MAY_NOT_REMOVE);
    expect(fakeR2.keys()).toHaveLength(3);
    // Ben: his own entry, anyone's photo on it.
    expect((await del(t.ben.call, cyOnBens)).status).toBe(200);
    expect((await del(t.ben.call, adaOnBens)).json.entry.photos).toEqual([]);
    // Ada (admin): anything; Dee (another workspace): nothing.
    expect((await del(t.dee.call, onAdas)).status).toBe(403);
    const ok = await del(t.ada.call, onAdas);
    expect(ok.status).toBe(200);
    expect(ok.json.entry.photos).toEqual([]);
    expect(fakeR2.keys()).toEqual([]);
    expect(await all("SELECT * FROM entry_photos")).toEqual([]);
  });

  it("an added and a removed photo reach the workspace's live streams as entry updates", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry());
    const seen: LiveEntry[] = [];
    const stop = subscribe(t.ws, (x) => seen.push(x));
    try {
      const id = (await upload(t.ben.call, t.ws, e.uuid)).slot.json.photoId;
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ uuid: e.uuid, notes: "clean wiring", updatedAt: e.updatedAt, photosRev: 1, photos: [{ id, addedByName: "Ben" }] });
      await t.ada.call("DELETE", `/api/scout/photos/${id}?workspaceId=${t.ws}`);
      expect(seen).toHaveLength(2);
      expect(seen[1]).toMatchObject({ uuid: e.uuid, photosRev: 2, photos: [] });
      expect(seen[1].seq).toBeGreaterThan(seen[0].seq);
      // And a pull from the old cursor brings the change too.
      const pulled = await t.cy.call("GET", `/api/scout/sync?workspaceId=${t.ws}&since=${seen[0].seq - 1}`);
      expect(pulled.json.entries.map((x: any) => x.photosRev)).toEqual([2]);
    } finally { stop(); }
  });
});

describe("entry photos: nightly expiry", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

  it("an event that ended 3 days ago: its photos are deleted, the entry and its text stay, marked photo expired", async () => {
    await run("INSERT OR REPLACE INTO events (season, code, name, start, end, source) VALUES (2025, 'USOLDQ1', 'Old Qualifier', ?, ?, 'first')", [daysAgo(4), daysAgo(3)]);
    await run("INSERT OR REPLACE INTO events (season, code, name, start, end, source) VALUES (2025, 'USNOWQ1', 'This Weekend', ?, ?, 'first')", [daysAgo(2), daysAgo(2)]);
    const t = await team();
    const old = await push(t.ada.call, t.ws, entry({ eventCode: "USOLDQ1" }));
    const recent = await push(t.ada.call, t.ws, entry({ eventCode: "USNOWQ1" }));
    const a = (await upload(t.ben.call, t.ws, old.uuid)).slot.json.photoId;
    const b = (await upload(t.ben.call, t.ws, recent.uuid)).slot.json.photoId;
    const seen: LiveEntry[] = [];
    const stop = subscribe(t.ws, (x) => seen.push(x));
    const r = await runPhotoMaintenance();
    stop();
    expect(r).toMatchObject({ expired: 1, failures: 0 });
    expect(fakeR2.keys()).toEqual([`photos/2025/USNOWQ1/${recent.uuid}/${b}.jpg`]); // ended 2 days ago: kept
    const pulled = (await t.cy.call("GET", `/api/scout/sync?workspaceId=${t.ws}`)).json.entries;
    const o = pulled.find((x: any) => x.uuid === old.uuid);
    expect(o).toMatchObject({ notes: "clean wiring", data: { drivetrain: "Mecanum" }, deleted: false, updatedAt: old.updatedAt, photoExpired: true, photos: [{ id: a, expired: true }] });
    expect(pulled.find((x: any) => x.uuid === recent.uuid)).toMatchObject({ photoExpired: false, photos: [{ id: b, expired: false }] });
    expect(seen.map((x) => [x.uuid, x.photoExpired])).toEqual([[old.uuid, true]]); // streamed to members
    expect((await t.cy.call("GET", `/api/scout/photos/${a}?workspaceId=${t.ws}`)).status).toBe(410);
    // Expired photos no longer count, against the cap or the entry's six.
    expect(Number((await get<any>("SELECT COALESCE(SUM(bytes), 0) b FROM entry_photos WHERE status IN ('pending', 'ready')"))!.b)).toBe(2000);
  });

  it("an event with no known end date: kept for 14 days after upload, then deleted", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry({ eventCode: "NOSUCHEV" }));
    const id = (await upload(t.ben.call, t.ws, e.uuid)).slot.json.photoId;
    expect((await runPhotoMaintenance(Date.now() + 13 * DAY))!.expired).toBe(0);
    expect(fakeR2.keys()).toHaveLength(1);
    expect((await runPhotoMaintenance(Date.now() + 14 * DAY + 60_000))!.expired).toBe(1);
    expect(fakeR2.keys()).toEqual([]);
    expect((await get<any>("SELECT status, expired_reason FROM entry_photos WHERE id = ?", [id]))).toMatchObject({ status: "expired", expired_reason: "event-ended" });
  });

  it("the expiry rule itself: end of the event's last day + 2 days, else upload + 14 days", () => {
    expect(expiresAt("2026-10-10", 0)).toBe(Date.parse("2026-10-13T00:00:00Z"));
    expect(expiresAt(null, 1000)).toBe(1000 + 14 * DAY);
    expect(expiresAt("garbage", 1000)).toBe(1000 + 14 * DAY);
    void today;
  });

  it("a purge racing an upload's completion never leaves a ready photo without its image", async () => {
    await run("INSERT OR REPLACE INTO events (season, code, name, start, end, source) VALUES (2025, 'USRACEQ1', 'Race', ?, ?, 'first')", [daysAgo(1), daysAgo(1)]);
    const t = await team();
    const owner = await asOwner();
    for (let i = 0; i < 4; i++) {
      const e = await push(t.ada.call, t.ws, entry({ eventCode: "USRACEQ1" }));
      const slot = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 500 });
      await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body: jpeg(500) });
      const [done] = await Promise.all([
        t.ben.call("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: t.ws }),
        owner("POST", "/api/owner/storage/purge", { season: 2025, eventCode: "USRACEQ1", confirm: true }),
      ]);
      const row = await get<any>("SELECT status, object_key FROM entry_photos WHERE id = ?", [slot.json.photoId]);
      if (row?.status === "ready") expect(fakeR2.has(row.object_key)).toBe(true);
      else expect([200, 409, 410]).toContain(done.status);
    }
    expect((await all<any>("SELECT object_key FROM entry_photos WHERE status = 'ready'")).every((r) => fakeR2.has(r.object_key))).toBe(true);
  });

  it("an owner purge also cancels unfinished uploads of the event: object gone, reservation released, completion refused", async () => {
    const t = await team();
    const owner = await asOwner();
    const e = await push(t.ada.call, t.ws, entry({ eventCode: "USPENDQ1" }));
    const slot = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 700 });
    await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body: jpeg(700) });
    const purged = await owner("POST", "/api/owner/storage/purge", { season: 2025, eventCode: "USPENDQ1", confirm: true });
    expect(purged.json.purged).toEqual({ photos: 1, bytes: 700, failures: 0 });
    expect(fakeR2.keys()).toEqual([]);
    // Cancelled, not forgotten: its URL may still work for a few minutes, so its bytes stay counted.
    expect((await get<any>("SELECT status, bytes FROM entry_photos WHERE id = ?", [slot.json.photoId]))).toMatchObject({ status: "cancelled", bytes: 700 });
    expect((await t.ben.call("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: t.ws })).status).toBe(409);
    // A PUT on the still-live URL lands under that counted reservation; the sweep removes it once the URL is long dead.
    expect((await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body: jpeg(700) })).status).toBe(200);
    expect((await sweepStaleReservations(Date.now() + 31 * 60_000)).removed).toBe(1);
    expect(fakeR2.keys()).toEqual([]);
    expect(await all("SELECT * FROM entry_photos")).toEqual([]);
  });

  it("an entry moved to another event moves its photos' expiry with it", async () => {
    await run("INSERT OR REPLACE INTO events (season, code, name, start, end, source) VALUES (2025, 'USOLD2Q1', 'Old', ?, ?, 'first')", [daysAgo(10), daysAgo(10)]);
    await run("INSERT OR REPLACE INTO events (season, code, name, start, end, source) VALUES (2025, 'USNEXTQ1', 'Next', ?, ?, 'first')", [daysAgo(-5), daysAgo(-5)]);
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry({ eventCode: "USOLD2Q1" }));
    const id = (await upload(t.ben.call, t.ws, e.uuid)).slot.json.photoId;
    await push(t.ada.call, t.ws, { ...entry(), uuid: e.uuid, eventCode: "USNEXTQ1", updatedAt: 90_000 }); // corrected
    expect((await runPhotoMaintenance())!.expired).toBe(0);
    expect(await get<any>("SELECT status, event_code, event_end FROM entry_photos WHERE id = ?", [id])).toMatchObject({ status: "ready", event_code: "USNEXTQ1", event_end: daysAgo(-5) });
  });

  it("a stored object larger than its record is deleted by the nightly listing", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry());
    const { slot } = await upload(t.ben.call, t.ws, e.uuid, 1000);
    const key = (await get<any>("SELECT object_key FROM entry_photos WHERE id = ?", [slot.json.photoId]))!.object_key;
    fakeR2.put(key, jpeg(50_000)); // as if storage had let a larger body through
    const r = await runPhotoMaintenance();
    expect(r).toMatchObject({ orphans: 1, bucketBytes: 0 });
    expect(fakeR2.keys()).toEqual([]);
    expect(await all("SELECT * FROM entry_photos")).toEqual([]);
  });

  it("cleans up what nothing points at: deleted entries' photos, abandoned uploads, untracked objects", async () => {
    const t = await team();
    const e = await push(t.ada.call, t.ws, entry());
    await upload(t.ben.call, t.ws, e.uuid);
    await push(t.ada.call, t.ws, { ...entry(), uuid: e.uuid, deleted: true, updatedAt: 50_000 });
    await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: (await push(t.ben.call, t.ws, entry())).uuid, bytes: 10 }); // never uploaded
    fakeR2.put("photos/2025/X/stray000000/stray.jpg", jpeg(10));
    const r = await runPhotoMaintenance(Date.now() + 7 * 3600_000);
    expect(r).toMatchObject({ removed: 2, orphans: 1, bucketObjects: 0, bucketBytes: 0, usedBytes: 0 });
    expect(fakeR2.keys()).toEqual([]);
    expect(await all("SELECT * FROM entry_photos")).toEqual([]);
  });
});

describe("entry photos: storage guardrails", () => {
  /** Pretend this many bytes are stored (records only: the meter reads the records). */
  async function fill(t: { ws: string; ada: { call: Call } }, bytes: number) {
    const e = await push(t.ada.call, t.ws, entry({ eventCode: "USBIGQ1" }));
    const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [t.ws]);
    await run(`INSERT INTO entry_photos (id, workspace_id, entry_uuid, season, event_code, object_key, bytes, status, added_by_account_id, created_at, expires_at)
      VALUES (?, ?, ?, 2025, 'USBIGQ1', ?, ?, 'ready', 1, ?, ?)`, [`fill-${bytes}`, ws!.id, e.uuid, `photos/2025/USBIGQ1/${e.uuid}/fill-${bytes}.jpg`, bytes, Date.now(), Date.now() + 10 * DAY]);
    return e;
  }

  it("7 GB: an info notice; 9 GB: the warning and one owner alert; 9.5 GB: uploads refused; back under: resolved", async () => {
    const owner = await asOwner();
    const t = await team();
    const storage = async () => (await owner("GET", "/api/owner/storage")).json;
    const e = await fill(t, 7.2e9);
    expect(await storage()).toMatchObject({ configured: true, enabled: true, level: "notice", usedBytes: 7.2e9, alert: null });
    expect(await all("SELECT * FROM owner_alerts")).toEqual([]);

    await run("UPDATE entry_photos SET bytes = 9.1e9");
    const warn = await storage();
    expect(warn).toMatchObject({ level: "warning", alert: { kind: "photo-storage", level: "warning", resolvedAt: null } });
    expect(warn.alert.body).toMatch(/^Photo storage approaching the 10 GB free tier limit — purge an event or uploads will pause/);
    expect(warn.events).toEqual([expect.objectContaining({ season: 2025, eventCode: "USBIGQ1", photos: 1, bytes: 9.1e9 })]);
    // Asked again (or by the nightly job): still one alert, not a pile.
    await storage(); await runPhotoMaintenance();
    expect(await all("SELECT * FROM owner_alerts WHERE resolved_at IS NULL")).toHaveLength(1);
    // Still under the cap: a small upload goes in.
    expect((await upload(t.ben.call, t.ws, e.uuid, 1000)).done.status).toBe(200);

    await run("UPDATE entry_photos SET bytes = 9.5e9 WHERE id = 'fill-7200000000'");
    expect((await storage()).level).toBe("full");
    const refused = await t.ben.call("POST", "/api/scout/photos/presign", { workspaceId: t.ws, entryUuid: e.uuid, bytes: 1000 });
    expect(refused).toMatchObject({ status: 507, json: { error: STORAGE_FULL } });

    // The owner purges the event (confirmation required, audited): under the warning again, alert resolved.
    expect((await owner("POST", "/api/owner/storage/purge", { season: 2025, eventCode: "USBIGQ1" })).status).toBe(400);
    const purged = await owner("POST", "/api/owner/storage/purge", { season: 2025, eventCode: "USBIGQ1", confirm: true });
    expect(purged.status).toBe(200);
    expect(purged.json.storage).toMatchObject({ level: "ok", alert: null });
    expect(await all("SELECT * FROM owner_alerts WHERE resolved_at IS NULL")).toEqual([]);
    expect((await get<any>("SELECT action, details FROM owner_audit ORDER BY id DESC LIMIT 1"))).toMatchObject({ action: "storage.purge" });
    // Uploads are welcome again; the purged entry shows its photos as expired.
    expect((await upload(t.ben.call, t.ws, e.uuid, 1000)).done.json.entry).toMatchObject({ photoExpired: true });
  });

  it("the storage panel is the owner's alone", async () => {
    const t = await team();
    expect((await t.ada.call("GET", "/api/owner/storage")).status).toBe(404);
    expect((await t.ada.call("POST", "/api/owner/storage/purge", { season: 2025, eventCode: "X", confirm: true })).status).toBe(404);
  });
});
