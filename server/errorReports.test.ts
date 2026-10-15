// POST /api/reports/error and the GitHub filing behind it, against the real app on an
// in-memory database. GitHub is never called: setGithubFetch swaps in a fake that
// records requests and answers like the REST API.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { sha256 } from "./auth/session";
import { PRIVATE_TABLES } from "./data/snapshot";
import {
  fileReport, fingerprintOf, REPORT_RATE, resetReportLimits, setGithubFetch, settleFilings, storeReport, takeReportSlot, trackedReportKeys,
} from "./errorReports";
import { sanitizeReport, type ErrorReport } from "../src/shared/errorReport";

let server: Server;
let base = "";
const saved = { token: process.env.GITHUB_REPORT_TOKEN, owners: process.env.OWNER_EMAILS };

type Call = { method: string; path: string; body: any; auth: string | null };
let calls: Call[] = [];
let nextIssue = 100;
let issueStates: Record<number, { state: string; state_reason?: string | null; body?: string }> = {};
let failGithub: number | null = null;
/** GitHub does the write but the answer is lost (a 502 after the fact). */
let loseReply = false;
let refuseComments = false;
let slowGithub: Promise<void> | null = null;

const fakeGithub = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  expect(u.origin).toBe("https://api.github.com");
  const path = u.pathname.replace("/repos/Control-Point-FTC/control-scout", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, path, body, auth: new Headers(init?.headers).get("authorization") });
  if (slowGithub) await slowGithub;
  if (failGithub) return new Response("{}", { status: failGithub });
  if (path === "/search/issues") {
    const fp = /"([0-9a-f]{32})"/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
    const items = Object.entries(issueStates).filter(([, s]) => s.body?.includes(fp) && s.state === "open").map(([n, s]) => ({ number: +n, ...s }));
    return Response.json({ items });
  }
  if (method === "POST" && path === "/issues") {
    const n = nextIssue++;
    issueStates[n] = { state: "open", body: body.body };
    return loseReply ? new Response("{}", { status: 502 }) : Response.json({ number: n }, { status: 201 });
  }
  const m = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
  if (m && method === "GET") return issueStates[+m[1]] ? Response.json({ number: +m[1], ...issueStates[+m[1]] }) : new Response("{}", { status: 404 });
  if (m && m[2] && method === "POST" && refuseComments) return new Response("{}", { status: 403 });
  if (m && m[2] && method === "POST") return loseReply ? new Response("{}", { status: 502 }) : Response.json({ id: 1 }, { status: 201 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setGithubFetch(fakeGithub);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setGithubFetch(null);
  server?.close();
  for (const [k, v] of [["GITHUB_REPORT_TOKEN", saved.token], ["OWNER_EMAILS", saved.owners]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
beforeEach(async () => {
  process.env.GITHUB_REPORT_TOKEN = "github_pat_TEST_ONLY_not_a_real_token";
  delete process.env.OWNER_EMAILS;
  calls = [];
  nextIssue = 100;
  issueStates = {};
  failGithub = null;
  loseReply = false;
  refuseComments = false;
  slowGithub = null;
  resetReportLimits();
  await run("DELETE FROM error_reports");
});

const report = (over: Partial<ErrorReport> = {}): ErrorReport => ({
  message: "TypeError: Cannot read properties of undefined (reading 'opr')",
  stack: "TypeError: x\n    at TeamHero (https://controlscout.org/assets/TeamPage-B3xk9_Qa.js:1:23456)\n    at render (https://controlscout.org/assets/vendor-react-DkF02aZq.js:12:3456)",
  route: "/teams/18360", appVersion: "0.1.0+abc1234", timestamp: "2026-10-15T10:00:00.000Z", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141",
  ...over,
});

const post = async (body: unknown, opts: { cookie?: string; type?: string; ip?: string } = {}) => {
  const headers: Record<string, string> = { "Content-Type": opts.type ?? "application/json" };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.ip) headers["X-Forwarded-For"] = opts.ip;
  const res = await fetch(`${base}/api/reports/error`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};

const rows = () => all<{ fingerprint: string; count: number; issue_number: number | null; reported_count: number; last_comment_at: string | null; sample: string; filing_at: string | null }>("SELECT * FROM error_reports");

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

describe("POST /api/reports/error", () => {
  it("stores a sanitized report and opens one GitHub issue for a new fingerprint", async () => {
    const r = await post({ ...report({ message: "Error: no account for ada@example.com" }), notes: "private scouting note" });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ ok: true });
    await settleFilings();
    const [row] = await rows();
    expect(row.count).toBe(1);
    expect(row.sample).not.toMatch(/ada@example\.com|private scouting note/);
    expect(Object.keys(JSON.parse(row.sample)).sort()).toEqual(["appVersion", "message", "route", "stack", "timestamp", "userAgent"]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /search/issues", "POST /issues"]);
    const c = calls[1];
    expect(c).toMatchObject({ method: "POST", path: "/issues", auth: "Bearer github_pat_TEST_ONLY_not_a_real_token" });
    expect(c.body.title).toBe("[auto] Error: no account for [redacted]");
    expect(c.body.labels).toEqual(["bug", "auto-reported"]);
    expect(c.body.body).toContain(`**Fingerprint:** \`${row.fingerprint}\``);
    expect(c.body.body).toContain("**Occurrences:** 1");
    expect(c.body.body).toMatch(/### Environment[\s\S]*Route: +\/teams\/18360[\s\S]*App version: +0\.1\.0\+abc1234/);
    expect(row.issue_number).toBe(100);
    expect(row.reported_count).toBe(1);
  });

  it("dedupes: a second identical report counts, and opens no new issue", async () => {
    await post(report());
    await settleFilings();
    await post(report({ timestamp: "2026-10-15T10:05:00.000Z" }));
    await settleFilings();
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(2);
    expect(calls.filter((c) => c.path === "/issues")).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/comments"))).toHaveLength(0); // same day: no comment yet
  });

  it("never opens duplicates when the first reports of one fingerprint arrive together", async () => {
    let release!: () => void;
    slowGithub = new Promise((r) => { release = r; });
    await Promise.all(Array.from({ length: 5 }, () => post(report())));
    // The first filer holds the claim while GitHub is slow; the rest must back off.
    await new Promise((r) => setTimeout(r, 50));
    release();
    await settleFilings();
    expect(calls.filter((c) => c.method === "POST" && c.path === "/issues")).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ count: 5, issue_number: 100, filing_at: null });
  });

  it("stores only, and never fails, when GITHUB_REPORT_TOKEN is unset", async () => {
    delete process.env.GITHUB_REPORT_TOKEN;
    expect((await post(report())).status).toBe(202);
    expect((await post(report())).status).toBe(202);
    await settleFilings();
    expect(calls).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ count: 2, issue_number: null });
    expect(await fileReport((await rows())[0].fingerprint)).toBe("no-token");
  });

  it("still answers 202 when GitHub refuses, and files on a later report", async () => {
    failGithub = 403;
    expect((await post(report())).status).toBe(202);
    await settleFilings();
    expect((await rows())[0]).toMatchObject({ issue_number: null, filing_at: null });
    failGithub = null;
    await post(report());
    await settleFilings();
    expect((await rows())[0]).toMatchObject({ count: 2, issue_number: 100, reported_count: 2 });
  });

  it("an issue created without a reply is adopted later, never opened twice", async () => {
    const sample = sanitizeReport(report());
    const fp = fingerprintOf(sample);
    await storeReport(sample, new Date("2026-10-15T10:00:00Z"));
    loseReply = true;
    await expect(fileReport(fp, new Date("2026-10-15T10:00:00Z"))).rejects.toThrow(/502/);
    loseReply = false;
    // The claim is kept while the outcome is unknown: an immediate retry backs off.
    expect((await rows())[0]).toMatchObject({ issue_number: null, filing_at: "2026-10-15T10:00:00.000Z" });
    await storeReport(sample, new Date("2026-10-15T10:01:00Z"));
    expect(await fileReport(fp, new Date("2026-10-15T10:01:00Z"))).toBe("claimed-elsewhere");
    // Once the claim is stale, the retry finds the issue GitHub did create.
    await storeReport(sample, new Date("2026-10-15T10:20:00Z"));
    expect(await fileReport(fp, new Date("2026-10-15T10:20:00Z"))).toBe("adopted");
    expect(calls.filter((c) => c.method === "POST" && c.path === "/issues")).toHaveLength(1);
    // The issue was opened saying 1 occurrence: the 2 since are announced straight away, so GitHub is up to date.
    const comments = calls.filter((c) => c.path === "/issues/100/comments");
    expect(comments).toHaveLength(1);
    expect(comments[0].body.body).toMatch(/^Seen 2 more times since 2026-10-15 \(3 in total\)\./);
    expect((await rows())[0]).toMatchObject({ issue_number: 100, filing_at: null, reported_count: 3 });
  });

  it("an adopted issue whose follow-up comment is refused keeps reported_count at what GitHub was told", async () => {
    const sample = sanitizeReport(report());
    const fp = fingerprintOf(sample);
    await storeReport(sample, new Date("2026-10-15T10:00:00Z"));
    loseReply = true;
    await expect(fileReport(fp, new Date("2026-10-15T10:00:00Z"))).rejects.toThrow(/502/);
    loseReply = false;
    await storeReport(sample, new Date("2026-10-15T10:20:00Z"));
    refuseComments = true;
    await expect(fileReport(fp, new Date("2026-10-15T10:20:00Z"))).rejects.toThrow(/403/);
    expect((await rows())[0]).toMatchObject({ issue_number: 100, filing_at: null, reported_count: 1 });
  });

  it("validates the shape", async () => {
    expect((await post({ message: "x" })).status).toBe(400);
    expect((await post({ ...report(), timestamp: "soon" })).status).toBe(400);
    expect((await post([report()])).status).toBe(400);
    expect((await post("message=x", { type: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect(await rows()).toHaveLength(0);
  });

  it("is never cached and never lists anything to non-owners", async () => {
    const r = await fetch(`${base}/api/reports/errors`);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("rate limits", () => {
  it("allows 20 reports an hour per IP when signed out", async () => {
    for (let i = 0; i < REPORT_RATE.ip; i++) expect((await post(report({ message: `Error: ${i}` }), { ip: "203.0.113.7" })).status).toBe(202);
    const r = await post(report(), { ip: "203.0.113.7" });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(report(), { ip: "203.0.113.8" })).status).toBe(202); // another IP is unaffected
  });

  it("allows 5 reports an hour per signed-in account, from any IP", async () => {
    const cookie = await signIn("scout@example.com");
    for (let i = 0; i < REPORT_RATE.account; i++) expect((await post(report(), { cookie, ip: `198.51.100.${i}` })).status).toBe(202);
    expect((await post(report(), { cookie, ip: "198.51.100.99" })).status).toBe(429);
    expect((await post(report(), { ip: "198.51.100.99" })).status).toBe(202); // signed out on that IP: its own budget
  });

  it("frees a slot after an hour and keeps its memory bounded", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(takeReportSlot("u:1", 5, t0).ok).toBe(true);
    expect(takeReportSlot("u:1", 5, t0 + 1000)).toEqual({ ok: false, retryAfter: 3599 });
    expect(takeReportSlot("u:1", 5, t0 + REPORT_RATE.windowMs).ok).toBe(true);
    resetReportLimits();
    for (let i = 0; i < 10_050; i++) takeReportSlot(`ip:${i}`, 20, t0);
    // Everyone above has expired an hour later: the next new key sweeps them out.
    takeReportSlot("ip:new", 20, t0 + REPORT_RATE.windowMs + 1);
    expect(trackedReportKeys()).toBe(1);
  });
});

describe("daily comment", () => {
  const sample = sanitizeReport(report());
  const fp = fingerprintOf(sample);
  const at = (iso: string) => new Date(iso);

  it("adds at most one 'seen N more times' comment a day", async () => {
    await storeReport(sample, at("2026-10-15T10:00:00Z"));
    expect(await fileReport(fp, at("2026-10-15T10:00:01Z"))).toBe("opened");
    for (const t of ["2026-10-15T11:00:00Z", "2026-10-15T12:00:00Z", "2026-10-15T13:00:00Z"]) {
      await storeReport(sample, at(t));
      expect(await fileReport(fp, at(t))).toBe("throttled");
    }
    await storeReport(sample, at("2026-10-16T10:00:02Z"));
    expect(await fileReport(fp, at("2026-10-16T10:00:02Z"))).toBe("commented");
    const comments = calls.filter((c) => c.path === "/issues/100/comments");
    expect(comments).toHaveLength(1);
    expect(comments[0].body.body).toMatch(/^Seen 4 more times since 2026-10-15 \(5 in total\)\./);
    // Nothing new since: no comment, even a day later.
    expect(await fileReport(fp, at("2026-10-18T10:00:00Z"))).toBe("up-to-date");
    // Within a day of the last comment: throttled again.
    await storeReport(sample, at("2026-10-16T12:00:00Z"));
    expect(await fileReport(fp, at("2026-10-16T12:00:00Z"))).toBe("throttled");
    expect(calls.filter((c) => c.path === "/issues/100/comments")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/issues" && c.method === "POST")).toHaveLength(1);
  });

  it("gives the day's slot back if GitHub refuses the comment", async () => {
    await storeReport(sample, at("2026-10-15T10:00:00Z"));
    await fileReport(fp, at("2026-10-15T10:00:00Z"));
    await storeReport(sample, at("2026-10-16T11:00:00Z"));
    failGithub = 403;
    await expect(fileReport(fp, at("2026-10-16T11:00:00Z"))).rejects.toThrow(/403/);
    expect((await rows())[0].last_comment_at).toBe("2026-10-15T10:00:00.000Z");
    failGithub = null;
    expect(await fileReport(fp, at("2026-10-16T11:01:00Z"))).toBe("commented");
  });

  it("keeps the day's slot when a comment's outcome is unknown, so it is never posted twice", async () => {
    await storeReport(sample, at("2026-10-15T10:00:00Z"));
    await fileReport(fp, at("2026-10-15T10:00:00Z"));
    await storeReport(sample, at("2026-10-16T11:00:00Z"));
    loseReply = true; // the comment is posted, but the answer is lost
    await expect(fileReport(fp, at("2026-10-16T11:00:00Z"))).rejects.toThrow(/502/);
    loseReply = false;
    expect((await rows())[0].last_comment_at).toBe("2026-10-16T11:00:00.000Z");
    expect(await fileReport(fp, at("2026-10-16T11:01:00Z"))).toBe("throttled");
  });

  it("opens a new issue, linking the old one, when the issue was closed as completed and the error comes back", async () => {
    await storeReport(sample, at("2026-10-15T10:00:00Z"));
    await fileReport(fp, at("2026-10-15T10:00:00Z"));
    issueStates[100] = { state: "closed", state_reason: "completed" };
    await storeReport(sample, at("2026-10-17T10:00:00Z"));
    expect(await fileReport(fp, at("2026-10-17T10:00:00Z"))).toBe("opened");
    const opened = calls.filter((c) => c.path === "/issues" && c.method === "POST");
    expect(opened).toHaveLength(2);
    expect(opened[1].body.body).toContain("#100 was closed as completed");
    expect((await rows())[0]).toMatchObject({ issue_number: 101, reported_count: 2 });
  });

  it("stays quiet about an issue closed as not planned (still counting here)", async () => {
    await storeReport(sample, at("2026-10-15T10:00:00Z"));
    await fileReport(fp, at("2026-10-15T10:00:00Z"));
    issueStates[100] = { state: "closed", state_reason: "not_planned" };
    await storeReport(sample, at("2026-10-17T10:00:00Z"));
    expect(await fileReport(fp, at("2026-10-17T10:00:00Z"))).toBe("not-planned");
    await storeReport(sample, at("2026-10-20T10:00:00Z"));
    expect(await fileReport(fp, at("2026-10-20T10:00:00Z"))).toBe("not-planned");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect((await rows())[0].count).toBe(3);
  });
});

describe("privacy", () => {
  it("reports never go into the shipped public snapshot", () => {
    expect(PRIVATE_TABLES).toContain("error_reports");
  });
});

describe("recursion guard (server)", () => {
  it("a storage failure answers 503 and never throws or reports itself", async () => {
    await run("ALTER TABLE error_reports RENAME TO error_reports_gone");
    try {
      const r = await post(report());
      expect(r.status).toBe(503);
      expect(calls).toHaveLength(0);
      // The app is still up.
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
    } finally {
      await run("ALTER TABLE error_reports_gone RENAME TO error_reports");
    }
  });
});

describe("GET /api/reports/errors (owner portal)", () => {
  it("lists reports for an owner only", async () => {
    await post(report());
    await settleFilings();
    process.env.OWNER_EMAILS = "owner@example.com, other@example.com";
    const owner = await signIn("owner@example.com");
    const someone = await signIn("someone@example.com");
    expect((await fetch(`${base}/api/reports/errors`, { headers: { Cookie: someone } })).status).toBe(404);
    expect((await fetch(`${base}/api/reports/errors`)).status).toBe(404);
    const res = await fetch(`${base}/api/reports/errors?limit=10`, { headers: { Cookie: owner } });
    expect(res.status).toBe(200);
    const { reports } = await res.json();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ count: 1, issueNumber: 100, issueUrl: "https://github.com/Control-Point-FTC/control-scout/issues/100", issueState: "open" });
    expect(reports[0].sample.route).toBe("/teams/18360");
    delete process.env.OWNER_EMAILS;
    expect((await fetch(`${base}/api/reports/errors`, { headers: { Cookie: owner } })).status).toBe(404);
  });
});
