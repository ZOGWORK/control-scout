// The owner console's Moderation, Feedback & errors and Analytics routes against the real app on an
// in-memory database: owner only, triage moves and their audit rows, owner notes on error reports, the
// "in use" publish choice and /api/public-usage following it, and the analytics numbers.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { invalidateOwnerSettings } from "../ownerSettings";
import { resetAbuse } from "../moderation";
import { resetMetrics } from "../metrics";
import { recordPageView } from "../analytics";
import { canTriage, statusForTriage, triageQueue } from "./feedback";
import { TRIAGE_NEXT } from "../../src/shared/owner";

let server: Server;
let base = "";
const saved = { owners: process.env.OWNER_EMAILS, usage: process.env.PUBLIC_USAGE_ENABLED };
let ownerCookie = "", otherCookie = "";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

let auditFrom = 0;
const audit = () => all<{ actor: string; action: string; details: string | null; old_value: string | null; new_value: string | null }>(
  "SELECT * FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom]);
const add = async (topic: string, message = "Something") => Number((await get<{ id: number }>(
  "INSERT INTO contact_messages (created_at, topic, name, email, message) VALUES (?, ?, 'Ada', 'ada@example.com', ?) RETURNING id", [new Date().toISOString(), topic, message],
))!.id);
const FP = "0123456789abcdef0123456789abcdef";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  server?.close();
  for (const [k, v] of [["OWNER_EMAILS", saved.owners], ["PUBLIC_USAGE_ENABLED", saved.usage]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  delete process.env.PUBLIC_USAGE_ENABLED;
  for (const t of ["contact_messages", "error_reports", "owner_settings", "abuse_daily", "request_metrics_daily", "analytics_daily", "predictions"]) await run(`DELETE FROM ${t}`);
  auditFrom = Number((await get<{ n: number }>("SELECT COALESCE(MAX(id), 0) n FROM owner_audit"))!.n);
  invalidateOwnerSettings();
  resetAbuse();
  resetMetrics();
});

describe("who gets in", () => {
  it("answers 403 to visitors and non-owners on every new route, and changes nothing", async () => {
    const id = await add("data");
    await run("INSERT INTO error_reports (fingerprint, message, first_seen, last_seen, sample) VALUES (?, 'Boom', ?, ?, '{}')", [FP, "2026-10-01", "2026-10-01"]);
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/owner/moderation"], ["GET", "/api/owner/analytics"],
      ["PATCH", `/api/owner/feedback/${id}/triage`, { triage: "accepted" }],
      ["PUT", `/api/owner/errors/${FP}/note`, { note: "mine" }],
      ["PUT", "/api/owner/settings/public-usage", { enabled: true, confirm: true }],
    ];
    for (const cookie of [undefined, otherCookie]) {
      for (const [m, p, body] of routes) expect((await call(m, p, { cookie, body })).status, `${m} ${p}`).toBe(403);
    }
    expect(await audit()).toEqual([]);
    expect((await get<{ triage: string | null }>("SELECT triage FROM contact_messages WHERE id = ?", [id]))!.triage).toBeNull();
    expect((await get<{ owner_note: string | null }>("SELECT owner_note FROM error_reports"))!.owner_note).toBeNull();
    expect(await all("SELECT * FROM owner_settings")).toEqual([]);
  });
});

describe("triage", () => {
  it("allows only the moves in TRIAGE_NEXT, files the message with its decision, and never a move to where it is", () => {
    expect(canTriage(null, "accepted")).toBe(true);
    expect(canTriage(null, null)).toBe(false);
    expect(canTriage("accepted", "accepted")).toBe(false);
    expect(canTriage("rejected", "fixed")).toBe(false);
    expect(canTriage("fixed", "accepted")).toBe(true);
    for (const [from, tos] of Object.entries(TRIAGE_NEXT)) expect(tos, from).not.toContain(from === "untriaged" ? null : from);
    expect([statusForTriage("fixed"), statusForTriage("rejected"), statusForTriage("accepted"), statusForTriage(null)]).toEqual(["resolved", "resolved", "open", "open"]);
  });

  it("accepts, fixes and takes back a data correction, each step in the audit log with the old and new value", async () => {
    const id = await add("data", "Match Q12's red score is wrong");
    const matchesBefore = (await all("SELECT COUNT(*) n FROM matches"))[0];

    let r = await call("PATCH", `/api/owner/feedback/${id}/triage`, { cookie: ownerCookie, body: { triage: "accepted" } });
    expect(r.status).toBe(200);
    expect(r.json.message).toMatchObject({ id, triage: "accepted", status: "open" });
    expect(r.json.message.triageAt).toBeTruthy();

    r = await call("PATCH", `/api/owner/feedback/${id}/triage`, { cookie: ownerCookie, body: { triage: "fixed" } });
    expect(r.json.message).toMatchObject({ triage: "fixed", status: "resolved" });

    r = await call("PATCH", `/api/owner/feedback/${id}/triage`, { cookie: ownerCookie, body: { triage: null } });
    expect(r.json.message).toMatchObject({ triage: null, triageAt: null, status: "open" });

    const rows = await audit();
    expect(rows.map((a) => ({ actor: a.actor, action: a.action, old: a.old_value, new: a.new_value }))).toEqual([
      { actor: "owner@example.com", action: "feedback.triage", old: "null", new: '"accepted"' },
      { actor: "owner@example.com", action: "feedback.triage", old: '"accepted"', new: '"fixed"' },
      { actor: "owner@example.com", action: "feedback.triage", old: '"fixed"', new: "null" },
    ]);
    expect(JSON.parse(rows[1].details!)).toEqual({ id, topic: "data", triage: "fixed", statusFrom: "open", statusTo: "resolved" });
    // No email in the audit log; no match record touched.
    for (const a of rows) expect(JSON.stringify(a)).not.toContain("ada@example.com");
    expect((await all("SELECT COUNT(*) n FROM matches"))[0]).toEqual(matchesBefore);
  });

  it("refuses moves it doesn't allow, unknown values and messages, and topics that aren't triaged, writing nothing", async () => {
    const bug = await add("bug");
    const other = await add("other");
    await call("PATCH", `/api/owner/feedback/${bug}/triage`, { cookie: ownerCookie, body: { triage: "rejected" } });
    const before = (await audit()).length;
    expect((await call("PATCH", `/api/owner/feedback/${bug}/triage`, { cookie: ownerCookie, body: { triage: "rejected" } })).status).toBe(409);
    expect((await call("PATCH", `/api/owner/feedback/${bug}/triage`, { cookie: ownerCookie, body: { triage: "fixed" } })).status).toBe(409);
    expect((await call("PATCH", `/api/owner/feedback/${bug}/triage`, { cookie: ownerCookie, body: { triage: "done" } })).status).toBe(400);
    expect((await call("PATCH", `/api/owner/feedback/${bug}/triage`, { cookie: ownerCookie, body: {} })).status).toBe(400);
    expect((await call("PATCH", `/api/owner/feedback/${other}/triage`, { cookie: ownerCookie, body: { triage: "accepted" } })).status).toBe(400);
    expect((await call("PATCH", "/api/owner/feedback/99999/triage", { cookie: ownerCookie, body: { triage: "accepted" } })).status).toBe(404);
    expect((await audit()).length).toBe(before);
  });

  it("lists untriaged and accepted messages apart, each in full, leaving out decided, archived and 'other' ones", async () => {
    const a = await add("bug"), b = await add("data"), c = await add("feature"), d = await add("other"), e = await add("bug");
    await call("PATCH", `/api/owner/feedback/${a}/triage`, { cookie: ownerCookie, body: { triage: "accepted" } });
    await call("PATCH", `/api/owner/feedback/${b}/triage`, { cookie: ownerCookie, body: { triage: "rejected" } });
    await call("PATCH", `/api/owner/feedback/${e}`, { cookie: ownerCookie, body: { status: "archived" } });
    const r = await call("GET", "/api/owner/moderation", { cookie: ownerCookie });
    expect(r.status).toBe(200);
    expect(r.json.triage).toMatchObject({ state: "untriaged", more: false });
    expect(r.json.triage.messages.map((m: any) => m.id)).toEqual([c]);
    const accepted = await call("GET", "/api/owner/moderation?triage=accepted", { cookie: ownerCookie });
    expect(accepted.json.triage.messages.map((m: any) => m.id)).toEqual([a]);
    // Many untriaged messages never push an accepted one out of reach: each list pages on its own.
    await add("bug"); await add("data");
    const page = await triageQueue("untriaged", 1);
    expect([page.messages.length, page.more]).toEqual([1, true]);
    expect((await triageQueue("accepted", 1)).messages.map((m) => m.id)).toEqual([a]);
    expect(r.json.triage.counts).toEqual({ untriaged: 1, accepted: 1, rejected: 1, fixed: 0 });
    expect(r.json.triage.messages.some((m: any) => m.id === d)).toBe(false);
    // The same messages in the inbox: one list, not a second inbox.
    const inbox = await call("GET", "/api/owner/feedback?status=all", { cookie: ownerCookie });
    expect(inbox.json.messages.find((m: any) => m.id === a)).toMatchObject({ triage: "accepted" });
  });

  it("shows abuse counts by range only, never an address", async () => {
    await run("INSERT INTO abuse_daily (day, ip_range, kind, count) VALUES (?, '203.0.0.0/16', 'rate_limited', 4)", [new Date().toISOString().slice(0, 10)]);
    const r = await call("GET", "/api/owner/moderation?days=7", { cookie: ownerCookie });
    expect(r.json.abuse.totals).toEqual({ rate_limited: 4, bot_ua: 0, burst: 0 });
    expect(r.json.abuse.ranges).toEqual([{ range: "203.0.0.0/16", rate_limited: 4, bot_ua: 0, burst: 0, days: 1 }]);
    expect(r.json.abuse.daily).toHaveLength(7);
  });
});

describe("error report notes", () => {
  beforeEach(async () => {
    await run("INSERT INTO error_reports (fingerprint, message, first_seen, last_seen, sample, issue_number, issue_state) VALUES (?, 'Boom', ?, ?, ?, 42, 'closed')",
      [FP, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", JSON.stringify({ route: "/", appVersion: "1.4.1", stack: "", userAgent: "x" })]);
  });

  it("are saved, changed and cleared, each in the audit log with the note it replaced", async () => {
    let r = await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: { note: "  Looks like Safari 17 only  " } });
    expect(r.status).toBe(200);
    expect(r.json.report).toMatchObject({ ownerNote: "Looks like Safari 17 only", issueNumber: 42, issueState: "closed" });
    r = await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: { note: "Fixed in 1.4.2" } });
    r = await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: { note: "" } });
    expect(r.json.report).toMatchObject({ ownerNote: null, ownerNoteAt: null });
    expect((await audit()).map((a) => [a.action, a.old_value, a.new_value])).toEqual([
      ["error.note", "null", '"Looks like Safari 17 only"'],
      ["error.note", '"Looks like Safari 17 only"', '"Fixed in 1.4.2"'],
      ["error.note", '"Fixed in 1.4.2"', "null"],
    ]);
    const list = await call("GET", "/api/owner/errors", { cookie: ownerCookie });
    expect(list.json.reports[0]).toMatchObject({ fingerprint: FP, issueUrl: expect.stringContaining("/issues/42"), issueState: "closed", ownerNote: null });
  });

  it("keep the whole of a longest note in the audit log, as valid JSON, however much it escapes", async () => {
    const note = "\"\n".repeat(1000); // 2,000 characters, 4,002 once serialized
    await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: { note: `x${note}x`.slice(0, 2000) } });
    const [row] = await audit();
    expect(JSON.parse(row.new_value!)).toBe(`x${note}x`.slice(0, 2000).trim());
  });

  it("refuse an unknown report, a missing or too-long note", async () => {
    expect((await call("PUT", "/api/owner/errors/ffffffffffffffff/note", { cookie: ownerCookie, body: { note: "x" } })).status).toBe(404);
    expect((await call("PUT", "/api/owner/errors/not-a-print/note", { cookie: ownerCookie, body: { note: "x" } })).status).toBe(404);
    expect((await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: {} })).status).toBe(400);
    expect((await call("PUT", `/api/owner/errors/${FP}/note`, { cookie: ownerCookie, body: { note: "x".repeat(2001) } })).status).toBe(400);
    expect(await audit()).toEqual([]);
  });
});

describe("analytics and the \"in use\" choice", () => {
  it("counts page views, sessions, prediction calls and the ledger, with no email anywhere", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await recordPageView({ path: "/", ref: "", screen: "phone", lang: "en", session: true });
    await recordPageView({ path: "/teams", ref: "", screen: "phone", lang: "en", session: false });
    await run("INSERT INTO request_metrics_daily (day, route, count) VALUES (?, 'GET /api/predict/match', 7), (?, 'GET /api/predict/event', 3), (?, 'GET /api/teams/:n', 50)", [today, today, today]);
    const p = (kind: string, n: number, outcome: number | null) => run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, outcome, scored_at)
       VALUES (?, 2026, 'X', 'qual', 0, ?, '1', '2', 0.6, 50, 40, 'medium', 't', ?, ?, ?)`, [kind, n, new Date().toISOString(), outcome, outcome == null ? null : new Date().toISOString()]);
    await p("live", 1, 1); await p("live", 2, null); await p("backtest", 3, 0);
    const r = await call("GET", "/api/owner/analytics?days=7", { cookie: ownerCookie });
    expect(r.status).toBe(200);
    expect(r.json.totals).toEqual({ pageViews: 2, sessions: 1, predictionCalls: 10 });
    expect(r.json.daily).toHaveLength(7);
    expect(r.json.daily.at(-1)).toEqual({ day: today, pageViews: 2, sessions: 1, predictionCalls: 10 });
    expect(r.json.predictionRoutes).toEqual([{ route: "GET /api/predict/match", count: 7 }, { route: "GET /api/predict/event", count: 3 }]);
    expect(r.json.ledger).toEqual({ liveLogged: 2, liveScored: 1, liveLoggedInPeriod: 2, liveScoredInPeriod: 1, backtestScored: 1 });
    expect(r.text).not.toMatch(/@example\.com/);
  });

  it("publishes the home page's section only once confirmed, audits old and new, and /api/public-usage follows it", async () => {
    await recordPageView({ path: "/", ref: "", screen: "phone", lang: "en", session: true });
    let a = await call("GET", "/api/owner/analytics", { cookie: ownerCookie });
    expect(a.json.publishUsage).toMatchObject({ enabled: false, source: "env", envDefault: false });
    expect((await call("GET", "/api/public-usage")).json.reason).toBe("not-published");

    expect((await call("PUT", "/api/owner/settings/public-usage", { cookie: ownerCookie, body: { enabled: true } })).status).toBe(400);
    expect((await call("PUT", "/api/owner/settings/public-usage", { cookie: ownerCookie, body: { enabled: "yes", confirm: true } })).status).toBe(400);
    expect(await audit()).toEqual([]);

    const on = await call("PUT", "/api/owner/settings/public-usage", { cookie: ownerCookie, body: { enabled: true, confirm: true } });
    expect(on.json.publishUsage).toMatchObject({ enabled: true, source: "owner" });
    const pub = await call("GET", "/api/public-usage");
    expect(pub.json).toMatchObject({ status: "available", totals: { pageViews: 1, sessionStarts: 1 } });

    await call("PUT", "/api/owner/settings/public-usage", { cookie: ownerCookie, body: { enabled: false, confirm: true } });
    expect((await call("GET", "/api/public-usage")).json.reason).toBe("not-published");
    a = await call("GET", "/api/owner/analytics", { cookie: ownerCookie });
    expect(a.json.publishUsage).toMatchObject({ enabled: false, source: "owner" });

    expect((await audit()).map((x) => [x.action, x.old_value, x.new_value])).toEqual([
      ["settings.publicUsage", "false", "true"],
      ["settings.publicUsage", "true", "false"],
    ]);
  });

  it("follows PUBLIC_USAGE_ENABLED until the owner chooses, and the owner's choice over it after", async () => {
    process.env.PUBLIC_USAGE_ENABLED = "1";
    invalidateOwnerSettings();
    await recordPageView({ path: "/", ref: "", screen: "phone", lang: "en", session: true });
    expect((await call("GET", "/api/public-usage")).json.status).toBe("available");
    await call("PUT", "/api/owner/settings/public-usage", { cookie: ownerCookie, body: { enabled: false, confirm: true } });
    expect((await call("GET", "/api/public-usage")).json.reason).toBe("not-published");
    expect((await audit()).map((x) => [x.old_value, x.new_value])).toEqual([["true", "false"]]);
  });
});
