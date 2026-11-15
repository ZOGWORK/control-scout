// The bug report path against the real app on an in-memory database: validation, the three steps (report, uploads,
// done), size and type checks on the bytes themselves, the honeypot, the per-IP limit, the email to CONTACT_TO, and
// the owner endpoints behind the owner gate, and filing each report as a GitHub issue against a fake GitHub (uploads
// first, then the issue; failures, no token, a lost reply, sanitizing; the local copy deleted once its URL opens).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { setMailer, type MailOptions } from "./auth/email";
import { randomUUID } from "node:crypto";
import {
  BUG_RATE, bugDir, bugIssueTitle, deleteBugReport, emailing, filing, listBugReports, NO_TOKEN, resetBugFilingPause, resetBugLimits,
  STORAGE_CAP_BYTES, sweepBugReports, UPLOAD_ROUTE, UPLOAD_WINDOW_MS, validateBugReport,
} from "./bugReports";
import { resetRepositoryId, setGithubFetch } from "./errorReports";
import { BUG_LIMITS, isSitePath, sniffType } from "../src/shared/bugReport";

let server: Server;
let base = "";
let mails: { to: string; subject: string; text: string; opts?: MailOptions }[] = [];
let failSend = false;
const saved = { to: process.env.CONTACT_TO, dir: process.env.DATA_DIR, token: process.env.GITHUB_REPORT_TOKEN };

// A fake GitHub: the repository, attachment uploads, issues, issue search, and asset URLs (which open only once an
// issue uses them, as on GitHub).
type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
let issues: { number: number; title: string; body: string; labels: string[] }[] = [];
let gitHub = { upload: 201, issue: 201, dropLabel: "", loseReply: false };
const fakeGithub = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ method, url: url.toString(), body });
  if (url.host === "uploads.github.com") {
    if (gitHub.upload !== 201) return new Response("{}", { status: gitHub.upload });
    return Response.json({ url: `https://github.com/user-attachments/assets/${randomUUID()}` }, { status: 201 });
  }
  if (url.host === "github.com" && method === "HEAD") return new Response(null, { status: issues.some((i) => i.body.includes(url.toString())) ? 302 : 404 });
  const path = url.pathname.replace("/repos/ZOGWORK/control-scout", "");
  if (method === "GET" && path === "") return Response.json({ id: 1416291522 });
  if (method === "POST" && path === "/issues") {
    if (gitHub.issue !== 201) return new Response("{}", { status: gitHub.issue });
    const issue = { number: 1520 + issues.length, title: body.title, body: body.body, labels: (body.labels as string[]).filter((l) => l !== gitHub.dropLabel) };
    issues.push(issue);
    if (gitHub.loseReply) return new Response("{}", { status: 502 });
    return Response.json({ number: issue.number, labels: issue.labels.map((name) => ({ name })) }, { status: 201 });
  }
  if (method === "GET" && url.pathname === "/search/issues") {
    const marker = /"([0-9a-f]{24})"/.exec(url.searchParams.get("q") ?? "")?.[1] ?? "-";
    return Response.json({ items: issues.filter((i) => i.body.includes(marker)).map((i) => ({ number: i.number, body: i.body })) });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
const dir = mkdtempSync(join(tmpdir(), "cs-bugs-"));

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, subject, text, _html, opts) => {
    if (failSend) throw new Error("email provider error 500");
    mails.push({ to, subject, text, opts });
  });
  setGithubFetch(fakeGithub);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null);
  setGithubFetch(null);
  server?.close();
  for (const [k, v] of [["CONTACT_TO", saved.to], ["DATA_DIR", saved.dir], ["GITHUB_REPORT_TOKEN", saved.token]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  process.env.CONTACT_TO = "team@controlscout.test";
  mails = [];
  failSend = false;
  delete process.env.GITHUB_REPORT_TOKEN;
  calls = [];
  issues = [];
  gitHub = { upload: 201, issue: 201, dropLabel: "", loseReply: false };
  resetBugFilingPause();
  resetRepositoryId();
  resetBugLimits();
  await run("DELETE FROM bug_report_files");
  await run("DELETE FROM bug_reports");
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const MP4 = (bytes: number) => { const b = Buffer.alloc(bytes, 1); b.write("ftypisom", 4, "latin1"); return b; };
const context = { page: "/teams/4215", release: "4.8.1", viewport: "1440×900 @2x", device: "Chrome on Windows", theme: "Dark" };
const good = { category: "broken", message: "The rankings table jumps when I scroll.", email: "Coach@Example.com", context, files: [] as { type: string; bytes: number }[] };

const create = async (body: unknown) => {
  const res = await fetch(`${base}/api/bug-reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
/** One piece: PUT …/files/:n?offset=…. */
const put = async (id: number, n: number, token: string, body: Buffer, offset = 0, type = "image/png") => {
  const res = await fetch(`${base}/api/bug-reports/${id}/files/${n}?offset=${offset}`, { method: "PUT", headers: { "Content-Type": type, "X-Bug-Token": token }, body });
  return { status: res.status, json: await res.json().catch(() => null) };
};
/** A whole file, in pieces as the dialog sends it; the last piece's answer. */
const upload = async (id: number, n: number, token: string, body: Buffer, type = "image/png") => {
  let last: { status: number; json: { error?: string } | null } = { status: 0, json: null };
  for (let at = 0; at < body.length; at += BUG_LIMITS.chunkBytes) {
    last = await put(id, n, token, body.subarray(at, at + BUG_LIMITS.chunkBytes), at, type);
    if (last.status !== 200) break;
  }
  return last;
};
const done = async (id: number, token: string) => {
  const res = await fetch(`${base}/api/bug-reports/${id}/done`, { method: "POST", headers: { "Content-Type": "application/json", "X-Bug-Token": token }, body: "{}" });
  await emailing;
  await filing;
  return res.status;
};
const status = async (id: number, token: string) => (await fetch(`${base}/api/bug-reports/${id}/status`, { headers: { "X-Bug-Token": token } })).json();
const TOKEN = "github_pat_TEST_ONLY_not_a_real_token";
/** A report sent the way the dialog sends it: created, its files uploaded, then done. */
const send = async (body: unknown, files: [Buffer, string][] = []) => {
  const r = (await create({ ...(body as object), files: files.map(([b, type]) => ({ type, bytes: b.length })) })).json as { id: number; token: string };
  for (const [n, [b, type]] of files.entries()) expect((await upload(r.id, n, r.token, b, type)).status).toBe(200);
  await done(r.id, r.token);
  return r;
};
/** The audit log is append-only: each test reads only what was added after it started. */
let auditFrom = 0;
const audits = async (action: string) => (await all<{ details: string }>("SELECT details FROM owner_audit WHERE action = ? AND id > ? ORDER BY id", [action, auditFrom])).map((a) => JSON.parse(a.details));

describe("validateBugReport", () => {
  it("cleans a good report and keeps only a path on this site", () => {
    const v = validateBugReport({ ...good, context: { ...context, page: "https://evil.example/x" } });
    expect(v.ok && v.value).toMatchObject({ category: "broken", email: "coach@example.com", context: { page: "" } });
    for (const page of ["//evil.example", "/\\evil.example", "/a b", "/a\u0001"]) {
      const p = validateBugReport({ ...good, context: { ...context, page } });
      expect(p.ok && p.value.context.page, page).toBe("");
    }
    expect(isSitePath("/teams/4215?tab=matches")).toBe(true);
  });
  it("needs a category and a long enough description; the email is optional", () => {
    const v = validateBugReport({ category: "nope", message: "short", email: "not-an-email" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.fields).sort()).toEqual(["category", "email", "message"]);
    expect(validateBugReport({ ...good, email: undefined }).ok).toBe(true);
    expect(validateBugReport({ ...good, email: "" }).ok).toBe(true);
  });
  it("refuses a video of 5 MB or more, a second video, too many screenshots and other file types", () => {
    const over = validateBugReport({ ...good, files: [{ type: "video/mp4", bytes: BUG_LIMITS.videoBytes + 1 }] });
    expect(!over.ok && over.fields.files).toMatch(/under 5 MB/);
    expect(validateBugReport({ ...good, files: [{ type: "video/mp4", bytes: BUG_LIMITS.videoBytes }] }).ok).toBe(false);
    expect(validateBugReport({ ...good, files: [{ type: "video/mp4", bytes: BUG_LIMITS.videoBytes - 1 }] }).ok).toBe(true);
    const two = validateBugReport({ ...good, files: [{ type: "video/mp4", bytes: 10 }, { type: "video/webm", bytes: 10 }] });
    expect(!two.ok && two.fields.files).toMatch(/One video/);
    const many = validateBugReport({ ...good, files: Array.from({ length: BUG_LIMITS.images + 1 }, () => ({ type: "image/png", bytes: 10 })) });
    expect(!many.ok && many.fields.files).toMatch(/Up to 6 screenshots/);
    const pdf = validateBugReport({ ...good, files: [{ type: "application/pdf", bytes: 10 }] });
    expect(!pdf.ok && pdf.fields.files).toMatch(/Only images/);
  });
});

describe("sniffType", () => {
  it("reads the type from the first bytes", () => {
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(MP4(64))).toBe("video/mp4");
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("POST /api/bug-reports", () => {
  it("stores a report, takes a pasted screenshot and a video under 5 MB, and emails both to CONTACT_TO", async () => {
    const video = MP4(BUG_LIMITS.videoBytes - 1);
    const r = await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }, { type: "video/mp4", bytes: video.length }] });
    expect(r.status).toBe(200);
    const { id, token } = r.json as { id: number; token: string };
    expect((await upload(id, 0, token, PNG)).status).toBe(200);
    expect((await upload(id, 1, token, video, "video/mp4")).status).toBe(200);
    expect(existsSync(join(bugDir(), `${id}-0.png`))).toBe(true);
    expect(await done(id, token)).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("team@controlscout.test");
    expect(mails[0].subject).toMatch(/^\[Control Scout bug\] Something broken: The rankings table/);
    expect(mails[0].opts?.replyTo).toBe("coach@example.com");
    expect(mails[0].opts?.attachments?.map((a) => a.filename)).toEqual([`bug-${id}-1.png`, `bug-${id}-2.mp4`]);
    expect(mails[0].text).toContain("/teams/4215");
    const list = await listBugReports();
    expect(list.reports[0]).toMatchObject({ id, status: "open", emailed: true, missing: 0, files: [{ n: 0, type: "image/png" }, { n: 1, type: "video/mp4" }] });
    // Sent once: a second "done" doesn't email again.
    await done(id, token);
    expect(mails).toHaveLength(1);
  });

  it("refuses bytes that aren't what was listed, a wrong token, a repeat upload and other slots", async () => {
    const r = await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] });
    const { id, token } = r.json as { id: number; token: string };
    expect((await put(id, 0, "wrong", PNG)).status).toBe(404);
    const html = Buffer.alloc(PNG.length, 32); html.write("<html><script>alert(1)</script>");
    expect((await put(id, 0, token, html)).status).toBe(415);
    expect((await put(id, 0, token, Buffer.concat([PNG, Buffer.alloc(1)]))).status).toBe(400);
    expect((await put(id, 1, token, PNG)).status).toBe(404);
    expect((await put(id, 0, token, PNG)).status).toBe(200);
    expect((await put(id, 0, token, PNG)).status).toBe(409);
  });

  it("takes a video just under 5 MB in pieces under the proxy's 4 MB cap, in order only", async () => {
    const video = MP4(BUG_LIMITS.videoBytes - 1);
    expect(BUG_LIMITS.chunkBytes).toBeLessThan(4 * 1024 * 1024);
    const r = await create({ ...good, files: [{ type: "video/mp4", bytes: video.length }] });
    const { id, token } = r.json as { id: number; token: string };
    // The second piece before the first: refused.
    expect((await put(id, 0, token, video.subarray(BUG_LIMITS.chunkBytes), BUG_LIMITS.chunkBytes, "video/mp4")).status).toBe(409);
    expect((await put(id, 0, token, video.subarray(0, BUG_LIMITS.chunkBytes), 0, "video/mp4")).status).toBe(200);
    // Not finished yet: not an attachment.
    expect((await listBugReports()).reports[0].files).toEqual([]);
    expect((await put(id, 0, token, video.subarray(BUG_LIMITS.chunkBytes), BUG_LIMITS.chunkBytes, "video/mp4")).status).toBe(200);
    expect((await listBugReports()).reports[0].files).toMatchObject([{ type: "video/mp4", bytes: video.length }]);
  });

  it("a piece sent again after its record was lost overwrites itself instead of growing the file", async () => {
    const video = MP4(BUG_LIMITS.videoBytes - 1);
    const r = await create({ ...good, files: [{ type: "video/mp4", bytes: video.length }] });
    const { id, token } = r.json as { id: number; token: string };
    expect((await put(id, 0, token, video.subarray(0, BUG_LIMITS.chunkBytes), 0, "video/mp4")).status).toBe(200);
    // The second piece written, then its record lost (a restart between the write and the update).
    expect((await put(id, 0, token, video.subarray(BUG_LIMITS.chunkBytes), BUG_LIMITS.chunkBytes, "video/mp4")).status).toBe(200);
    // Finished on disk (renamed) but the record lost: the last piece sent again reopens it.
    await run("UPDATE bug_report_files SET received = ? WHERE report_id = ?", [BUG_LIMITS.chunkBytes, id]);
    expect(existsSync(join(bugDir(), `${id}-0.mp4`))).toBe(true);
    expect((await put(id, 0, token, video.subarray(BUG_LIMITS.chunkBytes), BUG_LIMITS.chunkBytes, "video/mp4")).status).toBe(200);
    expect(readFileSync(join(bugDir(), `${id}-0.mp4`)).equals(video)).toBe(true);
  });

  it("refuses a piece of the wrong size before reading it", async () => {
    const r = await create({ ...good, files: [{ type: "video/mp4", bytes: BUG_LIMITS.videoBytes - 1 }] });
    const { id, token } = r.json as { id: number; token: string };
    expect((await put(id, 0, token, MP4(BUG_LIMITS.chunkBytes + 1), 0, "video/mp4")).status).toBe(400);
  });

  it("never lets parallel uploads go past the disk cap", async () => {
    // Storage filled to just under the cap by a stand-in row, then two uploads race for the last of the room.
    await run("INSERT INTO bug_reports (id, created_at, category, message) VALUES (999999, ?, 'other', 'storage filler')", [new Date().toISOString()]);
    const fill = STORAGE_CAP_BYTES - PNG.length - 10;
    await run("INSERT INTO bug_report_files (report_id, n, type, bytes, received, created_at) VALUES (999999, 0, 'image/png', ?, ?, ?)", [fill, fill, new Date().toISOString()]);
    const a = (await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] })).json as { id: number; token: string };
    const b = (await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] })).json as { id: number; token: string };
    const got = (await Promise.all([put(a.id, 0, a.token, PNG), put(b.id, 0, b.token, PNG)])).map((x) => x.status).sort();
    expect(got).toEqual([200, 507]);
  });

  it("emails a report with no attachments without a Reply-To when no email was given", async () => {
    const r = await create({ ...good, email: "" });
    const { id, token } = r.json as { id: number; token: string };
    await done(id, token);
    expect(mails[0].opts?.replyTo).toBeUndefined();
    expect(mails[0].text).toContain("No email given");
  });

  it("answers a filled honeypot like success, storing and sending nothing", async () => {
    const r = await create({ ...good, website: "http://spam.example" });
    expect(r.status).toBe(200);
    expect(await all("SELECT id FROM bug_reports")).toEqual([]);
  });

  it("limits each IP to a few accepted reports an hour", async () => {
    for (let i = 0; i < BUG_RATE.max; i++) expect((await create(good)).status).toBe(200);
    const r = await create(good);
    expect(r.status).toBe(429);
    expect(r.json.error).toMatch(/try again later/);
    // A refused report doesn't use a slot.
    resetBugLimits();
    expect((await create({ ...good, message: "x" })).status).toBe(400);
    expect((await create(good)).status).toBe(200);
  });

  it("takes JSON only", async () => {
    const res = await fetch(`${base}/api/bug-reports`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" });
    expect(res.status).toBe(415);
  });
});

describe("sweepBugReports", () => {
  it("sends again an email that failed, and one for a sender who never finished", async () => {
    failSend = true;
    const a = (await create(good)).json as { id: number; token: string };
    await done(a.id, a.token);
    expect(mails).toEqual([]);
    failSend = false;
    await sweepBugReports();
    expect(mails).toHaveLength(1);
    // Left mid-upload: emailed once the upload window has passed, with what arrived.
    await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] });
    await sweepBugReports();
    expect(mails).toHaveLength(1);
    await sweepBugReports(Date.now() + UPLOAD_WINDOW_MS + 1000);
    expect(mails).toHaveLength(2);
    expect(mails[1].text).toContain("1 attachment was never uploaded");
  });
  it("clears an abandoned upload only after a second window, and never a finished one", async () => {
    const video = MP4(BUG_LIMITS.videoBytes - 1);
    const v = (await create({ ...good, files: [{ type: "video/mp4", bytes: video.length }, { type: "image/png", bytes: PNG.length }] })).json as { id: number; token: string };
    await put(v.id, 0, v.token, video.subarray(0, BUG_LIMITS.chunkBytes), 0, "video/mp4");
    await upload(v.id, 1, v.token, PNG);
    expect((await sweepBugReports(Date.now() + UPLOAD_WINDOW_MS + 1000)).cleared).toBe(0);
    expect((await sweepBugReports(Date.now() + 2 * UPLOAD_WINDOW_MS + 1000)).cleared).toBe(1);
    expect(existsSync(join(bugDir(), `${v.id}-0.part`))).toBe(false);
    expect(existsSync(join(bugDir(), `${v.id}-1.png`))).toBe(true);
  });
  it("takes back a send interrupted by a restart, and gives up after 5 tries", async () => {
    const a = (await create(good)).json as { id: number; token: string };
    await run("UPDATE bug_reports SET emailed = 2, email_claimed_at = ?, email_attempts = 1, done_at = ? WHERE id = ?", [new Date(Date.now() - 3600e3).toISOString(), new Date().toISOString(), a.id]);
    await sweepBugReports();
    expect(mails).toHaveLength(1);
    const b = (await create(good)).json as { id: number; token: string };
    await run("UPDATE bug_reports SET email_attempts = 5, done_at = ? WHERE id = ?", [new Date().toISOString(), b.id]);
    await sweepBugReports();
    expect(mails).toHaveLength(1);
  });
});

describe("owner endpoints", () => {
  it("are refused to anyone who isn't a signed-in owner", async () => {
    expect((await fetch(`${base}/api/owner/bug-reports`)).status).toBe(403);
    expect((await fetch(`${base}/api/owner/bug-reports/1/files/0`)).status).toBe(403);
  });
  it("deleting a report removes its files, finished or still arriving", async () => {
    const r = await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] });
    const { id, token } = r.json as { id: number; token: string };
    await upload(id, 0, token, PNG);
    const video = MP4(BUG_LIMITS.videoBytes - 1);
    const v = (await create({ ...good, files: [{ type: "video/mp4", bytes: video.length }] })).json as { id: number; token: string };
    await put(v.id, 0, v.token, video.subarray(0, BUG_LIMITS.chunkBytes), 0, "video/mp4");
    expect(existsSync(join(bugDir(), `${v.id}-0.part`))).toBe(true);
    expect(await deleteBugReport(id)).toBe(true);
    expect(await deleteBugReport(v.id)).toBe(true);
    expect(existsSync(join(bugDir(), `${id}-0.png`))).toBe(false);
    expect(existsSync(join(bugDir(), `${v.id}-0.part`))).toBe(false);
    // The rest of that video arriving after the delete: refused, nothing left on disk.
    expect((await put(v.id, 0, v.token, video.subarray(BUG_LIMITS.chunkBytes), BUG_LIMITS.chunkBytes, "video/mp4")).status).toBe(404);
    expect(existsSync(join(bugDir(), `${v.id}-0.part`))).toBe(false);
    expect((await listBugReports()).reports).toEqual([]);
  });
  it("lists open and closed reports apart, a page at a time", async () => {
    for (let i = 0; i < 3; i++) await create(good);
    const ids = (await all<{ id: number }>("SELECT id FROM bug_reports ORDER BY id")).map((r) => Number(r.id));
    await run("UPDATE bug_reports SET status = 'done' WHERE id = ?", [ids[0]]);
    const first = await listBugReports("open", null, 1);
    expect(first).toMatchObject({ open: 2, closed: 1, more: true });
    expect(first.reports.map((r) => r.id)).toEqual([ids[2]]);
    expect((await listBugReports("open", ids[2], 1)).reports.map((r) => r.id)).toEqual([ids[1]]);
    expect((await listBugReports("done")).reports.map((r) => r.id)).toEqual([ids[0]]);
  });
});

describe("filing on GitHub", () => {
  beforeEach(async () => {
    process.env.GITHUB_REPORT_TOKEN = TOKEN;
    auditFrom = Number((await all<{ m: number | null }>("SELECT MAX(id) AS m FROM owner_audit"))[0]?.m ?? 0);
  });

  it("files a report with no attachments: [user] title, bug + user-reported, the message in a code fence", async () => {
    const r = await send({ ...good, message: "Rankings jump when I scroll\nOn the event page, every time." });
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.title).toBe("[user] Rankings jump when I scroll");
    expect(issue.labels).toEqual(["bug", "user-reported"]);
    expect(issue.body).toContain("### What happened\n```text\nRankings jump when I scroll\nOn the event page, every time.\n```");
    expect(issue.body).toContain("**Category:** Something broken");
    expect(issue.body).toMatch(/Page: {5}\/teams\/4215\nRelease: {2}4\.8\.1\nScreen: {3}1440×900 @2x\nDevice: {3}Chrome on Windows\nTheme: {4}Dark/);
    expect(issue.body).toContain("**Email:** `coach@example.com`");
    expect(issue.body.trimEnd().endsWith("Filed from the in-app Report a bug button.")).toBe(true);
    expect(issue.body).not.toContain("### Attachments");
    // The dialog gets the real issue; so does the owner console, with nothing left saying it isn't filed.
    expect(await status(r.id, r.token)).toEqual({ state: "filed", number: issue.number, url: `https://github.com/ZOGWORK/control-scout/issues/${issue.number}` });
    const [item] = (await listBugReports()).reports;
    expect(item).toMatchObject({ issue: { number: issue.number, url: `https://github.com/ZOGWORK/control-scout/issues/${issue.number}` }, notFiled: null });
    expect(await audits("bugReport.filed")).toEqual([{ id: r.id, issue: issue.number, route: UPLOAD_ROUTE }]);
  });

  it("uploads a screenshot first, embeds it inline, then deletes the local copy once its URL opens", async () => {
    const r = await send(good, [[PNG, "image/png"]]);
    const uploadAt = calls.findIndex((c) => c.url.startsWith("https://uploads.github.com/user-attachments/assets?"));
    const issueAt = calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/issues"));
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(uploadAt).toBeLessThan(issueAt);
    const up = new URL(calls[uploadAt].url);
    expect(Object.fromEntries(up.searchParams)).toEqual({ name: `bug-${r.id}-1.png`, content_type: "image/png", repository_id: "1416291522" });
    const [{ body }] = issues;
    const img = new RegExp(`!\\[bug-${r.id}-1\\.png\\]\\((https://github\\.com/user-attachments/assets/[0-9a-f-]{36})\\)`).exec(body);
    expect(img).not.toBeNull();
    // Nothing points anywhere but GitHub: no disk path, no site URL, no other host.
    expect(body).not.toMatch(/\/api\/|\.data|bug-reports\/|r2\.|cloudflarestorage|file:/);
    expect(existsSync(join(bugDir(), `${r.id}-0.png`))).toBe(false);
    const list = await listBugReports();
    expect(list.reports[0].files).toEqual([{ n: 0, type: "image/png", bytes: PNG.length, url: null, githubUrl: img![1], uploadError: null }]);
    expect(list.storedBytes).toBe(0);
  });

  it("embeds a video as a bare URL on its own line (GitHub's player)", async () => {
    const r = await send(good, [[MP4(2048), "video/mp4"]]);
    const [{ body }] = issues;
    expect(body).toMatch(/\n\nhttps:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}\n\n/);
    expect(body).not.toContain("![");
    expect(new URL(calls.find((c) => c.url.startsWith("https://uploads."))!.url).searchParams.get("content_type")).toBe("video/mp4");
    expect(existsSync(join(bugDir(), `${r.id}-0.mp4`))).toBe(false);
  });

  it("an upload that fails: the issue has the text, says the attachment failed, and the local copy stays", async () => {
    gitHub.upload = 422;
    const r = await send(good, [[PNG, "image/png"]]);
    const [{ body }] = issues;
    expect(body).toContain(`- bug-${r.id}-1.png (screenshot, 1 KB) failed to upload to GitHub; it's kept with the report.`);
    expect(body).not.toContain("user-attachments");
    expect(existsSync(join(bugDir(), `${r.id}-0.png`))).toBe(true);
    const [item] = (await listBugReports()).reports;
    expect(item.files[0]).toMatchObject({ url: `/api/owner/bug-reports/${r.id}/files/0`, githubUrl: null, uploadError: "GitHub answered 422" });
    expect(item.issue?.number).toBe(issues[0].number);
    expect(await audits("bugReport.filed")).toEqual([{ id: r.id, issue: issues[0].number, route: UPLOAD_ROUTE, uploadFailed: [1] }]);
  });

  it("no token: stored and shown as not filed yet, no fake issue, filed by the sweep once the token is there", async () => {
    delete process.env.GITHUB_REPORT_TOKEN;
    const r = await send(good, [[PNG, "image/png"]]);
    expect(calls).toEqual([]);
    expect(await status(r.id, r.token)).toEqual({ state: "pending" });
    expect((await listBugReports()).reports[0]).toMatchObject({ issue: null, notFiled: NO_TOKEN });
    expect(existsSync(join(bugDir(), `${r.id}-0.png`))).toBe(true);
    process.env.GITHUB_REPORT_TOKEN = TOKEN;
    await sweepBugReports();
    expect(issues).toHaveLength(1);
    expect((await status(r.id, r.token)).state).toBe("filed");
    expect(issues[0].body).toContain("![bug-");
  });

  it("GitHub refusing: says it failed (no issue shown), and a later sweep files it once", async () => {
    gitHub.issue = 401;
    const r = await send(good);
    expect(issues).toEqual([]);
    expect(await status(r.id, r.token)).toEqual({ state: "failed" });
    expect((await listBugReports()).reports[0]).toMatchObject({ issue: null, notFiled: "GitHub refused the issue: GitHub answered 401" });
    expect(await audits("bugReport.fileFailed")).toEqual([{ id: r.id, reason: "GitHub refused the issue: GitHub answered 401", attempt: 1 }]);
    gitHub.issue = 201;
    await sweepBugReports();
    expect(issues).toHaveLength(1);
    await sweepBugReports();
    expect(issues).toHaveLength(1);
  });

  it("a lost reply: the claim waits until stale, then the next try adopts the issue instead of filing twice", async () => {
    gitHub.loseReply = true;
    const r = await send(good);
    expect(issues).toHaveLength(1);
    expect(await status(r.id, r.token)).toEqual({ state: "failed" });
    gitHub.loseReply = false;
    await sweepBugReports();
    expect(issues).toHaveLength(1);
    expect((await status(r.id, r.token)).state).toBe("failed");
    await sweepBugReports(Date.now() + 11 * 60_000);
    expect(issues).toHaveLength(1);
    expect(await status(r.id, r.token)).toMatchObject({ state: "filed", number: issues[0].number });
    expect((await audits("bugReport.filed"))[0]).toMatchObject({ id: r.id, issue: issues[0].number, adopted: true });
  });

  it("files without user-reported when GitHub drops the label, and records it", async () => {
    gitHub.dropLabel = "user-reported";
    const r = await send(good);
    expect(issues[0].labels).toEqual(["bug"]);
    expect((await status(r.id, r.token)).state).toBe("filed");
    expect((await audits("bugReport.filed"))[0]).toMatchObject({ labelsMissing: ["user-reported"] });
  });

  it("sanitizes a token, an email and a URL's query before anything reaches GitHub", async () => {
    const secret = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";
    await send({ ...good, email: "", message: `Login broke for parent@family.example with ${secret} at https://controlscout.example/login?code=abc123#frag`,
      context: { ...context, page: "/login?token=abc123" } });
    const sent = JSON.stringify(calls.map((c) => c.body ?? c.url));
    for (const leak of ["parent@family.example", secret, "code=abc123", "#frag", "token=abc123"]) expect(sent).not.toContain(leak);
    expect(issues[0].body).toContain("Login broke for [redacted] with [redacted] at https://controlscout.example/login");
    expect(issues[0].body).toContain("Page:     /login\n");
    expect(issues[0].body).not.toContain("**Email:**");
  });

  it("never files a report sent before the dialog said it would be public", async () => {
    const r = (await create(good)).json as { id: number; token: string };
    await run("UPDATE bug_reports SET to_github = 0, done_at = ? WHERE id = ?", [new Date().toISOString(), r.id]);
    await sweepBugReports();
    expect(issues).toEqual([]);
    expect((await listBugReports()).reports[0].notFiled).toMatch(/stays private/);
  });

  it("closing or deleting the local report never touches GitHub", async () => {
    const r = await send(good);
    const before = calls.length;
    await run("UPDATE bug_reports SET status = 'done' WHERE id = ?", [r.id]);
    expect(await deleteBugReport(r.id)).toBe(true);
    await sweepBugReports();
    expect(calls.length).toBe(before);
    expect(issues).toHaveLength(1);
  });

  it("an email retried after filing links the attachments on GitHub instead of losing them", async () => {
    failSend = true;
    const r = await send(good, [[PNG, "image/png"]]);
    expect(mails).toEqual([]);
    expect(existsSync(join(bugDir(), `${r.id}-0.png`))).toBe(false);
    failSend = false;
    await sweepBugReports();
    expect(mails).toHaveLength(1);
    expect(mails[0].opts?.attachments ?? []).toEqual([]);
    const url = /!\[[^\]]+\]\(([^)]+)\)/.exec(issues[0].body)![1];
    expect(mails[0].text).toContain(`GitHub issue: https://github.com/ZOGWORK/control-scout/issues/${issues[0].number}`);
    expect(mails[0].text).toContain(`png on GitHub: ${url}`);
  });

  it("still limits each IP to a few reports an hour", async () => {
    for (let i = 0; i < BUG_RATE.max; i++) expect((await create(good)).status).toBe(200);
    expect((await create(good)).status).toBe(429);
  });
});

describe("bugIssueTitle", () => {
  it("uses the first line, cut to length, or the category when that line says nothing", () => {
    expect(bugIssueTitle("  The bracket is wrong  \nmore", "data")).toBe("[user] The bracket is wrong");
    expect(bugIssueTitle("[redacted] !!\nthe rest", "layout")).toBe("[user] Bug report: Looks wrong / layout");
    expect(bugIssueTitle("x".repeat(200), "other")).toHaveLength(7 + 110);
  });
});
