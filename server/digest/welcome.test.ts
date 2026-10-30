// The email digest's welcome email and the owner console's test sends (docs/digest.md), against the real app on an
// in-memory database. The mailer is always a fake (setMailer): nothing here sends a real email.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { setMailer, type MailOptions } from "../auth/email";
import { invalidateFlags, setFlag } from "../flags";
import { localDate } from "../powerRankings/schedule";
import { addDays } from "./build";
import { welcomeEmail } from "./welcome";
import { runDigest } from "./job";
import { slotAt } from "./schedule";

let server: Server;
let base = "";
type Mail = { to: string; subject: string; text: string; html: string; opts?: MailOptions };
let mails: Mail[] = [];
let fail = false;
const savedOwners = process.env.OWNER_EMAILS;

async function user(email: string, follows: { myTeam?: number; tracked?: number[] } = {}, name: string | null = null) {
  const id = Number((await get<{ id: number }>("INSERT INTO users (email, display_name, created_at) VALUES (?, ?, ?) RETURNING id", [email, name, new Date().toISOString()]))!.id);
  if (follows.myTeam) await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'myTeam', ?, 1)", [id, JSON.stringify(follows.myTeam)]);
  if (follows.tracked) await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'tracked', ?, 1)", [id, JSON.stringify({ teams: follows.tracked, events: [] })]);
  const t = randomBytes(16).toString("hex");
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return { id, cookie: `cs_session=${t}` };
}

const api = (path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

/** The welcome goes out without holding up the switch's answer: wait for it. */
async function settle(n: number) {
  for (let i = 0; i < 50 && mails.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 30));
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
  setMailer(null);
  if (savedOwners === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = savedOwners;
});
beforeEach(async () => {
  for (const t of ["digest_sends", "digest_prefs", "user_state", "sessions", "users", "events", "matches", "match_teams", "event_teams", "teams", "feature_flags"]) await run(`DELETE FROM ${t}`);
  invalidateFlags();
  mails = []; fail = false;
  process.env.OWNER_EMAILS = "owner@example.com";
  setMailer(async (to, subject, text, html, opts) => {
    if (fail) throw new Error("email provider error 422: invalid recipient");
    mails.push({ to, subject, text, html, opts });
    return { id: `msg-${mails.length}` };
  });
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Team Duct Tape'), (6980, 'Robo Lions')");
});

describe("the welcome email", () => {
  it("goes out once, the first time an account turns the digest on, with its teams and a one-click unsubscribe", async () => {
    const u = await user("w@example.com", { myTeam: 4215, tracked: [6980] }, "Ada Lovelace");
    const on = await (await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } })).json();
    expect(on.welcomeSent).toBe(true);
    await settle(1);
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.to).toBe("w@example.com");
    expect(m.subject).toBe("Welcome to the Control Scout email digest");
    expect(m.text).toMatch(/^Hi Ada,/);
    expect(m.text).toContain("4215 Team Duct Tape");
    expect(m.text).toContain("6980 Robo Lions");
    expect(m.text).toContain("A few times a week");
    expect(m.text).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}(:\d\d)? ?(AM|PM)/);
    const token = (await get<{ token: string }>("SELECT token FROM digest_prefs WHERE user_id = ?", [u.id]))!.token;
    expect(m.opts?.headers?.["List-Unsubscribe"]).toBe(`<http://localhost:5173/api/digest/unsubscribe?t=${token}>`);
    expect(m.html.match(/<img /g)).toHaveLength(1);
    // Off and on again: no second welcome.
    await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: false } });
    const again = await (await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } })).json();
    expect(again.welcomeSent).toBe(false);
    await settle(2);
    expect(mails).toHaveLength(1);
  });

  it("a failed send is tried again on the next turn-on", async () => {
    const u = await user("f@example.com", { myTeam: 4215 });
    fail = true;
    await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } });
    await settle(1);
    await new Promise((r) => setTimeout(r, 100));
    expect((await get<{ w: string | null }>("SELECT welcomed_at w FROM digest_prefs WHERE user_id = ?", [u.id]))!.w).toBeNull();
    fail = false;
    await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: false } });
    expect((await (await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } })).json()).welcomeSent).toBe(true);
    await settle(1);
    expect(mails.map((m) => m.to)).toEqual(["f@example.com"]);
  });

  it("a failure before the send (reading the teams) also leaves it unsent, so the next turn-on retries", async () => {
    const u = await user("q@example.com", { myTeam: 4215 });
    await run("ALTER TABLE teams RENAME TO teams_away");
    try {
      await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } });
      await new Promise((r) => setTimeout(r, 150));
    } finally { await run("ALTER TABLE teams_away RENAME TO teams"); }
    expect(mails).toHaveLength(0);
    expect((await get<{ w: string | null }>("SELECT welcomed_at w FROM digest_prefs WHERE user_id = ?", [u.id]))!.w).toBeNull();
  });

  it("with no followed teams it says how to pick one; a long list is cut with 'and N more'", () => {
    const links = { site: "https://controlscout.org", unsubscribe: "https://controlscout.org/u", email: "x@example.com" };
    expect(welcomeEmail({ links, name: null, teams: [] }).text).toContain("You don't follow any teams yet");
    const many = welcomeEmail({ links, name: null, teams: Array.from({ length: 13 }, (_, i) => ({ team: 100 + i, teamName: null })) });
    expect(many.text).toContain("and 3 more");
    expect(many.html).toContain("3 more: change who you follow");
    expect(welcomeEmail({ links, name: "<b>", teams: [] }).html).not.toContain("<b>,");
  });
});

describe("the owner console's test sends", () => {
  it("is owner-only", async () => {
    const someone = await user("someone@example.com", { myTeam: 4215 });
    expect((await api("/api/owner/digest", { cookie: someone.cookie })).status).toBe(403);
    expect((await api("/api/owner/digest/send", { method: "POST", cookie: someone.cookie, body: { kind: "digest", confirm: true } })).status).toBe(403);
  });

  it("sends the owner's own digest now, logged like a scheduled one, and the welcome email on request", async () => {
    const o = await user("owner@example.com", { myTeam: 4215 }, "Sushil M");
    const other = await user("member@example.com", { myTeam: 4215 });
    // Something to report: 4215 played yesterday (New York date).
    const yesterday = addDays(localDate(Date.now()), -1);
    await run("INSERT INTO events (season, code, name, start, end, source) VALUES (2026, 'USNJQ9', 'NJ Test Qualifier', ?, ?, 'first')", [yesterday, yesterday]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 'Q1', ?, 1, 100, 50, 'first')", [`${yesterday}T10:00:00`]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 4215, 'red'), (2026, 'USNJQ9', 'qual', 0, 1, 1, 'blue')");

    const before = await (await api("/api/owner/digest", { cookie: o.cookie })).json();
    expect(before).toMatchObject({ available: true, subscribers: 0, mine: { enabled: false, followed: 1 }, lastSend: null });
    expect(Date.parse(before.nextSend)).toBeGreaterThan(Date.now());

    await api("/api/digest", { method: "PUT", cookie: o.cookie, body: { enabled: true } });
    await api("/api/digest", { method: "PUT", cookie: other.cookie, body: { enabled: true } });
    await settle(2);
    mails = [];

    expect((await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "digest" } })).status).toBe(400);
    const r = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "digest", confirm: true } })).json();
    expect(r.result).toMatchObject({ kind: "digest", outcome: "sent" });
    expect(mails.map((m) => m.to)).toEqual(["owner@example.com"]); // never the other subscriber
    expect(mails[0].subject).toContain("Your Control Scout update:");
    expect(mails[0].text).toContain("NJ Test Qualifier");
    expect(r.digest.lastSend.counts).toEqual({ sent: 1 });
    expect(await get("SELECT 1 FROM owner_audit WHERE action = 'digest.send' AND actor = 'owner@example.com'")).toBeTruthy();

    // The welcome email, again on request (the owner has already had one).
    const w = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "welcome", confirm: true } })).json();
    expect(w.result).toMatchObject({ kind: "welcome", outcome: "sent" });
    expect(mails.at(-1)!.subject).toBe("Welcome to the Control Scout email digest");
    expect(mails.at(-1)!.to).toBe("owner@example.com");
  });

  it("test sends still work with scheduled sends switched off", async () => {
    const o = await user("owner@example.com", { myTeam: 4215 });
    await api("/api/digest", { method: "PUT", cookie: o.cookie, body: { enabled: true } });
    await settle(1);
    await setFlag("weeklyDigest", false, "test");
    const d = await (await api("/api/owner/digest", { cookie: o.cookie })).json();
    expect(d).toMatchObject({ available: false, emailReady: true });
    const w = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "welcome", confirm: true } })).json();
    expect(w.result.outcome).toBe("sent");
  });

  it("a test digest and a scheduled send on the same day never both go out (nothing repeats)", async () => {
    const o = await user("owner@example.com", { myTeam: 4215 });
    const other = await user("member@example.com", { myTeam: 4215 });
    const yesterday = addDays(localDate(Date.now()), -1);
    await run("INSERT INTO events (season, code, name, start, end, source) VALUES (2026, 'USNJQ9', 'NJ Test Qualifier', ?, ?, 'first')", [yesterday, yesterday]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 'Q1', ?, 1, 100, 50, 'first')", [`${yesterday}T10:00:00`]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 4215, 'red'), (2026, 'USNJQ9', 'qual', 0, 1, 1, 'blue')");
    for (const u of [o, other]) await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } });
    await settle(2);
    mails = [];
    expect((await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "digest", confirm: true } })).json()).result.outcome).toBe("sent");
    // Later the same day, the scheduled send: the member gets theirs, the owner (already sent today) doesn't.
    const later = slotAt(Date.now() + 60_000);
    const s = await runDigest({ ...later, key: `${later.date}T23:59` }, { gapMs: 0 });
    expect(s).toMatchObject({ sent: 1, already: 1 });
    expect(mails.map((m) => m.to)).toEqual(["owner@example.com", "member@example.com"]);
    // And a second test the same day says so.
    const again = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "digest", confirm: true } })).json();
    expect(again.result.message).toContain("already had a digest today");
  });

  it("says so when the owner's digest is off, or there's nothing to report", async () => {
    const o = await user("owner@example.com", { myTeam: 4215 });
    const off = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "welcome", confirm: true } })).json();
    expect(off.result.outcome).toBe("skipped");
    await api("/api/digest", { method: "PUT", cookie: o.cookie, body: { enabled: true } });
    await settle(1);
    mails = [];
    const empty = await (await api("/api/owner/digest/send", { method: "POST", cookie: o.cookie, body: { kind: "digest", confirm: true } })).json();
    expect(empty.result.outcome).toBe("nothing");
    expect(mails).toHaveLength(0);
  });
});
