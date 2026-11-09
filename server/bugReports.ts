// Bug reports from the top bar's "Report a bug" button (docs: src/shared/bugReport.ts for the rules).
//
// No account needed. Three steps, so each attachment is its own request with its own size cap:
//   1. POST /api/bug-reports (JSON): the text, the automatic details and the list of attachments to come (type and
//      size each). Validated, stored (bug_reports, no IP address), answered with the report's id and an upload token.
//   2. PUT /api/bug-reports/:id/files/:n, one per attachment: the raw bytes, header X-Bug-Token. The bytes must be
//      what was declared: the type read from the file's first bytes (never its name), the size, under the caps.
//      Stored on disk in DATA_DIR/bug-reports (the VM keeps DATA_DIR across releases), never in the database.
//   3. POST /api/bug-reports/:id/done: emails the report to CONTACT_TO (read only here and in contact.ts, never sent
//      to the browser), screenshots and video attached, the way the contact form reaches the owner.
// The token is kept only as a hash and works for UPLOAD_WINDOW_MS after the report is made.
//
// Spam: a hidden "website" field (filled in: a normal-looking answer with nothing stored or sent) and a per-IP
// limit on accepted reports. Disk: all attachments together stay under STORAGE_CAP_BYTES; past it, a report still
// arrives, without its files.
//
// The owner reads, closes and deletes reports in the owner console (bugReportOwnerRoutes, mounted under /api/owner,
// whose gate already refused everyone else).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, run } from "./db.js";
import { env } from "./env.js";
import { emailEnabled, normalizeEmail, sendEmail, validEmail } from "./auth/email.js";
import {
  attachmentProblem, attachmentsProblem, BUG_CATEGORIES, BUG_LIMITS, EXTENSION, formatBytes, isBugCategory, sniffType,
  type AttachmentType, type BugCategory, type BugContext, type BugReportItem, type BugReportList,
} from "../src/shared/bugReport.js";

/** Per IP: at most this many accepted reports per window. */
export const BUG_RATE = { max: 5, windowMs: 60 * 60_000 };
/** How long after a report its attachments may be uploaded. */
export const UPLOAD_WINDOW_MS = 30 * 60_000;
/** All stored attachments together. */
export const STORAGE_CAP_BYTES = 2 * 1024 * 1024 * 1024;
/** Attachments emailed with the report while they add up to no more than this (the rest: open the owner console). */
export const EMAIL_ATTACH_BYTES = 20 * 1024 * 1024;

const sent = new Map<string, number[]>();
/** Tests: forget every IP's recent reports. */
export const resetBugLimits = () => sent.clear();

/** Takes one slot for this IP, or says how long to wait. Check and record together, so parallel requests can't slip by. */
function takeSlot(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const recent = (sent.get(ip) ?? []).filter((t) => now - t < BUG_RATE.windowMs);
  if (recent.length >= BUG_RATE.max) {
    sent.set(ip, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((BUG_RATE.windowMs - (now - recent[0])) / 1000)) };
  }
  if (sent.size > 10_000) for (const [k, ts] of sent) if (!ts.some((t) => now - t < BUG_RATE.windowMs)) sent.delete(k);
  sent.set(ip, [...recent, now]);
  return { ok: true };
}

export const bugDir = () => join(env.dataDir, "bug-reports");
const filePath = (id: number, n: number, type: AttachmentType) => join(bugDir(), `${id}-${n}.${EXTENSION[type]}`);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const short = (v: unknown) => text(v).slice(0, BUG_LIMITS.context);

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
  // Only a path on this site: a full URL elsewhere (or a scheme) is cut to nothing.
  const page = short(c.page);
  const context: BugContext = {
    page: page.startsWith("/") && !page.startsWith("//") ? page : "",
    release: short(c.release), viewport: short(c.viewport), device: short(c.device), theme: short(c.theme),
  };
  return { ok: true, value: { category: category as BugCategory, message, email: email || null, context, files: files as BugInput["files"] } };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const categoryLabel = (c: string) => BUG_CATEGORIES.find((x) => x.id === c)?.label ?? c;

interface ReportRow {
  id: number; created_at: string; category: string; message: string; email: string | null;
  page: string; release: string; viewport: string; device: string; theme: string;
  files_expected: number; status: string; emailed: number;
}
interface FileRow { report_id: number; n: number; type: string; bytes: number }

/** The email to the owner: subject, plain text and HTML. `attached`: how many files ride along. */
export function bugEmail(r: ReportRow, files: FileRow[], attached: number) {
  const label = categoryLabel(r.category);
  const first = r.message.replace(/\s+/g, " ").slice(0, 60);
  const subject = `[Control Scout bug] ${label}: ${first}${r.message.length > 60 ? "…" : ""}`;
  const link = `${env.canonicalUrl.replace(/\/$/, "")}/owner?panel=bugs`;
  const details = [
    ["Page", r.page ? `${env.canonicalUrl.replace(/\/$/, "")}${r.page}` : "—"], ["Version", r.release || "—"],
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

/** Emails a report once (a claim on `emailed` stops a second send); left unsent on failure, the reason logged. */
async function emailReport(id: number): Promise<void> {
  const to = env.contactTo;
  if (!to || !emailEnabled()) return;
  const claimed = await get<{ id: number }>("UPDATE bug_reports SET emailed = 2 WHERE id = ? AND emailed = 0 RETURNING id", [id]);
  if (!claimed) return;
  try {
    const r = (await get<ReportRow>("SELECT id, created_at, category, message, email, page, release, viewport, device, theme, files_expected, status, emailed FROM bug_reports WHERE id = ?", [id]))!;
    const files = await all<FileRow>("SELECT report_id, n, type, bytes FROM bug_report_files WHERE report_id = ? ORDER BY n", [id]);
    const attachments: { filename: string; content: Buffer }[] = [];
    let total = 0;
    for (const f of files) {
      if (total + f.bytes > EMAIL_ATTACH_BYTES) continue;
      const content = await readFile(filePath(id, f.n, f.type as AttachmentType)).catch(() => null);
      if (!content) continue;
      total += f.bytes;
      attachments.push({ filename: `bug-${id}-${f.n + 1}.${EXTENSION[f.type as AttachmentType]}`, content });
    }
    const { subject, text: body, html } = bugEmail(r, files, attachments.length);
    await sendEmail(to, subject, body, html, { ...(r.email ? { replyTo: r.email } : {}), attachments });
    await run("UPDATE bug_reports SET emailed = 1 WHERE id = ?", [id]);
  } catch (e) {
    await run("UPDATE bug_reports SET emailed = 0 WHERE id = ?", [id]).catch(() => {});
    console.warn(`[bug-reports] report #${id} stored but not emailed: ${(e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message ?? "unknown"}`);
  }
}

/** The report a token opens for uploads, or why not (status and message). */
async function openForUpload(req: Request): Promise<{ ok: true; row: ReportRow & { files_declared: string } } | { ok: false; status: number; error: string }> {
  const id = Number(req.params.id);
  const token = String(req.get("x-bug-token") ?? "");
  const row = Number.isInteger(id) && id > 0
    ? await get<ReportRow & { token_hash: string | null; files_declared: string }>("SELECT id, created_at, category, message, email, page, release, viewport, device, theme, files_expected, status, emailed, token_hash, files_declared FROM bug_reports WHERE id = ?", [id])
    : undefined;
  const a = Buffer.from(hash(token)), b = Buffer.from(row?.token_hash ?? "");
  if (!row || !token || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 404, error: "No such report." };
  if (Date.now() - Date.parse(row.created_at) > UPLOAD_WINDOW_MS) return { ok: false, status: 410, error: "This report is closed for uploads. Send a new one to add more." };
  return { ok: true, row };
}

const tooLarge = (_err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const e = _err as { type?: string };
  if (e?.type === "entity.too.large") { res.status(413).json({ error: `That file is too large: screenshots and videos can be up to ${formatBytes(BUG_LIMITS.videoBytes)}.` }); return; }
  next(_err);
};

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
    if (text(req.body?.website)) { takeSlot(ip); return { id: 0, token: randomBytes(24).toString("hex") }; }
    const v = validateBugReport(req.body);
    if (!v.ok) { res.status(400).json({ error: "Check the highlighted fields.", fields: v.fields }); return; }
    const slot = takeSlot(ip);
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

  r.put("/:id/files/:n", (req: Request, res: Response, next: NextFunction) => {
    // Refused before reading a byte when the size alone is over every cap.
    const len = Number(req.get("content-length"));
    if (Number.isFinite(len) && len > Math.max(BUG_LIMITS.imageBytes, BUG_LIMITS.videoBytes)) {
      res.status(413).json({ error: `That file is too large: screenshots and videos can be up to ${formatBytes(BUG_LIMITS.videoBytes)}.` });
      return;
    }
    next();
  }, express.raw({ type: () => true, limit: Math.max(BUG_LIMITS.imageBytes, BUG_LIMITS.videoBytes) }), tooLarge, h(async (req, res) => {
    const open = await openForUpload(req);
    if (!open.ok) { res.status(open.status).json({ error: open.error }); return; }
    const id = open.row.id;
    const n = Number(req.params.n);
    const declared = Number.isInteger(n) && n >= 0 ? (JSON.parse(open.row.files_declared || "[]") as { type: string; bytes: number }[])[n] : undefined;
    if (!declared) { res.status(404).json({ error: "This report didn't list that attachment." }); return; }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = sniffType(body);
    const problem = !type ? "Only images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM, MOV) can be attached." : attachmentProblem(type, body.length);
    if (problem) { res.status(problem.includes("up to") || problem.includes("under") ? 413 : 415).json({ error: problem }); return; }
    if (type !== declared.type || body.length !== Number(declared.bytes)) { res.status(400).json({ error: "That file isn't the one this report listed." }); return; }
    const used = Number((await get<{ s: number | null }>("SELECT SUM(bytes) AS s FROM bug_report_files"))?.s ?? 0);
    if (used + body.length > STORAGE_CAP_BYTES) { res.status(507).json({ error: "Attachment storage is full right now. Your report was still sent, without this file." }); return; }
    // The row first: a second upload of the same file is refused here, before anything touches the disk.
    const claimed = await get<{ n: number }>("INSERT INTO bug_report_files (report_id, n, type, bytes, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING n",
      [id, n, type, body.length, new Date().toISOString()]);
    if (!claimed) { res.status(409).json({ error: "That attachment is already uploaded." }); return; }
    try {
      await mkdir(bugDir(), { recursive: true });
      await writeFile(filePath(id, n, type!), body);
    } catch (e) {
      await run("DELETE FROM bug_report_files WHERE report_id = ? AND n = ?", [id, n]);
      throw e;
    }
    return { ok: true };
  }));

  r.post("/:id/done", h(async (req, res) => {
    if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    const open = await openForUpload(req);
    if (!open.ok) { res.status(open.status).json({ error: open.error }); return; }
    // Answered at once: the email (with attachments) goes out after.
    emailing = emailReport(open.row.id);
    return { ok: true };
  }));
  return r;
}

// --- Owner console --------------------------------------------------------------------------------

type Handler = (req: Request, res: Response) => Promise<unknown>;
type Wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => void;

/** Every report, newest first (open ones and closed ones), with its attachments. */
export async function listBugReports(limit = 200): Promise<BugReportList> {
  const rows = await all<ReportRow>(
    "SELECT id, created_at, category, message, email, page, release, viewport, device, theme, files_expected, status, emailed FROM bug_reports ORDER BY id DESC LIMIT ?", [limit]);
  const files = rows.length
    ? await all<FileRow>(`SELECT report_id, n, type, bytes FROM bug_report_files WHERE report_id IN (${rows.map(() => "?").join(", ")}) ORDER BY report_id, n`, rows.map((r) => r.id))
    : [];
  const open = Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM bug_reports WHERE status = 'open'"))?.n ?? 0);
  const stored = Number((await get<{ s: number | null }>("SELECT SUM(bytes) AS s FROM bug_report_files"))?.s ?? 0);
  const reports: BugReportItem[] = rows.map((r) => {
    const own = files.filter((f) => Number(f.report_id) === Number(r.id));
    return {
      id: Number(r.id), createdAt: r.created_at, category: r.category as BugCategory, message: r.message, email: r.email,
      context: { page: r.page, release: r.release, viewport: r.viewport, device: r.device, theme: r.theme },
      status: r.status === "done" ? "done" : "open", emailed: Number(r.emailed) === 1,
      missing: Math.max(0, Number(r.files_expected) - own.length),
      files: own.map((f) => ({ n: Number(f.n), type: f.type, bytes: Number(f.bytes), url: `/api/owner/bug-reports/${r.id}/files/${f.n}` })),
    };
  });
  return { reports, open, storedBytes: stored, capBytes: STORAGE_CAP_BYTES };
}

/** Deletes a report and its files (files first: a crash between leaves an orphan row, never an orphan file). */
export async function deleteBugReport(id: number): Promise<boolean> {
  const files = await all<FileRow>("SELECT report_id, n, type, bytes FROM bug_report_files WHERE report_id = ?", [id]);
  for (const f of files) await rm(filePath(id, Number(f.n), f.type as AttachmentType), { force: true });
  await run("DELETE FROM bug_report_files WHERE report_id = ?", [id]);
  const gone = await get<{ id: number }>("DELETE FROM bug_reports WHERE id = ? RETURNING id", [id]);
  return !!gone;
}

export function bugReportOwnerRoutes(r: Router, h: Wrap, actor: (req: Request) => string, audit: (who: string, what: string, detail: Record<string, unknown>) => Promise<void>) {
  r.get("/bug-reports", h(async () => listBugReports()));

  // One attachment, for the console's thumbnails and player. Never run as a page: its own type, no sniffing, sandboxed.
  r.get("/bug-reports/:id/files/:n", h(async (req, res) => {
    const id = Number(req.params.id), n = Number(req.params.n);
    const f = Number.isInteger(id) && Number.isInteger(n) ? await get<FileRow>("SELECT report_id, n, type, bytes FROM bug_report_files WHERE report_id = ? AND n = ?", [id, n]) : undefined;
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
