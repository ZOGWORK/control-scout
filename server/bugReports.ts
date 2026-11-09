// Bug reports from the top bar's "Report a bug" button (the rules: src/shared/bugReport.ts).
//
// No account needed. Three steps:
//   1. POST /api/bug-reports (JSON): the text, the automatic details and the list of attachments to come (type and
//      size each). Validated, stored (bug_reports, no IP address), answered with the report's id and an upload token.
//   2. PUT /api/bug-reports/:id/files/:n?offset=…, header X-Bug-Token: each attachment in pieces of
//      BUG_LIMITS.chunkBytes, in order (the site's proxy refuses requests over 4 MB). Token, slot, offset and length
//      are checked before a byte is read. The first piece reserves the file's space against STORAGE_CAP_BYTES in one
//      statement, and its first bytes must be the declared type (read from the bytes, never the name). Stored on disk
//      in DATA_DIR/bug-reports (the VM keeps DATA_DIR across releases), never in the database.
//   3. POST /api/bug-reports/:id/done: emails the report to CONTACT_TO (read only here and in contact.ts, never sent
//      to the browser) with its screenshots and video attached, the way the contact form reaches the owner.
// The token is kept only as a hash and works for UPLOAD_WINDOW_MS after the report is made.
//
// Email that fails, a server restart mid-send, or a sender who never reached "done": sweepBugReports (every 10
// minutes, server/index.ts) sends what's due again, up to MAX_EMAIL_ATTEMPTS times, and clears abandoned uploads.
//
// Spam: a hidden "website" field (filled in: a normal-looking answer with nothing stored or sent), a per-IP limit on
// accepted reports and one on upload requests.
//
// The owner reads, closes and deletes reports in the owner console (bugReportOwnerRoutes, mounted under /api/owner,
// whose gate already refused everyone else).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, run } from "./db.js";
import { env } from "./env.js";
import { emailEnabled, normalizeEmail, sendEmail, validEmail } from "./auth/email.js";
import {
  attachmentProblem, attachmentsProblem, BUG_CATEGORIES, BUG_LIMITS, chunkLength, EXTENSION, formatBytes, isBugCategory, isSitePath, sniffType,
  type AttachmentType, type BugCategory, type BugContext, type BugReportItem, type BugReportList,
} from "../src/shared/bugReport.js";

/** Per IP: at most this many accepted reports per window. */
export const BUG_RATE = { max: 5, windowMs: 60 * 60_000 };
/** Per IP: upload requests (pieces) per window. A full report is at most 6 screenshots × 2 pieces + 2 for a video. */
export const UPLOAD_RATE = { max: 150, windowMs: 60 * 60_000 };
/** How long after a report its attachments may be uploaded. */
export const UPLOAD_WINDOW_MS = 30 * 60_000;
/** All stored attachments together (reserved when a file's first piece arrives). */
export const STORAGE_CAP_BYTES = 2 * 1024 * 1024 * 1024;
/** Attachments emailed with the report while they add up to no more than this (the rest: open the owner console). */
export const EMAIL_ATTACH_BYTES = 20 * 1024 * 1024;
/** Tries at emailing one report; a send claimed this long ago without an answer counts as failed. */
export const MAX_EMAIL_ATTEMPTS = 5;
const STALE_CLAIM_MS = 10 * 60_000;
const OWNER_PAGE = 50;

/** One per-IP sliding-window limiter. Check and record together, so parallel requests can't slip by. */
function limiter(rate: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  const take = (ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } => {
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < rate.windowMs);
    if (recent.length >= rate.max) {
      hits.set(ip, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((rate.windowMs - (now - recent[0])) / 1000)) };
    }
    if (hits.size > 10_000) for (const [k, ts] of hits) if (!ts.some((t) => now - t < rate.windowMs)) hits.delete(k);
    hits.set(ip, [...recent, now]);
    return { ok: true };
  };
  return { take, reset: () => hits.clear() };
}
const reports = limiter(BUG_RATE);
const uploads = limiter(UPLOAD_RATE);
/** Tests: forget every IP's recent reports and uploads. */
export const resetBugLimits = () => { reports.reset(); uploads.reset(); };

export const bugDir = () => join(env.dataDir, "bug-reports");
const filePath = (id: number, n: number, type: AttachmentType) => join(bugDir(), `${id}-${n}.${EXTENSION[type]}`);
const partPath = (id: number, n: number) => join(bugDir(), `${id}-${n}.part`);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const short = (v: unknown) => text(v).slice(0, BUG_LIMITS.context);
const reason = (e: unknown) => ((e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message ?? "unknown");

export interface BugInput { category: BugCategory; message: string; email: string | null; context: BugContext; files: { type: AttachmentType; bytes: number }[] }
export type BugFieldErrors = Partial<Record<"category" | "message" | "email" | "files", string>>;

/** Checks a submitted report: the cleaned report, or what's wrong with each field. */
export function validateBugReport(body: unknown): { ok: true; value: BugInput } | { ok: false; fields: BugFieldErrors } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: BugFieldErrors = {};
  const category = text(b.category);
  const message = text(b.message);
  const email = b.email == null ? "" : normalizeEmail(text(b.email));
  if (!isBugCategory(category)) fields.category = "Choose what kind of problem it is.";
  if (message.length < BUG_LIMITS.messageMin) fields.message = `Tell us a little more (at least ${BUG_LIMITS.messageMin} characters).`;
  else if (message.length > BUG_LIMITS.messageMax) fields.message = `Keep it under ${BUG_LIMITS.messageMax.toLocaleString("en-US")} characters.`;
  if (email && !validEmail(email)) fields.email = "That doesn't look like an email address.";
  const raw = Array.isArray(b.files) ? b.files : b.files == null ? [] : null;
  const files = (raw ?? []).map((f) => {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return { type: text(o.type), bytes: Number(o.bytes) };
  });
  if (!raw || files.some((f) => !Number.isInteger(f.bytes))) fields.files = "Attachments weren't listed properly.";
  else { const p = attachmentsProblem(files); if (p) fields.files = p; }
  if (Object.keys(fields).length) return { ok: false, fields };
  const c = (b.context && typeof b.context === "object" ? b.context : {}) as Record<string, unknown>;
  // Only a path on this site, safe to link to: anything else (a full URL, "//host", "/\host") is cut to nothing.
  const page = short(c.page);
  const context: BugContext = {
    page: isSitePath(page) ? page : "",
    release: short(c.release), viewport: short(c.viewport), device: short(c.device), theme: short(c.theme),
  };
  return { ok: true, value: { category: category as BugCategory, message, email: email || null, context, files: files as BugInput["files"] } };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const categoryLabel = (c: string) => BUG_CATEGORIES.find((x) => x.id === c)?.label ?? c;

interface ReportRow {
  id: number; created_at: string; category: string; message: string; email: string | null;
  page: string; release: string; viewport: string; device: string; theme: string;
  files_expected: number; files_declared: string; status: string; emailed: number;
}
interface FileRow { report_id: number; n: number; type: string; bytes: number }
const REPORT_COLS = "id, created_at, category, message, email, page, release, viewport, device, theme, files_expected, files_declared, status, emailed";
/** Only finished uploads count as attachments. */
const DONE_FILES = "SELECT report_id, n, type, bytes FROM bug_report_files WHERE received = bytes";

/** The email to the owner: subject, plain text and HTML. `attached`: how many files ride along. */
export function bugEmail(r: ReportRow, files: FileRow[], attached: number) {
  const label = categoryLabel(r.category);
  const first = r.message.replace(/\s+/g, " ").slice(0, 60);
  const subject = `[Control Scout bug] ${label}: ${first}${r.message.length > 60 ? "…" : ""}`;
  const site = env.canonicalUrl.replace(/\/$/, "");
  const link = `${site}/owner?panel=bugs`;
  const details = [
    ["Page", r.page ? `${site}${r.page}` : "—"], ["Version", r.release || "—"],
    ["Screen", r.viewport || "—"], ["Device", r.device || "—"], ["Theme", r.theme || "—"],
    ["From", r.email ?? "No email given"],
  ];
  const fileLine = files.length
    ? `${files.length} attachment${files.length === 1 ? "" : "s"} (${files.map((f) => `${EXTENSION[f.type as AttachmentType] ?? f.type} ${formatBytes(f.bytes)}`).join(", ")})`
      + (attached < files.length ? `; ${attached ? `${attached} attached here, ` : ""}see all in the owner console` : ", attached")
    : "No attachments";
  const missing = r.files_expected - files.length;
  const textBody = `${label}: bug report #${r.id}\n\n${r.message}\n\n${details.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${fileLine}`
    + `${missing > 0 ? `\n${missing} attachment${missing === 1 ? " was" : "s were"} never uploaded.` : ""}\n\nOpen it: ${link}`
    + `${r.email ? "\nReply to this email to answer them." : ""}`;
  const html = `<p><strong>${esc(label)}</strong>: bug report #${r.id}</p><p style="white-space:pre-wrap">${esc(r.message)}</p>`
    + `<table style="font-size:13px;color:#3f3f46">${details.map(([k, v]) => `<tr><td style="padding-right:12px;color:#71717a">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
    + `<p style="font-size:13px">${esc(fileLine)}${missing > 0 ? `<br>${missing} never uploaded.` : ""}</p>`
    + `<p><a href="${esc(link)}">Open bug reports in the owner console</a></p>`;
  return { subject, text: textBody, html };
}

/** The last email started (tests wait on it). */
export let emailing: Promise<void> = Promise.resolve();

/**
 * Emails a report once: the claim on `emailed` (0 → 2) stops a second sender; a claim left by a send that never
 * answered (a restart) goes stale and can be taken again. On failure it's left for the sweep, up to MAX_EMAIL_ATTEMPTS.
 */
async function emailReport(id: number): Promise<void> {
  const to = env.contactTo;
  if (!to || !emailEnabled()) return;
  const now = Date.now();
  const claimed = await get<{ id: number }>(
    `UPDATE bug_reports SET emailed = 2, email_claimed_at = ?, email_attempts = email_attempts + 1
     WHERE id = ? AND email_attempts < ? AND (emailed = 0 OR (emailed = 2 AND email_claimed_at < ?)) RETURNING id`,
    [new Date(now).toISOString(), id, MAX_EMAIL_ATTEMPTS, new Date(now - STALE_CLAIM_MS).toISOString()]);
  if (!claimed) return;
  try {
    const r = (await get<ReportRow>(`SELECT ${REPORT_COLS} FROM bug_reports WHERE id = ?`, [id]))!;
    const files = await all<FileRow>(`${DONE_FILES} AND report_id = ? ORDER BY n`, [id]);
    const attachments: { filename: string; content: Buffer }[] = [];
    let total = 0;
    for (const f of files) {
      if (total + Number(f.bytes) > EMAIL_ATTACH_BYTES) continue;
      const content = await readFile(filePath(id, Number(f.n), f.type as AttachmentType)).catch(() => null);
      if (!content) continue;
      total += content.length;
      attachments.push({ filename: `bug-${id}-${Number(f.n) + 1}.${EXTENSION[f.type as AttachmentType]}`, content });
    }
    const { subject, text: body, html } = bugEmail(r, files, attachments.length);
    await sendEmail(to, subject, body, html, { ...(r.email ? { replyTo: r.email } : {}), attachments });
    await run("UPDATE bug_reports SET emailed = 1 WHERE id = ?", [id]);
  } catch (e) {
    await run("UPDATE bug_reports SET emailed = 0 WHERE id = ? AND emailed = 2", [id]).catch(() => {});
    console.warn(`[bug-reports] report #${id} stored but not emailed (will retry): ${reason(e)}`);
  }
}

/**
 * Every 10 minutes (server/index.ts): emails reports that are due and unsent (finished, or left mid-upload past the
 * upload window; a failed or interrupted send included), and clears uploads left unfinished past the window.
 */
export async function sweepBugReports(now = Date.now()): Promise<{ emailed: number; cleared: number }> {
  const closed = new Date(now - UPLOAD_WINDOW_MS).toISOString();
  const due = await all<{ id: number }>(
    `SELECT id FROM bug_reports WHERE emailed != 1 AND email_attempts < ? AND (done_at IS NOT NULL OR created_at < ?)
       AND (emailed = 0 OR email_claimed_at < ?) ORDER BY id LIMIT 20`,
    [MAX_EMAIL_ATTEMPTS, closed, new Date(now - STALE_CLAIM_MS).toISOString()]);
  for (const { id } of due) await emailReport(Number(id));
  const stale = await all<FileRow>("SELECT report_id, n, type, bytes FROM bug_report_files WHERE received < bytes AND created_at < ?", [closed]);
  for (const f of stale) {
    await run("DELETE FROM bug_report_files WHERE report_id = ? AND n = ? AND received < bytes", [f.report_id, f.n]);
    await rm(partPath(Number(f.report_id), Number(f.n)), { force: true });
    await rm(filePath(Number(f.report_id), Number(f.n), f.type as AttachmentType), { force: true });
  }
  return { emailed: due.length, cleared: stale.length };
}

type Upload = { row: ReportRow; n: number; offset: number; length: number; declared: { type: AttachmentType; bytes: number } };

/** The report a token opens for uploads, or why not (status and message). */
async function openForUpload(req: Request): Promise<{ ok: true; row: ReportRow } | { ok: false; status: number; error: string }> {
  const id = Number(req.params.id);
  const token = String(req.get("x-bug-token") ?? "");
  const row = Number.isInteger(id) && id > 0
    ? await get<ReportRow & { token_hash: string | null }>(`SELECT ${REPORT_COLS}, token_hash FROM bug_reports WHERE id = ?`, [id])
    : undefined;
  const a = Buffer.from(hash(token)), b = Buffer.from(row?.token_hash ?? "");
  if (!row || !token || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 404, error: "No such report." };
  if (Date.now() - Date.parse(row.created_at) > UPLOAD_WINDOW_MS) return { ok: false, status: 410, error: "This report is closed for uploads. Send a new one to add more." };
  return { ok: true, row };
}

/** One upload at a time per file (this process serves every upload): pieces can't interleave or race. */
const busy = new Set<string>();

/**
 * Everything checkable before the body is read: the per-IP limit, the token, the slot, the piece's offset and
 * length, and (on a file's first piece) the reservation against the disk cap. Answers itself when something's wrong.
 */
async function checkUpload(req: Request, res: Response): Promise<Upload | null> {
  const fail = (status: number, error: string) => { res.status(status).json({ error }); return null; };
  const slot = uploads.take(req.ip ?? "?");
  if (!slot.ok) { res.setHeader("Retry-After", String(slot.retryAfter)); return fail(429, "Too many uploads in the last hour. Please try again later."); }
  const open = await openForUpload(req);
  if (!open.ok) return fail(open.status, open.error);
  const row = open.row, n = Number(req.params.n);
  const declared = Number.isInteger(n) && n >= 0 ? (JSON.parse(row.files_declared || "[]") as Upload["declared"][])[n] : undefined;
  if (!declared) return fail(404, "This report didn't list that attachment.");
  const offset = Number(req.query.offset ?? 0);
  const length = chunkLength(declared.bytes, offset);
  if (!length) return fail(400, "That piece of the file isn't one this upload expects.");
  if (Number(req.get("content-length")) !== length) return fail(400, "That file isn't the one this report listed.");
  if (offset === 0) {
    // Reserve the whole file's space in one statement: two uploads can't both take the last of the room.
    const reserved = await get<{ n: number }>(
      `INSERT INTO bug_report_files (report_id, n, type, bytes, received, created_at)
       SELECT ?, ?, ?, ?, 0, ? WHERE (SELECT COALESCE(SUM(bytes), 0) FROM bug_report_files) + ? <= ?
       ON CONFLICT DO NOTHING RETURNING n`,
      [row.id, n, declared.type, declared.bytes, new Date().toISOString(), declared.bytes, STORAGE_CAP_BYTES]);
    if (!reserved) {
      const had = await get<{ received: number }>("SELECT received FROM bug_report_files WHERE report_id = ? AND n = ?", [row.id, n]);
      if (!had) return fail(507, "Attachment storage is full right now. Your report will still be sent, without this file.");
      if (Number(had.received) > 0) return fail(409, "That attachment is already uploaded.");
      // A first piece tried again (the last try failed before any bytes were kept): carry on.
    }
  } else {
    const had = await get<{ received: number }>("SELECT received FROM bug_report_files WHERE report_id = ? AND n = ?", [row.id, n]);
    if (!had || Number(had.received) !== offset) return fail(409, "Upload the file's pieces in order, from the start.");
  }
  return { row, n, offset, length, declared };
}

/**
 * Writes one piece at its own offset (a piece sent again overwrites itself, never appends twice) and cuts the file to
 * the end of that piece, then records it. The first piece's bytes must be the declared type.
 */
async function storePiece(req: Request, res: Response, { row, n, offset, length, declared }: Upload): Promise<void> {
  const id = Number(row.id);
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.length !== length) { res.status(400).json({ error: "That file isn't the one this report listed." }); return; }
  if (offset === 0) {
    // The type the bytes say, never the name: it must be what the report listed, within its size cap.
    const type = sniffType(body);
    const problem = !type ? "Only images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM, MOV) can be attached." : attachmentProblem(type, declared.bytes);
    const wrong = problem ?? (type !== declared.type ? "That file isn't the one this report listed." : null);
    if (wrong) {
      await run("DELETE FROM bug_report_files WHERE report_id = ? AND n = ? AND received = 0", [id, n]);
      res.status(problem ? 415 : 400).json({ error: wrong });
      return;
    }
  }
  await mkdir(bugDir(), { recursive: true });
  const part = partPath(id, n);
  const final = filePath(id, n, declared.type);
  // The last piece sent again after the file was finished but before that was recorded (a restart): reopen it.
  if (offset > 0 && !existsSync(part) && existsSync(final)) await rename(final, part);
  const fh = await open(part, offset === 0 ? "w" : "r+");
  try {
    await fh.write(body, 0, length, offset);
    await fh.truncate(offset + length);
  } finally { await fh.close(); }
  // Finished: the file takes its name first, then the record says so. A stop in between leaves it unrecorded, so the
  // last piece can be sent again (above); the record never points at a file that isn't there.
  if (offset + length === declared.bytes) await rename(part, final);
  const now = await get<{ received: number }>("UPDATE bug_report_files SET received = ? WHERE report_id = ? AND n = ? AND received = ? RETURNING received",
    [offset + length, id, n, offset]);
  // Deleted while this piece was being written: take the file away too, so nothing is left without a report.
  if (!(await get("SELECT id FROM bug_reports WHERE id = ?", [id]))) {
    await rm(part, { force: true });
    await rm(final, { force: true });
    res.status(404).json({ error: "No such report." });
    return;
  }
  if (!now) { res.status(409).json({ error: "Upload the file's pieces in order, from the start." }); return; }
  res.json({ ok: true, received: Number(now.received) });
}

export function bugReportsRouter(): Router {
  const r = express.Router();
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).then((body) => { if (!res.headersSent && body !== undefined) res.json(body); }).catch(next);
  };

  r.post("/", h(async (req, res) => {
    // JSON only: a cross-site form can't post JSON without a preflight we never allow.
    if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    const ip = req.ip ?? "?";
    // Honeypot filled: look like success, keep and send nothing (but count it, so a bot is still slowed).
    if (text(req.body?.website)) { reports.take(ip); return { id: 0, token: randomBytes(24).toString("hex") }; }
    const v = validateBugReport(req.body);
    if (!v.ok) { res.status(400).json({ error: "Check the highlighted fields.", fields: v.fields }); return; }
    const slot = reports.take(ip);
    if (!slot.ok) {
      res.setHeader("Retry-After", String(slot.retryAfter));
      res.status(429).json({ error: "You've sent several bug reports in the last hour. Please try again later.", retryAfter: slot.retryAfter });
      return;
    }
    const m = v.value, c = m.context;
    const token = randomBytes(24).toString("hex");
    const row = await get<{ id: number }>(
      `INSERT INTO bug_reports (created_at, category, message, email, page, release, viewport, device, theme, files_expected, files_declared, token_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [new Date().toISOString(), m.category, m.message, m.email, c.page, c.release, c.viewport, c.device, c.theme, m.files.length, JSON.stringify(m.files), hash(token)],
    );
    return { id: Number(row!.id), token };
  }));

  const raw = express.raw({ type: () => true, limit: BUG_LIMITS.chunkBytes });
  r.put("/:id/files/:n", (req: Request, res: Response, next: NextFunction) => {
    // Keyed by the numbers the files are named by ("01" is report 1), held until this request is fully handled.
    const key = `${Number(req.params.id)}-${Number(req.params.n)}`;
    if (busy.has(key)) { res.status(409).json({ error: "This attachment is already uploading." }); return; }
    busy.add(key);
    (async () => {
      try {
        const u = await checkUpload(req, res);
        if (!u) return;
        const err = await new Promise<unknown>((done) => raw(req, res, done));
        if (err) throw err;
        await storePiece(req, res, u);
      } finally { busy.delete(key); }
    })().catch(next);
  });

  r.post("/:id/done", h(async (req, res) => {
    if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    const open = await openForUpload(req);
    if (!open.ok) { res.status(open.status).json({ error: open.error }); return; }
    await run("UPDATE bug_reports SET done_at = COALESCE(done_at, ?) WHERE id = ?", [new Date().toISOString(), open.row.id]);
    // Answered at once: the email (with attachments) goes out after; a failed one is retried by the sweep.
    emailing = emailReport(open.row.id);
    return { ok: true };
  }));
  return r;
}

// --- Owner console --------------------------------------------------------------------------------

type Handler = (req: Request, res: Response) => Promise<unknown>;
type Wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => void;

/** One page of reports, newest first: open ones or closed ones, older than report `before` when given. */
export async function listBugReports(status: "open" | "done" = "open", before: number | null = null, limit = OWNER_PAGE): Promise<BugReportList> {
  const rows = await all<ReportRow>(
    `SELECT ${REPORT_COLS} FROM bug_reports WHERE status = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    [status, ...(before ? [before] : []), limit + 1]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const files = page.length
    ? await all<FileRow>(`${DONE_FILES} AND report_id IN (${page.map(() => "?").join(", ")}) ORDER BY report_id, n`, page.map((r) => r.id))
    : [];
  const counts = await get<{ open: number | null; closed: number | null }>(
    "SELECT SUM(status = 'open') AS open, SUM(status = 'done') AS closed FROM bug_reports");
  const stored = Number((await get<{ s: number | null }>("SELECT SUM(bytes) AS s FROM bug_report_files"))?.s ?? 0);
  const reportsOut: BugReportItem[] = page.map((r) => {
    const own = files.filter((f) => Number(f.report_id) === Number(r.id));
    return {
      id: Number(r.id), createdAt: r.created_at, category: r.category as BugCategory, message: r.message, email: r.email,
      context: { page: r.page, release: r.release, viewport: r.viewport, device: r.device, theme: r.theme },
      status: r.status === "done" ? "done" : "open", emailed: Number(r.emailed) === 1,
      missing: Math.max(0, Number(r.files_expected) - own.length),
      files: own.map((f) => ({ n: Number(f.n), type: f.type, bytes: Number(f.bytes), url: `/api/owner/bug-reports/${r.id}/files/${f.n}` })),
    };
  });
  return { reports: reportsOut, open: Number(counts?.open ?? 0), closed: Number(counts?.closed ?? 0), more, storedBytes: stored, capBytes: STORAGE_CAP_BYTES };
}

/**
 * Deletes a report and its files. The rows go first (an upload still being written sees its report gone and removes
 * its own file), then every file on disk named for the report, finished or not.
 */
export async function deleteBugReport(id: number): Promise<boolean> {
  await run("DELETE FROM bug_report_files WHERE report_id = ?", [id]);
  const gone = await get<{ id: number }>("DELETE FROM bug_reports WHERE id = ? RETURNING id", [id]);
  const names = await readdir(bugDir()).catch(() => [] as string[]);
  for (const name of names) if (name.startsWith(`${id}-`)) await rm(join(bugDir(), name), { force: true });
  return !!gone;
}

export function bugReportOwnerRoutes(r: Router, h: Wrap, actor: (req: Request) => string, audit: (who: string, what: string, detail: Record<string, unknown>) => Promise<void>) {
  r.get("/bug-reports", h(async (req) => {
    const before = Number(req.query.before);
    return listBugReports(req.query.status === "done" ? "done" : "open", Number.isInteger(before) && before > 0 ? before : null);
  }));

  // One attachment, for the console's thumbnails and player. Never run as a page: its own type, no sniffing, sandboxed.
  r.get("/bug-reports/:id/files/:n", h(async (req, res) => {
    const id = Number(req.params.id), n = Number(req.params.n);
    const f = Number.isInteger(id) && Number.isInteger(n) ? await get<FileRow>(`${DONE_FILES} AND report_id = ? AND n = ?`, [id, n]) : undefined;
    const body = f ? await readFile(filePath(id, n, f.type as AttachmentType)).catch(() => null) : null;
    if (!f || !body) { res.status(404).json({ error: "No such attachment" }); return; }
    res.setHeader("Content-Type", f.type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Disposition", `inline; filename="bug-${id}-${n + 1}.${EXTENSION[f.type as AttachmentType]}"`);
    res.end(body);
  }));

  r.patch("/bug-reports/:id", h(async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    if (!Number.isInteger(id) || (status !== "open" && status !== "done")) { res.status(400).json({ error: "status must be open or done" }); return; }
    const row = await get<{ id: number }>("UPDATE bug_reports SET status = ? WHERE id = ? RETURNING id", [status, id]);
    if (!row) { res.status(404).json({ error: "No such report" }); return; }
    await audit(actor(req), "bugReport.status", { id, status });
    return { ok: true };
  }));

  r.delete("/bug-reports/:id", h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await deleteBugReport(id))) { res.status(404).json({ error: "No such report" }); return; }
    await audit(actor(req), "bugReport.delete", { id });
    return { ok: true };
  }));
}
