// Web push (docs/push.md) against the real app on an in-memory database. The push service is always a
// fake (setPushSender): nothing here ever sends a real push. VAPID keys are generated per run and never
// stored anywhere.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import webpush from "web-push";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { deleteUser, sha256 } from "../auth/session";
import { invalidateFlags, setFlag } from "../flags";
import { PRIVATE_TABLES } from "../data/snapshot";
import { PUSH_DAILY_LIMIT, cleanSubscription, uaFamily } from "../../src/shared/push";
import { deliver, isUpset, loadRecipients, pushTick, saveSubscription, setPushSender, type Planned, type SendResult } from "./push";

const VAPID = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
const saved = Object.fromEntries(VAPID.map((k) => [k, process.env[k]]));
let server: Server;
let base = "";

type Sent = { endpoint: string; payload: any; ttl: number };
let sent: Sent[] = [];
let answer: (endpoint: string) => SendResult = () => ({ ok: true });

const ZONE = "America/Chicago";
const MIN = 60_000;

/** Event-local wall time ("2026-10-16T09:15:00", no offset, as FIRST gives it) for an instant in a zone. */
function wall(ms: number, zone = ZONE): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
const localDay = (ms: number, zone = ZONE) => wall(ms, zone).slice(0, 10);

function useKeys() {
  const k = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = k.publicKey;
  process.env.VAPID_PRIVATE_KEY = k.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  setPushSender(null);
  for (const k of VAPID) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});
beforeEach(async () => {
  useKeys();
  sent = [];
  answer = () => ({ ok: true });
  setPushSender(async (sub, payload, ttl) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), ttl }); return answer(sub.endpoint); });
  for (const t of ["push_sent", "push_subscriptions", "user_state", "sessions", "users", "events", "matches", "match_teams", "event_teams", "predictions", "feature_flags"]) await run(`DELETE FROM ${t}`);
  invalidateFlags();
});
afterEach(() => invalidateFlags());

// --- helpers ---------------------------------------------------------------------------------------

let n = 0;
async function account(state: { myTeam?: number | null; teams?: number[]; events?: string[]; notify?: Record<string, boolean> } = {}) {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [`u${++n}@example.com`, new Date().toISOString()]);
  const id = Number(u!.id);
  const t = `tok-${n}-${Math.random()}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  const put = (key: string, value: unknown) => run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)", [id, key, JSON.stringify(value), Date.now()]);
  await put("myTeam", state.myTeam ?? null);
  await put("tracked", { teams: state.teams ?? [], events: state.events ?? [] });
  await put("settings", { theme: "dark", density: "comfortable", ambient: true, notify: { myTeamMatches: true, trackedTeams: true, upsets: true, eventStart: true, ...state.notify } });
  return { id, cookie: `cs_session=${t}` };
}

const p256dh = Buffer.alloc(65, 4).toString("base64url"), auth = Buffer.alloc(16, 7).toString("base64url");
const subFor = (tag: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${tag}`, keys: { p256dh, auth } });
async function subscribe(userId: number, tag: string, createdAt = Date.now() - 3600_000) {
  await saveSubscription(userId, subFor(tag), "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36", createdAt);
  return subFor(tag).endpoint;
}

async function event(code: string, o: { start?: string; zone?: string | null; teams?: number[] } = {}) {
  const now = Date.now();
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, source) VALUES (2025, ?, ?, 'Qualifier', ?, ?, ?, 'first')",
    [code, `${code} Qualifier`, o.start ?? localDay(now), o.start ?? localDay(now), o.zone === undefined ? ZONE : o.zone]);
  for (const t of o.teams ?? []) await run("INSERT INTO event_teams (season, code, team) VALUES (2025, ?, ?)", [code, t]);
}
async function match(code: string, number: number, o: { time: string | null; red: number[]; blue: number[]; played?: boolean }) {
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (2025, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, 'first')",
    [code, number, `Q${number}`, o.time, o.played ? 1 : 0, o.played ? 100 : null, o.played ? 50 : null]);
  for (const [alliance, teams] of [["red", o.red], ["blue", o.blue]] as const) {
    for (const t of teams) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, 'qual', 0, ?, ?, ?)", [code, number, t, alliance]);
  }
}
async function ledger(code: string, number: number, o: { pRed: number; outcome: number | null; scoredAt?: number; kind?: string; red?: number[]; blue?: number[] }) {
  await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, red_score, blue_score, outcome, scored_at)
             VALUES (?, 2025, ?, 'qual', 0, ?, ?, ?, ?, 100, 90, 'High', 'test', ?, ?, ?, ?, ?)`,
    [o.kind ?? "live", code, number, JSON.stringify(o.red ?? [1, 2]), JSON.stringify(o.blue ?? [3, 4]), o.pRed, new Date(Date.now() - 3600_000).toISOString(),
      o.outcome == null ? null : o.outcome === 1 ? 120 : o.outcome === 0 ? 80 : 100, o.outcome == null ? null : o.outcome === 1 ? 80 : o.outcome === 0 ? 120 : 100,
      o.outcome, o.outcome == null ? null : new Date(o.scoredAt ?? Date.now() - MIN).toISOString()]);
}

const api = (path: string, init: { method?: string; cookie?: string; body?: unknown; type?: string } = {}) =>
  fetch(`${base}/api/push${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "Content-Type": init.type ?? "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}), "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), cache: r.headers.get("cache-control") }));

// --- tests ------------------------------------------------------------------------------------------

describe("subscription API", () => {
  it("serves the public key only, and says unavailable when the VAPID settings are missing", async () => {
    const on = await api("/config");
    expect(on.status).toBe(200);
    expect(on.json).toEqual({ available: true, publicKey: process.env.VAPID_PUBLIC_KEY });
    expect(JSON.stringify(on.json)).not.toContain(process.env.VAPID_PRIVATE_KEY!);
    delete process.env.VAPID_PRIVATE_KEY;
    expect((await api("/config")).json).toEqual({ available: false, publicKey: null });
  });

  it("needs a signed-in account, JSON and a valid subscription", async () => {
    const a = await account();
    expect((await api("/subscriptions", { method: "POST", body: subFor("x") })).status).toBe(401);
    expect((await api("/subscriptions", { method: "POST", cookie: a.cookie, body: "endpoint=x", type: "application/x-www-form-urlencoded" })).status).toBe(415);
    for (const bad of [{}, { endpoint: "http://fcm.googleapis.com/fcm/send/x", keys: { p256dh, auth } }, { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "short", auth } },
      { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh, auth: Buffer.alloc(8).toString("base64url") } }, { endpoint: `https://fcm.googleapis.com/${"x".repeat(1000)}`, keys: { p256dh, auth } },
      // Only the browsers' push services: the server POSTs to the endpoint, so never an address a user picked.
      { endpoint: "https://internal.example.com/admin", keys: { p256dh, auth } }, { endpoint: "https://fcm.googleapis.com:8443/fcm/send/x", keys: { p256dh, auth } }]) {
      expect((await api("/subscriptions", { method: "POST", cookie: a.cookie, body: bad })).status).toBe(400);
    }
    expect(await all("SELECT * FROM push_subscriptions")).toEqual([]);
  });

  it("stores endpoint, keys and the browser family only; delete removes it, and only for its own account", async () => {
    const a = await account(), b = await account();
    const r = await api("/subscriptions", { method: "POST", cookie: a.cookie, body: subFor("a") });
    expect(r).toMatchObject({ status: 200, json: { ok: true }, cache: "no-store" });
    const [row] = await all<any>("SELECT * FROM push_subscriptions");
    expect(row).toMatchObject({ user_id: a.id, endpoint: subFor("a").endpoint, p256dh, auth, ua_family: "Safari on iOS", last_success_at: null });
    expect((await api("/subscriptions/check", { method: "POST", cookie: a.cookie, body: { endpoint: subFor("a").endpoint } })).json).toEqual({ subscribed: true });
    expect((await api("/subscriptions/check", { method: "POST", cookie: b.cookie, body: { endpoint: subFor("a").endpoint } })).json).toEqual({ subscribed: false });
    // Someone else can't remove it.
    expect((await api("/subscriptions", { method: "DELETE", cookie: b.cookie, body: { endpoint: subFor("a").endpoint } })).json).toEqual({ ok: true, removed: false });
    expect(await all("SELECT id FROM push_subscriptions")).toHaveLength(1);
    expect((await api("/subscriptions", { method: "DELETE", body: { endpoint: subFor("a").endpoint } })).status).toBe(401);
    expect((await api("/subscriptions", { method: "DELETE", cookie: a.cookie, body: {} })).status).toBe(400);
    expect((await api("/subscriptions", { method: "DELETE", cookie: a.cookie, body: { endpoint: subFor("a").endpoint } })).json).toEqual({ ok: true, removed: true });
    expect(await all("SELECT id FROM push_subscriptions")).toEqual([]);
  });

  it("refuses new subscriptions while push is unavailable (no keys, or the owner's switch off)", async () => {
    const a = await account();
    await setFlag("push", false, "test");
    expect((await api("/subscriptions", { method: "POST", cookie: a.cookie, body: subFor("a") })).status).toBe(503);
    expect((await api("/config")).json).toEqual({ available: false, publicKey: null });
    await setFlag("push", true, "test");
    delete process.env.VAPID_SUBJECT;
    expect((await api("/subscriptions", { method: "POST", cookie: a.cookie, body: subFor("a") })).status).toBe(503);
  });

  it("a device that changes hands moves to the new account; deleting an account deletes its devices", async () => {
    const a = await account(), b = await account();
    await api("/subscriptions", { method: "POST", cookie: a.cookie, body: subFor("d") });
    await api("/subscriptions", { method: "POST", cookie: b.cookie, body: subFor("d") });
    expect(await all<any>("SELECT user_id FROM push_subscriptions")).toEqual([{ user_id: b.id }]);
    await deleteUser(b.id);
    expect(await all("SELECT * FROM push_subscriptions")).toEqual([]);
  });

  it("writes nothing for an account deleted while its subscribe request was in flight", async () => {
    const a = await account();
    await deleteUser(a.id);
    await saveSubscription(a.id, subFor("late"), "Chrome");
    expect(await all("SELECT * FROM push_subscriptions")).toEqual([]);
  });

  it("keeps push tables out of the public snapshot", () => {
    expect(PRIVATE_TABLES).toEqual(expect.arrayContaining(["push_subscriptions", "push_sent"]));
  });

  it("validates subscriptions and reduces a User-Agent to its browser family", () => {
    expect(cleanSubscription(subFor("ok"))).toEqual(subFor("ok"));
    expect(cleanSubscription({ endpoint: "https://u:p@fcm.googleapis.com/x", keys: { p256dh, auth } })).toBeNull();
    for (const host of ["updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) expect(cleanSubscription({ endpoint: `https://${host}/x`, keys: { p256dh, auth } })).not.toBeNull();
    expect(cleanSubscription({ endpoint: "https://fcm.googleapis.com.evil.example/x", keys: { p256dh, auth } })).toBeNull();
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(uaFamily("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Linux");
    expect(uaFamily("")).toBe("Unknown browser");
  });
});

describe("match reminders", () => {
  it("go out once a tracked team's match is 15 minutes away, once per device, in the event's time zone", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215 });
    const ep = await subscribe(a.id, "a");
    await event("USTXQ1", { teams: [4215] });
    await match("USTXQ1", 1, { time: wall(now + 16 * MIN), red: [4215, 1], blue: [2, 3] });
    // 16 minutes out: not yet.
    expect(await pushTick(now)).toBeNull();
    expect(sent).toEqual([]);
    // A minute later it's 15 minutes out: sent.
    const r = await pushTick(now + MIN);
    expect(r).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ endpoint: ep, payload: { title: "4215 plays Q1 in 15 min", body: "USTXQ1 Qualifier", url: "/events/2025/USTXQ1?tab=matches&match=qual%3A0%3A1", tag: "match:2025:USTXQ1:qual:0:1" } });
    // The next ticks, and a schedule that slips back past 15 minutes and comes round again: still once.
    await pushTick(now + 2 * MIN);
    await run("UPDATE matches SET time = ? WHERE code = 'USTXQ1'", [wall(now + 12 * MIN)]);
    await pushTick(now + 3 * MIN);
    await run("UPDATE matches SET time = ? WHERE code = 'USTXQ1'", [wall(now + 30 * MIN)]);
    await pushTick(now + 4 * MIN);
    await run("UPDATE matches SET time = ? WHERE code = 'USTXQ1'", [wall(now + 20 * MIN)]);
    await pushTick(now + 6 * MIN);
    expect(sent).toHaveLength(1);
    expect(await get<any>("SELECT last_success_at FROM push_subscriptions")).toEqual({ last_success_at: now + MIN });
  });

  it("read the time in the event's zone, not as UTC, and skip matches with no time or zone", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215 });
    await subscribe(a.id, "a");
    // The UTC wall clock 15 minutes ahead, which in Chicago is hours away.
    await event("USTXQ2", { teams: [4215] });
    await match("USTXQ2", 1, { time: new Date(now + 15 * MIN).toISOString().slice(0, 19), red: [4215, 1], blue: [2, 3] });
    // No zone, and no time.
    await event("NOZONE", { zone: null, start: new Date(now).toISOString().slice(0, 10), teams: [4215] });
    await match("NOZONE", 1, { time: wall(now + 15 * MIN), red: [4215, 1], blue: [2, 3] });
    await match("USTXQ2", 2, { time: null, red: [4215, 1], blue: [2, 3] });
    // An explicit offset is honoured as given.
    await match("USTXQ2", 3, { time: new Date(now + 14 * MIN).toISOString(), red: [4215, 1], blue: [2, 3] });
    await pushTick(now);
    expect(sent.map((s) => s.payload.tag)).toEqual(["match:2025:USTXQ2:qual:0:3"]);
  });

  it("cover tracked teams too, one push when several of yours share a match, with the logged odds", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215, teams: [33950] });
    await subscribe(a.id, "a");
    await event("USTXQ3", { teams: [4215, 33950] });
    await match("USTXQ3", 4, { time: wall(now + 10 * MIN), red: [4215, 33950], blue: [2, 3] });
    await ledger("USTXQ3", 4, { pRed: 0.73, outcome: null });
    await pushTick(now);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: "4215 and 33950 play Q4 in 10 min", body: "USTXQ3 Qualifier · 4215 73% to win (High confidence)" });
  });

  it("honour the per-type switches", async () => {
    const now = Date.now();
    const off = await account({ myTeam: 4215, notify: { myTeamMatches: false } });
    const trackedOff = await account({ teams: [4215], notify: { trackedTeams: false } });
    const trackedOn = await account({ teams: [4215] });
    await subscribe(off.id, "off"); await subscribe(trackedOff.id, "trackedOff"); await subscribe(trackedOn.id, "trackedOn");
    await event("USTXQ4", { teams: [4215] });
    await match("USTXQ4", 1, { time: wall(now + 15 * MIN), red: [4215, 1], blue: [2, 3] });
    await pushTick(now);
    expect(sent.map((s) => s.endpoint)).toEqual([subFor("trackedOn").endpoint]);
  });
});

describe("upsets", () => {
  it("match the live ledger: the side we gave 65% or more lost, at an event the account follows", async () => {
    expect(isUpset(0.65, 0)).toBe(true);
    expect(isUpset(0.35, 1)).toBe(true);
    expect(isUpset(0.64, 0)).toBe(false);
    expect(isUpset(0.9, 0.5)).toBe(false);
    expect(isUpset(0.9, 1)).toBe(false);
    const now = Date.now();
    const byEvent = await account({ events: ["2025:USCAQ1"] });
    const byTeam = await account({ teams: [7] });
    const notFollowing = await account({ teams: [999] });
    const switchedOff = await account({ events: ["2025:USCAQ1"], notify: { upsets: false } });
    for (const [x, t] of [[byEvent, "event"], [byTeam, "team"], [notFollowing, "none"], [switchedOff, "off"]] as const) await subscribe(x.id, t);
    await event("USCAQ1", { teams: [7, 1, 2, 3, 4] });
    for (const i of [1, 2, 3, 4, 5]) await match("USCAQ1", i, { time: wall(now - 60 * MIN), red: [1, 2], blue: [3, 4], played: true });
    await ledger("USCAQ1", 1, { pRed: 0.72, outcome: 0 }); // upset
    await ledger("USCAQ1", 2, { pRed: 0.6, outcome: 0 }); // under the threshold
    await ledger("USCAQ1", 3, { pRed: 0.8, outcome: 0.5 }); // a tie
    await ledger("USCAQ1", 4, { pRed: 0.9, outcome: 0, kind: "backtest" }); // not a pre-match call
    await ledger("USCAQ1", 5, { pRed: 0.9, outcome: 0, scoredAt: now - 2 * 3600_000 }); // old news
    await pushTick(now);
    const upsets = () => sent.filter((s) => s.payload.tag.startsWith("upset:"));
    expect(upsets().map((s) => s.endpoint).sort()).toEqual([subFor("event").endpoint, subFor("team").endpoint].sort());
    expect(upsets()[0].payload).toMatchObject({ title: "Upset in Q1 at USCAQ1 Qualifier", body: "3 and 4 beat 1 and 2 120–80. Our call before the match gave them 28% (High confidence).", url: "/events/2025/USCAQ1?tab=matches&match=qual%3A0%3A1" });
    await pushTick(now + MIN);
    expect(upsets()).toHaveLength(2);
  });

  it("aren't sent for upsets scored before the device subscribed", async () => {
    const now = Date.now();
    const a = await account({ events: ["2025:USCAQ2"] });
    await subscribe(a.id, "late", now);
    await event("USCAQ2");
    await match("USCAQ2", 1, { time: wall(now - 60 * MIN), red: [1, 2], blue: [3, 4], played: true });
    await ledger("USCAQ2", 1, { pRed: 0.8, outcome: 0, scoredAt: now - 5 * MIN });
    await pushTick(now);
    expect(sent.filter((s) => s.payload.tag.startsWith("upset:"))).toEqual([]);
  });
});

describe("event starts", () => {
  it("fire once when a followed event's first result is in, or its first scheduled match time passes, on its first day", async () => {
    const now = Date.now();
    const a = await account({ teams: [11] });
    const off = await account({ teams: [11], notify: { eventStart: false } });
    await subscribe(a.id, "a"); await subscribe(off.id, "off");
    // A result is in.
    await event("ST1", { teams: [11] });
    await match("ST1", 1, { time: wall(now - 30 * MIN), red: [11, 1], blue: [2, 3], played: true });
    // No result yet, but the first match should have started.
    await event("ST2", { teams: [11] });
    await match("ST2", 1, { time: wall(now - 5 * MIN), red: [11, 1], blue: [2, 3] });
    // Not started yet.
    await event("ST3", { teams: [11] });
    await match("ST3", 1, { time: wall(now + 30 * MIN), red: [11, 1], blue: [2, 3] });
    // Started, but yesterday was its first day (day 2 of a two-day event).
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, source) VALUES (2025, 'ST4', 'ST4', 'Qualifier', ?, ?, ?, 'first')", [localDay(now - 864e5), localDay(now), ZONE]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'ST4', 11)");
    await match("ST4", 1, { time: wall(now - 864e5), red: [11, 1], blue: [2, 3], played: true });
    // Started, but no time zone: its first local day can't be told, so no start push.
    await event("ST6", { zone: null, start: localDay(now), teams: [11] });
    await match("ST6", 1, { time: wall(now - 30 * MIN), red: [11, 1], blue: [2, 3], played: true });
    // Started, but not followed.
    await event("ST5", { teams: [99] });
    await match("ST5", 1, { time: wall(now - 30 * MIN), red: [99, 1], blue: [2, 3], played: true });
    await pushTick(now);
    expect(sent.map((s) => s.payload.tag).sort()).toEqual(["start:2025:ST1", "start:2025:ST2"]);
    expect(sent.every((s) => s.endpoint === subFor("a").endpoint)).toBe(true);
    expect(sent.find((s) => s.payload.tag === "start:2025:ST1")!.payload).toMatchObject({ title: "ST1 Qualifier has started", url: "/events/2025/ST1" });
    await pushTick(now + MIN);
    expect(sent).toHaveLength(2);
  });
});

describe("delivery", () => {
  it("prunes a subscription the push service says is gone (410, 404)", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215 });
    await subscribe(a.id, "gone"); await subscribe(a.id, "missing"); await subscribe(a.id, "fine");
    answer = (ep) => (ep.endsWith("/gone") ? { ok: false, status: 410, error: "Gone" } : ep.endsWith("/missing") ? { ok: false, status: 404, error: "Not Found" } : { ok: true });
    await event("DL1", { teams: [4215] });
    await match("DL1", 1, { time: wall(now + 15 * MIN), red: [4215, 1], blue: [2, 3] });
    const r = await pushTick(now);
    expect(r).toMatchObject({ sent: 1, pruned: 2 });
    expect(await all<any>("SELECT endpoint FROM push_subscriptions")).toEqual([{ endpoint: subFor("fine").endpoint }]);
    expect(await all<any>("SELECT outcome FROM push_sent")).toEqual([{ outcome: "sent" }]);
  });

  it("retries on the next tick after a busy push service, and never after a refusal", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215 });
    await subscribe(a.id, "busy"); await subscribe(a.id, "refused");
    answer = (ep) => (ep.endsWith("/busy") ? { ok: false, status: 503, error: "busy" } : { ok: false, status: 400, error: "bad" });
    await event("DL2", { teams: [4215] });
    await match("DL2", 1, { time: wall(now + 15 * MIN), red: [4215, 1], blue: [2, 3] });
    expect(await pushTick(now)).toMatchObject({ retry: 1, failed: 1 });
    answer = () => ({ ok: true });
    expect(await pushTick(now + MIN)).toMatchObject({ sent: 1 });
    expect(sent.filter((s) => s.endpoint.endsWith("/refused"))).toHaveLength(1);
    expect(sent.filter((s) => s.endpoint.endsWith("/busy"))).toHaveLength(2);
  });

  it(`stops at ${PUSH_DAILY_LIMIT} a day per device`, async () => {
    const a = await account({ myTeam: 1 });
    await subscribe(a.id, "lots");
    const [sub] = await loadRecipients();
    const plans: Planned[] = Array.from({ length: PUSH_DAILY_LIMIT + 3 }, (_, i) => ({ sub, kind: "upset", subject: `2025:X:qual:0:${i}`, expiresAt: Date.now() + 10 * 864e5, payload: () => ({ title: "t", body: "b", url: "/", tag: `t${i}` }) }));
    const r = await deliver(plans, Date.now());
    expect(r).toMatchObject({ sent: PUSH_DAILY_LIMIT, limited: 3 });
    // Limited ones are logged and never sent later.
    expect((await deliver(plans, Date.now() + 2 * 864e5)).sent).toBe(0);
  });

  it("holds the daily cap across servers sending at the same time, counting pushes in flight", async () => {
    const a = await account({ myTeam: 1 });
    await subscribe(a.id, "busy-day");
    const [sub] = await loadRecipients();
    const now = Date.now();
    for (let i = 0; i < PUSH_DAILY_LIMIT - 1; i++) await run("INSERT INTO push_sent (subscription_id, kind, subject, at, outcome) VALUES (?, 'upset', ?, ?, 'sent')", [sub.id, `earlier:${i}`, now - 3600_000]);
    // A slow push service, so both "servers" are mid-send together.
    setPushSender(async (s, payload, ttl) => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), ttl }); await new Promise((r) => setTimeout(r, 200)); return { ok: true }; });
    const plan = (subject: string): Planned => ({ sub, kind: "upset", subject, expiresAt: now + 3600_000, payload: () => ({ title: subject, body: "", url: "/", tag: subject }) });
    const [x, y] = await Promise.all([deliver([plan("a")], now), deliver([plan("b")], now)]);
    expect(x.sent + y.sent).toBe(1);
    expect(x.limited + y.limited).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("drops a plan whose time has passed by the moment of sending, and writes the countdown then", async () => {
    const a = await account({ myTeam: 1 });
    await subscribe(a.id, "slow"); await subscribe(a.id, "late");
    const subs = await loadRecipients();
    const now = Date.now();
    let calls = 0;
    // A slow push service: the first send takes long enough that the second plan has expired.
    setPushSender(async (sub, payload, ttl) => { calls++; sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), ttl }); await new Promise((r) => setTimeout(r, 300)); return { ok: true }; });
    const plan = (sub: (typeof subs)[number], expiresAt: number): Planned => ({ sub, kind: "match", subject: "2025:X:qual:0:1", expiresAt, payload: (at) => ({ title: `in ${Math.round((expiresAt + MIN - at) / MIN)} min`, body: "", url: "/", tag: "t" }) });
    const r = await deliver([plan(subs[0], now + 14 * MIN), plan(subs[1], now + 200)], now);
    expect(r).toMatchObject({ sent: 1, expired: 1 });
    expect(calls).toBe(1);
    expect(sent[0].payload.title).toBe("in 15 min");
    expect(sent[0].ttl).toBeLessThanOrEqual(14 * 60);
    // The expired one left no claim behind.
    expect(await all("SELECT * FROM push_sent WHERE subscription_id = ?", [subs[1].id])).toEqual([]);
  });

  it("a late 'gone' answer never deletes a newer subscription, and ids are never reused", async () => {
    const a = await account({ myTeam: 4215 });
    await subscribe(a.id, "old");
    const [old] = await loadRecipients();
    let release!: () => void;
    setPushSender(async () => { await new Promise<void>((r) => { release = r; }); return { ok: false, status: 410, error: "Gone" }; });
    const p = deliver([{ sub: old, kind: "start", subject: "2025:X", expiresAt: Date.now() + 3600_000, payload: () => ({ title: "t", body: "", url: "/", tag: "t" }) }], Date.now());
    await new Promise((r) => setTimeout(r, 50));
    // Meanwhile the device turns notifications off and on again: a new subscription.
    await api("/subscriptions", { method: "DELETE", cookie: a.cookie, body: { endpoint: old.endpoint } });
    await subscribe(a.id, "new");
    release();
    expect(await p).toMatchObject({ pruned: 1 });
    const rows = await all<any>("SELECT id, endpoint FROM push_subscriptions");
    expect(rows).toEqual([{ id: expect.any(Number), endpoint: subFor("new").endpoint }]);
    expect(rows[0].id).not.toBe(old.id);
  });

  it("stays dormant with the VAPID settings unset or the owner's switch off: nothing is planned or sent", async () => {
    const now = Date.now();
    const a = await account({ myTeam: 4215 });
    await subscribe(a.id, "a");
    await event("DL3", { teams: [4215] });
    await match("DL3", 1, { time: wall(now + 15 * MIN), red: [4215, 1], blue: [2, 3] });
    for (const k of VAPID) delete process.env[k];
    expect(await pushTick(now)).toBeNull();
    useKeys();
    await setFlag("push", false, "test");
    expect(await pushTick(now)).toBeNull();
    expect(sent).toEqual([]);
    expect(await all("SELECT * FROM push_sent")).toEqual([]);
    await setFlag("push", true, "test");
    expect(await pushTick(now)).toMatchObject({ sent: 1 });
  });
});
