// The weekly email digest (docs/digest.md) against the real app on an in-memory database: the brief's fixture
// users A–F, the unsubscribe link, bounce reports and the Monday schedule. The mailer is always a fake (setMailer):
// nothing here sends a real email.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { setMailer, type MailOptions } from "../auth/email";
import { invalidateFlags, setFlag } from "../flags";
import { PRIVATE_TABLES } from "../data/snapshot";
import type { PowerRankingsResponse } from "../../src/shared/powerRankings";
import { buildDigest, sectionsOf } from "./build";
import { digestTick, resetDigestTick, runDigestWeek } from "./job";
import { renderDigest, headline } from "./template";
import { dueWeek, nextSend } from "./schedule";
import { setDigest } from "./prefs";
import { verifyWebhook } from "./routes";

const WEEK = "2026-11-02"; // the Monday it goes out; it reports Oct 26 – Nov 1
const SEASON = 2026;
let server: Server;
let base = "";

type Mail = { to: string; subject: string; text: string; html: string; opts?: MailOptions };
let mails: Mail[] = [];
let failFor = new Set<string>();

// Published Friday Oct 30: inside the reported week. 4215 is #12, up 4; nobody else followed is in it.
const rankings = (published = "2026-10-30"): PowerRankingsResponse => ({
  archive: [],
  week: {
    week: "2026-w44", season: SEASON, title: "Week 44 power rankings", published, updated: null, statsAsOf: null, dataSeason: null, introHtml: "", introText: "", sample: false,
    generated: null, comparedWith: "2026-w43", previous: "2026-w43", next: null, droppedOut: [], worldRankings: "/rankings",
    entries: [
      { rank: 1, team: 100, name: "Alpha", place: null, blurbHtml: "", movement: { kind: "up", by: 2 }, stats: null, author: null },
      { rank: 2, team: 101, name: "Bravo", place: null, blurbHtml: "", movement: { kind: "down", by: 1 }, stats: null, author: null },
      { rank: 7, team: 102, name: "Charlie", place: null, blurbHtml: "", movement: { kind: "up", by: 9 }, stats: null, author: null },
      { rank: 12, team: 4215, name: "Team Duct Tape", place: null, blurbHtml: "", movement: { kind: "up", by: 4 }, stats: null, author: null },
    ],
  } as PowerRankingsResponse["week"],
});

async function user(email: string, follows: { myTeam?: number; tracked?: number[] } = {}, displayName: string | null = null) {
  const u = (await get<{ id: number }>("INSERT INTO users (email, display_name, created_at) VALUES (?, ?, ?) RETURNING id", [email, displayName, new Date().toISOString()]))!;
  const id = Number(u.id);
  if (follows.myTeam) await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'myTeam', ?, 1)", [id, JSON.stringify(follows.myTeam)]);
  if (follows.tracked) await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'tracked', ?, 1)", [id, JSON.stringify({ teams: follows.tracked, events: [] })]);
  const t = randomBytes(16).toString("hex");
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return { id, cookie: `cs_session=${t}` };
}

const api = (path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? "GET", redirect: "manual",
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });

async function event(code: string, name: string, start: string, end: string | null, place: [string, string] = ["Edison", "NJ"]) {
  await run("INSERT INTO events (season, code, name, start, end, city, state, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'first')", [SEASON, code, name, start, end, place[0], place[1]]);
}

let matchNo = 0;
/** A played qualification match with a logged live call: `pRed` the call, red wins when `redWins`. */
async function match(code: string, day: string, red: number[], blue: number[], redWins: boolean, pRed: number) {
  const n = ++matchNo;
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, blue_total, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 'first')",
    [SEASON, code, n, `Q${n}`, `${day}T10:00:00`, redWins ? 100 : 50, redWins ? 50 : 100]);
  for (const [teams, alliance] of [[red, "red"], [blue, "blue"]] as const) {
    for (const t of teams) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [SEASON, code, n, t, alliance]);
  }
  await run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome)
     VALUES ('live', ?, ?, 'qual', 0, ?, ?, ?, ?, 0, 0, 'moderate', 'test', ?, ?, ?)`,
    [SEASON, code, n, JSON.stringify(red), JSON.stringify(blue), pRed, `${day}T09:00:00`, `${day}T10:00:00`, redWins ? 1 : 0]);
}

/** The world the fixtures live in: an NJ Qualifier last weekend (4215 won it, 6980 went 5–5), 4215's earlier meet,
 *  the NJ Championship in 12 days (no schedule yet), and team 7777's bad week for the model. */
async function seed() {
  await event("USNJM1", "NJ League Meet 1", "2026-10-10", "2026-10-10");
  await event("USNJQ1", "NJ Qualifier", "2026-10-31", "2026-11-01");
  await event("USNJCMP", "NJ Championship", "2026-11-14", "2026-11-15");
  await event("USPAQ", "PA Qualifier", "2026-10-31", "2026-10-31", ["Lancaster", "PA"]);
  for (const [n, name] of [[4215, "Team Duct Tape"], [6980, "Robo Lions"], [7777, "Lucky Sevens"], [9999, "Quiet Ones"]] as const) {
    await run("INSERT INTO teams (number, name) VALUES (?, ?)", [n, name]);
  }
  await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (?, 'USNJQ1', 4215, 2, 8, 2, 0), (?, 'USNJQ1', 6980, 14, 5, 5, 0), (?, 'USPAQ', 7777, 9, 1, 2, 0)", [SEASON, SEASON, SEASON]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJM1', 4215, 128.1, 5), (?, 'USNJQ1', 4215, 142.3, 10), (?, 'USNJM1', 6980, 101.2, 5), (?, 'USNJQ1', 6980, 98.4, 10)", [SEASON, SEASON, SEASON, SEASON]);
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USNJQ1', 'Winner', 1, 4215)", [SEASON]);
  await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (?, 'USNJCMP', 4215, '2026-10-20')", [SEASON]);
  // 4215 (red) wins both; 6980 (blue) loses both. The model called both right.
  await match("USNJQ1", "2026-10-31", [4215, 1], [6980, 2], true, 0.7);
  await match("USNJQ1", "2026-11-01", [4215, 3], [6980, 4], true, 0.62);
  // An older call, earlier in the season: counts for the season record only.
  await match("USNJM1", "2026-10-10", [4215, 5], [6, 7], false, 0.8);
  // 7777's week: three calls, two wrong.
  await match("USPAQ", "2026-10-31", [7777, 8], [9, 10], false, 0.75);
  await match("USPAQ", "2026-10-31", [7777, 11], [12, 13], false, 0.7);
  await match("USPAQ", "2026-10-31", [7777, 14], [15, 16], true, 0.6);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); setMailer(null); delete process.env.RESEND_WEBHOOK_SECRET; });
beforeEach(async () => {
  for (const t of ["digest_sends", "digest_prefs", "user_state", "sessions", "users", "events", "matches", "match_teams", "event_teams", "team_event_stats",
    "awards", "alliances", "event_registrations", "predictions", "teams", "feature_flags"]) await run(`DELETE FROM ${t}`);
  invalidateFlags();
  resetDigestTick();
  mails = []; failFor = new Set(); matchNo = 0;
  setMailer(async (to, subject, text, html, opts) => {
    if (failFor.has(to)) throw new Error("email provider error 422: invalid recipient");
    mails.push({ to, subject, text, html, opts });
    return { id: `msg-${mails.length}` };
  });
  await seed();
});

const runWeek = (week = WEEK) => runDigestWeek(week, { gapMs: 0, rankings: rankings(), season: SEASON });
const logRow = (userId: number, week = WEEK) => get<any>("SELECT * FROM digest_sends WHERE user_id = ? AND week = ?", [userId, week]);

describe("the brief's fixture users", () => {
  it("A: two followed teams, a win, a loss, an upcoming event, a ranked mover — every number, link and date matches the data", async () => {
    const a = await user("a@example.com", { myTeam: 4215, tracked: [6980] }, "Ada Lovelace");
    await setDigest(a.id, true);
    const s = await runWeek();
    expect(s.sent).toBe(1);
    const m = mails[0];
    expect(m.to).toBe("a@example.com");
    expect(m.subject).toBe("Your Control Scout week: 4215 wins NJ Qualifier");
    // Your teams' week: both teams, the event linked, record, seed, playoff result and the OPR trend with numbers.
    expect(m.text).toContain("4215 Team Duct Tape at NJ Qualifier\n  8–2 · 2nd seed · Won the event · OPR 142.3 ↑ from 128.1\n  http://localhost:5173/events/2026/USNJQ1");
    expect(m.text).toContain("6980 Robo Lions at NJ Qualifier\n  5–5 · 14th seed · OPR 98.4 ↓ from 101.2");
    expect(m.html).toContain('href="http://localhost:5173/events/2026/USNJQ1"');
    // Prediction check-in: this week's 2 calls on their matches, both right; the season adds the October miss.
    expect(m.text).toContain("This week: 2 of 2 calls right (100%).");
    expect(m.text).toContain("Season: 2 of 3 calls right (67%)");
    // Coming up: dates, place and a countdown, and no invented time.
    expect(m.text).toContain("Nov 14–15 (in 12 days): NJ Championship, Edison, NJ\n  4215 Team Duct Tape · schedule not posted yet");
    // Power rankings: rank and movement, linked to the week.
    expect(m.text).toContain("#12 4215 Team Duct Tape (↑4 from last week)");
    expect(m.html).toContain('href="http://localhost:5173/power-rankings/2026-w44"');
    expect(m.text).toMatch(/^Hi Ada,/);
    // The log row was written with the template version and the sections.
    const row = await logRow(a.id);
    expect(row.status).toBe("sent");
    expect(JSON.parse(row.sections)).toEqual(["results", "predictions", "upcoming", "rankings"]);
    expect(row.template_version).toBe(1);
    expect(row.email_id).toBe("msg-1");
  });

  it("B: follows teams, but nothing happened and nothing is coming up — no email, logged skipped-empty", async () => {
    const b = await user("b@example.com", { tracked: [9999] });
    await setDigest(b.id, true);
    const s = await runWeek();
    expect(mails).toHaveLength(0);
    expect(s.skippedEmpty).toBe(1);
    // The rankings' "biggest movers" fallback alone is not something to report about B's teams.
    expect((await logRow(b.id)).status).toBe("skipped-empty");
  });

  it("C: follows nobody — gets nothing and never enters the send queue (no log row)", async () => {
    const c = await user("c@example.com");
    await setDigest(c.id, true);
    await runWeek();
    expect(mails).toHaveLength(0);
    expect(await logRow(c.id)).toBeUndefined();
  });

  it("D: unsubscribes from the email link on Tuesday — no digest next Monday, and Settings shows it off", async () => {
    const d = await user("d@example.com", { myTeam: 4215 });
    await setDigest(d.id, true);
    await runWeek("2026-10-26");
    const link = /Unsubscribe: (\S+)/.exec(mails[0].text)![1];
    expect(mails[0].opts?.headers?.["List-Unsubscribe"]).toBe(`<${link}>`);
    expect(mails[0].opts?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // Signed out, on another device: the link alone does it, in the same request.
    const r = await api(new URL(link).pathname + new URL(link).search);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/digest/unsubscribed?status=done");
    expect((await (await api("/api/digest", { cookie: d.cookie })).json()).enabled).toBe(false);
    mails = [];
    await runWeek();
    expect(mails).toHaveLength(0);
    expect((await logRow(d.id)).status).toBe("skipped-toggle-off");
  });

  it("E: the job runs twice in the same week (a crash and a re-run) — the second run sends nothing", async () => {
    const e = await user("e@example.com", { myTeam: 4215 });
    const e2 = await user("e2@example.com", { myTeam: 6980 });
    await setDigest(e.id, true); await setDigest(e2.id, true);
    // A crash after claiming e's row but before the send: the re-run must not send it either.
    await run("INSERT INTO digest_sends (user_id, week, status, template_version, created_at, updated_at) VALUES (?, ?, 'sending', 1, ?, ?)", [e.id, WEEK, "x", "x"]);
    const first = await runWeek();
    expect(first.sent).toBe(1);
    const second = await runWeek();
    expect(second.sent).toBe(0);
    expect(second.already).toBe(2);
    expect(mails.map((m) => m.to)).toEqual(["e2@example.com"]);
  });

  it("F: a followed team's bad week for the model — the check-in is there, with the bad record", async () => {
    const f = await user("f@example.com", { myTeam: 7777 });
    await setDigest(f.id, true);
    await runWeek();
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("This week: 1 of 3 calls right (33%). A rough week for the model");
    expect(JSON.parse((await logRow(f.id)).sections)).toContain("predictions");
  });
});

describe("the job", () => {
  it("one account's failure never stops the batch, and is logged with the reason", async () => {
    const x = await user("bad@example.com", { myTeam: 4215 });
    const y = await user("good@example.com", { myTeam: 6980 });
    await setDigest(x.id, true); await setDigest(y.id, true);
    failFor.add("bad@example.com");
    const s = await runWeek();
    expect(s).toMatchObject({ sent: 1, failed: 1 });
    expect(await logRow(x.id)).toMatchObject({ status: "failed", error: "email provider error 422: invalid recipient" });
    expect((await logRow(y.id)).status).toBe("sent");
  });

  it("a team unfollowed before Monday is gone from the digest; the switch off by default sends nothing", async () => {
    const u = await user("u@example.com", { myTeam: 6980, tracked: [] });
    await setDigest(u.id, true);
    await runWeek();
    expect(mails[0].text).not.toContain("4215 Team Duct Tape at");
    const never = await user("never@example.com", { myTeam: 4215 });
    mails = [];
    await runDigestWeek("2026-11-09", { gapMs: 0, rankings: rankings(), season: SEASON });
    expect(mails.map((m) => m.to)).not.toContain("never@example.com");
    expect(await logRow(never.id, "2026-11-09")).toBeUndefined();
  });

  it("an unsubscribe or a deleted account while earlier emails go out stops that account's email", async () => {
    const first = await user("first@example.com", { myTeam: 4215 });
    const leaves = await user("leaves@example.com", { myTeam: 4215 });
    const deleted = await user("deleted@example.com", { myTeam: 6980 });
    for (const u of [first, leaves, deleted]) await setDigest(u.id, true);
    const token = (await get<{ token: string }>("SELECT token FROM digest_prefs WHERE user_id = ?", [leaves.id]))!.token;
    const { deleteUser } = await import("../auth/session");
    // While the first email is being sent, one account unsubscribes and another is deleted.
    setMailer(async (to, subject, text, html, opts) => {
      mails.push({ to, subject, text, html, opts });
      if (to === "first@example.com") { await api(`/api/digest/unsubscribe?t=${token}`); await deleteUser(deleted.id); }
      return { id: `msg-${mails.length}` };
    });
    const s = await runWeek();
    expect(mails.map((m) => m.to)).toEqual(["first@example.com"]);
    expect(s.sent).toBe(1);
    expect((await logRow(leaves.id)).status).toBe("skipped-toggle-off");
    expect(await logRow(deleted.id)).toBeUndefined();
  });

  it("the owner's switch turned off mid-batch stops the rest; the next run finishes it", async () => {
    const ids = [];
    for (const e of ["s1@example.com", "s2@example.com", "s3@example.com"]) { const u = await user(e, { myTeam: 4215 }); await setDigest(u.id, true); ids.push(u.id); }
    let asked = 0;
    const s = await runDigestWeek(WEEK, { gapMs: 0, rankings: rankings(), season: SEASON, allowed: async () => ++asked <= 1 });
    expect(s).toMatchObject({ sent: 1, stopped: true });
    expect(await logRow(ids[1])).toBeUndefined();
    const rest = await runWeek();
    expect(rest).toMatchObject({ sent: 2, already: 1, stopped: false });
    expect(mails).toHaveLength(3);
  });

  it("the subject counts every result, not just the rows the email lists", async () => {
    // Eleven teams played; the event's winner, 5010, sorts last (by team number), past the ten rows shown.
    const many = Array.from({ length: 11 }, (_, i) => 5000 + i);
    for (const t of many) await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (?, 'USNJQ1', ?, 20, 1, 1, 0)", [SEASON, t]);
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USNJQ1', 'Winner', 1, 5010)", [SEASON]);
    await match("USNJQ1", "2026-11-01", many.slice(0, 2), many.slice(2, 4), true, 0.6);
    await match("USNJQ1", "2026-11-01", many.slice(4, 6), many.slice(6, 8), true, 0.6);
    await match("USNJQ1", "2026-11-01", many.slice(8, 10), [5010, 7], true, 0.6);
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: many, name: null, rankings: rankings() });
    expect(d.results).toHaveLength(11);
    expect(d.results.at(-1)!.team).toBe(5010);
    expect(headline(d)).toBe("5010 wins NJ Qualifier");
    const m = renderDigest(d, { site: "https://controlscout.org", unsubscribe: "https://controlscout.org/u", email: "x@example.com" });
    expect(m.text).not.toContain("5010 at NJ Qualifier");
    expect(m.text).toContain("1 more played last week");
  });

  it("power rankings: an older release isn't shown as new movement; a dropped team gets no row", async () => {
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [4215], name: null, rankings: rankings("2026-10-23") });
    expect(d.rankings).toBeNull();
    const fallback = await buildDigest({ week: WEEK, season: SEASON, followed: [6980], name: null, rankings: rankings() });
    expect(fallback.rankings).toMatchObject({ fallback: true });
    expect(fallback.rankings!.rows.map((r) => r.team)).toEqual([102, 4215, 100, 101]);
    expect(fallback.rankings!.rows.some((r) => r.team === 6980)).toBe(false);
  });

  it("a team listed in a match it didn't show up for (on_field = 0) didn't play", async () => {
    await run("UPDATE match_teams SET on_field = 0 WHERE team = 6980");
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [6980], name: null, rankings: rankings() });
    expect(d.results).toEqual([]);
  });

  it("coming up skips a registration list FIRST filed for an AM/PM pair (not this session's teams)", async () => {
    await run("INSERT INTO event_registrations (season, code, team, fetched_at, shared) VALUES (?, 'USNJCMP', 6980, '2026-10-20', 1)", [SEASON]);
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [4215, 6980], name: null, rankings: rankings() });
    expect(d.upcoming.map((u) => u.team)).toEqual([4215]);
  });

  it("a team at two events the same weekend shows both, grouped by event, most recent first", async () => {
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (?, 'USPAQ', 4215, 3, 2, 0, 0)", [SEASON]);
    await match("USPAQ", "2026-10-31", [4215, 20], [21, 22], true, 0.6);
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [4215], name: null, rankings: rankings() });
    expect(d.results.map((r) => r.code)).toEqual(["USNJQ1", "USPAQ"]);
    expect(d.results[1].record).toEqual({ wins: 2, losses: 0, ties: 0 });
  });

  it("the owner's switch and email being off stop the Monday tick", async () => {
    const a = await user("a@example.com", { myTeam: 4215 });
    await setDigest(a.id, true);
    const monday8 = Date.parse("2026-11-02T13:00:00Z"); // 08:00 New York (EST, after the Nov 1 change)
    await setFlag("weeklyDigest", false, "test");
    expect(await digestTick(monday8)).toBeNull();
    await setFlag("weeklyDigest", true, "test");
    invalidateFlags();
    expect(await digestTick(monday8 - 60_000)).toBeNull(); // 07:59
  });
});

describe("the email", () => {
  it("escapes names, carries no tracking, and only the logo is an image", async () => {
    await run("UPDATE events SET name = ? WHERE code = 'USNJQ1'", ["<b>NJ</b> & \"Friends\""]);
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [4215], name: "<script>", rankings: rankings() });
    const m = renderDigest(d, { site: "https://controlscout.org", unsubscribe: "https://controlscout.org/api/digest/unsubscribe?t=x", email: "a@example.com" });
    expect(m.html).not.toContain("<b>NJ</b>");
    expect(m.html).toContain("&lt;b&gt;NJ&lt;/b&gt; &amp; &quot;Friends&quot;");
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toMatch(/utm_/i);
    expect(m.html.match(/<img /g)).toHaveLength(1);
    for (const href of [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1])) expect(href).toMatch(/^https:\/\/controlscout\.org(\/|$)/);
  });

  it("subject headlines go by priority: a finish, then the record, then the next event", async () => {
    const d = await buildDigest({ week: WEEK, season: SEASON, followed: [6980], name: null, rankings: rankings() });
    expect(headline(d)).toBe("6980 goes 5–5 at NJ Qualifier");
    const quiet = await buildDigest({ week: "2026-11-09", season: SEASON, followed: [4215], name: null, rankings: rankings() });
    expect(headline(quiet)).toBe("NJ Championship starts Saturday");
    expect(sectionsOf(quiet)).toEqual(["upcoming"]);
  });
});

describe("Settings and the unsubscribe link", () => {
  it("off by default; turning it on and off; signed out is refused", async () => {
    const u = await user("s@example.com", { myTeam: 4215 });
    expect(await (await api("/api/digest", { cookie: u.cookie })).json()).toMatchObject({ available: true, enabled: false, email: "s@example.com", followedTeams: [4215] });
    const on = await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } });
    expect((await on.json()).enabled).toBe(true);
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect((await api("/api/digest", { method: "PUT", body: { enabled: true } })).status).toBe(401);
    expect((await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: "yes" } })).status).toBe(400);
  });

  it("turning it back on replaces the link, so an old email can't switch it off again", async () => {
    const u = await user("t@example.com", { myTeam: 4215 });
    await setDigest(u.id, true);
    const old = (await get<{ token: string }>("SELECT token FROM digest_prefs WHERE user_id = ?", [u.id]))!.token;
    expect((await api(`/api/digest/unsubscribe?t=${old}`)).headers.get("location")).toBe("/digest/unsubscribed?status=done");
    await api("/api/digest", { method: "PUT", cookie: u.cookie, body: { enabled: true } });
    const again = await api(`/api/digest/unsubscribe?t=${old}`);
    expect(again.headers.get("location")).toBe("/digest/unsubscribed?status=invalid");
    expect((await (await api("/api/digest", { cookie: u.cookie })).json()).enabled).toBe(true);
    // The mail app's one-click button (RFC 8058) with the current link.
    const fresh = (await get<{ token: string }>("SELECT token FROM digest_prefs WHERE user_id = ?", [u.id]))!.token;
    expect((await api(`/api/digest/unsubscribe?t=${fresh}`, { method: "POST", raw: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status).toBe(200);
    expect((await (await api("/api/digest", { cookie: u.cookie })).json()).enabled).toBe(false);
  });

  it("a bad or missing token changes nothing", async () => {
    expect((await api("/api/digest/unsubscribe?t=nope")).headers.get("location")).toBe("/digest/unsubscribed?status=invalid");
    expect((await api("/api/digest/unsubscribe")).headers.get("location")).toBe("/digest/unsubscribed?status=invalid");
  });

  it("its tables are private: never in the public snapshot, and deleted with the account", async () => {
    expect(PRIVATE_TABLES).toEqual(expect.arrayContaining(["digest_prefs", "digest_sends"]));
    const u = await user("gone@example.com", { myTeam: 4215 });
    await setDigest(u.id, true);
    await runWeek();
    const { deleteUser } = await import("../auth/session");
    await deleteUser(u.id);
    expect(await all("SELECT 1 FROM digest_prefs WHERE user_id = ?", [u.id])).toHaveLength(0);
    expect(await all("SELECT 1 FROM digest_sends WHERE user_id = ?", [u.id])).toHaveLength(0);
  });
});

describe("bounce reports (Resend webhook)", () => {
  const secret = `whsec_${randomBytes(24).toString("base64")}`;
  const sign = (body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) => ({
    "svix-id": id, "svix-timestamp": String(ts),
    "svix-signature": `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`,
    "Content-Type": "application/json",
  });
  const report = (type: string, bounce?: string) => JSON.stringify({ type, data: { email_id: "msg-1", to: ["h@example.com"], ...(bounce ? { bounce: { type: bounce } } : {}) } });

  it("a hard bounce turns the digest off and is logged; a soft bounce changes nothing", async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const h = await user("h@example.com", { myTeam: 4215 });
    await setDigest(h.id, true);
    await runWeek("2026-10-26");
    const soft = report("email.bounced", "Transient");
    expect((await api("/api/digest/webhook", { method: "POST", raw: soft, headers: sign(soft) })).status).toBe(200);
    expect((await (await api("/api/digest", { cookie: h.cookie })).json()).enabled).toBe(true);
    const hard = report("email.bounced", "Permanent");
    expect((await api("/api/digest/webhook", { method: "POST", raw: hard, headers: sign(hard) })).status).toBe(200);
    expect(await (await api("/api/digest", { cookie: h.cookie })).json()).toMatchObject({ enabled: false, bounced: true });
    expect((await logRow(h.id, "2026-10-26")).status).toBe("bounced");
    await runWeek();
    expect((await logRow(h.id)).status).toBe("skipped-bounce");
    // Turning it back on is the person's call, and clears the bounce.
    await api("/api/digest", { method: "PUT", cookie: h.cookie, body: { enabled: true } });
    expect(await (await api("/api/digest", { cookie: h.cookie })).json()).toMatchObject({ enabled: true, bounced: false });
  });

  it("refuses a bad signature or an old timestamp, and doesn't exist without the secret", async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const body = report("email.bounced", "Permanent");
    expect((await api("/api/digest/webhook", { method: "POST", raw: body, headers: { ...sign(body), "svix-signature": "v1,AAAA" } })).status).toBe(401);
    expect(verifyWebhook(secret, { id: "a", timestamp: "1", signature: "v1,x" }, body)).toBe(false);
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await api("/api/digest/webhook", { method: "POST", raw: body, headers: sign(body) })).status).toBe(404);
  });
});

describe("the schedule", () => {
  it("Mondays from 08:00 New York time, through daylight saving, never on Tuesday", () => {
    expect(dueWeek(Date.parse("2026-11-02T12:59:00Z"))).toBeNull(); // 07:59 EST
    expect(dueWeek(Date.parse("2026-11-02T13:00:00Z"))).toBe("2026-11-02"); // 08:00 EST
    expect(dueWeek(Date.parse("2026-10-26T12:00:00Z"))).toBe("2026-10-26"); // 08:00 EDT
    expect(dueWeek(Date.parse("2026-11-03T05:30:00Z"))).toBeNull(); // Tuesday 00:30 EST
    expect(new Date(nextSend(Date.parse("2026-10-28T00:00:00Z"))).toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
});
