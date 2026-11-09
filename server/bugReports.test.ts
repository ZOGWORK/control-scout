// The bug report path against the real app on an in-memory database: validation, the three steps (report, uploads,
// done), size and type checks on the bytes themselves, the honeypot, the per-IP limit, the email to CONTACT_TO, and
// the owner endpoints behind the owner gate.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { setMailer, type MailOptions } from "./auth/email";
import { BUG_RATE, bugDir, deleteBugReport, emailing, listBugReports, resetBugLimits, validateBugReport } from "./bugReports";
import { BUG_LIMITS, sniffType } from "../src/shared/bugReport";

let server: Server;
let base = "";
let mails: { to: string; subject: string; text: string; opts?: MailOptions }[] = [];
const saved = { to: process.env.CONTACT_TO, dir: process.env.DATA_DIR };
const dir = mkdtempSync(join(tmpdir(), "cs-bugs-"));

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, subject, text, _html, opts) => { mails.push({ to, subject, text, opts }); });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null);
  server?.close();
  for (const [k, v] of [["CONTACT_TO", saved.to], ["DATA_DIR", saved.dir]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  process.env.CONTACT_TO = "team@controlscout.test";
  mails = [];
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
const upload = async (id: number, n: number, token: string, body: Buffer, type = "image/png") => {
  const res = await fetch(`${base}/api/bug-reports/${id}/files/${n}`, { method: "PUT", headers: { "Content-Type": type, "X-Bug-Token": token }, body });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const done = async (id: number, token: string) => {
  const res = await fetch(`${base}/api/bug-reports/${id}/done`, { method: "POST", headers: { "Content-Type": "application/json", "X-Bug-Token": token }, body: "{}" });
  await emailing;
  return res.status;
};

describe("validateBugReport", () => {
  it("cleans a good report and keeps only a path on this site", () => {
    const v = validateBugReport({ ...good, context: { ...context, page: "https://evil.example/x" } });
    expect(v.ok && v.value).toMatchObject({ category: "broken", email: "coach@example.com", context: { page: "" } });
    const p = validateBugReport({ ...good, context: { ...context, page: "//evil.example" } });
    expect(p.ok && p.value.context.page).toBe("");
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
    expect(validateBugReport({ ...good, files: [{ type: "video/mp4", bytes: BUG_LIMITS.videoBytes }] }).ok).toBe(true);
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

  it("refuses bytes that aren't what was listed, a wrong token, a repeat upload and files over the cap", async () => {
    const r = await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] });
    const { id, token } = r.json as { id: number; token: string };
    expect((await upload(id, 0, "wrong", PNG)).status).toBe(404);
    expect((await upload(id, 0, token, Buffer.from("<html><script>alert(1)</script></html>"), "image/png")).status).toBe(415);
    expect((await upload(id, 0, token, Buffer.concat([PNG, Buffer.alloc(1)]))).status).toBe(400);
    expect((await upload(id, 1, token, PNG)).status).toBe(404);
    expect((await upload(id, 0, token, PNG)).status).toBe(200);
    expect((await upload(id, 0, token, PNG)).status).toBe(409);
    const big = await upload(id, 0, token, MP4(BUG_LIMITS.videoBytes + 1), "video/mp4");
    expect(big.status).toBe(413);
    expect(big.json.error).toMatch(/too large/);
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

describe("owner endpoints", () => {
  it("are refused to anyone who isn't a signed-in owner", async () => {
    expect((await fetch(`${base}/api/owner/bug-reports`)).status).toBe(403);
    expect((await fetch(`${base}/api/owner/bug-reports/1/files/0`)).status).toBe(403);
  });
  it("deleting a report removes its files", async () => {
    const r = await create({ ...good, files: [{ type: "image/png", bytes: PNG.length }] });
    const { id, token } = r.json as { id: number; token: string };
    await upload(id, 0, token, PNG);
    expect(await deleteBugReport(id)).toBe(true);
    expect(existsSync(join(bugDir(), `${id}-0.png`))).toBe(false);
    expect((await listBugReports()).reports).toEqual([]);
  });
});
