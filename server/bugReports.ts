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
//   3. POST /api/bug-reports/:id/done: answered at once. Then, in the background: emails the report to CONTACT_TO
//      (read only here and in contact.ts, never sent to the browser), and files it as a public GitHub issue on
//      ZOGWORK/control-scout (fileBugReport, below). GET /api/bug-reports/:id/status tells the dialog when the issue
//      exists, with its real number and address.
// The token is kept only as a hash and works for UPLOAD_WINDOW_MS after the report is made.
//
// One report = one issue "[user] <first line>", labels bug + user-reported, no dedupe across reports. Attachments are
// uploaded to GitHub first (the request `gh issue create --attach` makes, server/errorReports.ts uploadAsset), then
// the issue is opened with them embedded: images inline, a video as a bare URL (GitHub's player). An upload that fails
// is named in the issue as failed and its file stays on disk for the owner console. Once the issue exists and each
// uploaded URL opens, the local copy is deleted and the console links to GitHub. Filing reuses the auto error
// reporter's token (GITHUB_REPORT_TOKEN) and its claim + adopt thinking: a claim stops two filers, and a try whose
// reply was lost finds its issue by the report id in the body instead of filing a second one. No token, GitHub down
// or a refusal: the report is kept as it is and filed by a later sweep. The text is sanitized in the browser and again
// here (src/shared/errorReport.ts sanitizeText) before it's stored; the page goes to GitHub as a bare path.
//
// Email that fails, a server restart mid-send, or a sender who never reached "done": sweepBugReports (every 10
// minutes, server/index.ts) sends what's due again, up to MAX_EMAIL_ATTEMPTS times, files what isn't filed yet,
// deletes local copies whose GitHub URLs now open, and clears abandoned uploads.
//
// Spam: a hidden "website" field (filled in: a normal-looking answer with nothing stored or sent), a per-IP limit on
// accepted reports and one on upload requests.
//
// The owner reads, closes and deletes reports in the owner console (bugReportOwnerRoutes, mounted under /api/owner,
// whose gate already refused everyone else). A filed report follows its issue: once the issue is closed on GitHub the
// report closes here too, with the PR or commit that closed it (syncBugIssues: one GraphQL request per 50 open reports,
// from the sweep and, at most once a minute, when the console loads the list). Closing or deleting the report here
// never touches the issue.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, run } from "./db.js";
import { env } from "./env.js";
import { emailEnabled, normalizeEmail, sendEmail, validEmail } from "./auth/email.js";
import { recordAudit } from "./portal/audit.js";
import { assetOpens, fenced, gh, GITHUB_REPO, GithubError, issueStates, refused, syncErrorIssues, uploadAsset, type IssueState } from "./errorReports.js";
import {
  attachmentProblem, attachmentsProblem, BUG_CATEGORIES, BUG_LIMITS, chunkLength, EXTENSION, formatBytes, isBugCategory, isSitePath, isVideoType, sniffType,
  type AttachmentType, type BugCategory, type BugContext, type BugFiling, type BugReportItem, type BugReportList,
} from "../src/shared/bugReport.js";
import { REDACTED, sanitizeRoute, sanitizeText } from "../src/shared/errorReport.js";

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

/** One upload at a time per file (this process serves every upload): pieces can't interleave or race, and the
 *  sweep leaves a file alone while it's being written. Keyed "<report id>-<n>". */
const busy = new Set<string>();

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
  // Sanitized again here (the dialog already did): what's stored is what can go on the public issue.
  return { ok: true, value: { category: category as BugCategory, message: sanitizeText(message, BUG_LIMITS.messageMax), email: email || null, context, files: files as BugInput["files"] } };
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

/** The email to the owner: subject, plain text and HTML. `attached`: how many files ride along. A file whose local
 *  copy was deleted after it went to GitHub (`github_url`) is linked there instead. */
export function bugEmail(r: ReportRow & { issue_url?: string | null }, files: (FileRow & { github_url?: string | null })[], attached: number) {
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
  const onGithub = files.filter((f) => f.github_url).map((f) => `${EXTENSION[f.type as AttachmentType] ?? f.type} on GitHub: ${f.github_url}`);
  if (r.issue_url) onGithub.unshift(`GitHub issue: ${r.issue_url}`);
  const textBody = `${label}: bug report #${r.id}\n\n${r.message}\n\n${details.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${fileLine}`
    + `${missing > 0 ? `\n${missing} attachment${missing === 1 ? " was" : "s were"} never uploaded.` : ""}`
    + `${onGithub.length ? `\n${onGithub.join("\n")}` : ""}\n\nOpen it: ${link}`
    + `${r.email ? "\nReply to this email to answer them." : ""}`;
  const html = `<p><strong>${esc(label)}</strong>: bug report #${r.id}</p><p style="white-space:pre-wrap">${esc(r.message)}</p>`
    + `<table style="font-size:13px;color:#3f3f46">${details.map(([k, v]) => `<tr><td style="padding-right:12px;color:#71717a">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
    + `<p style="font-size:13px">${esc(fileLine)}${missing > 0 ? `<br>${missing} never uploaded.` : ""}${onGithub.map((l) => `<br>${esc(l)}`).join("")}</p>`
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
    const r = (await get<ReportRow & { issue_url: string | null }>(`SELECT ${REPORT_COLS}, issue_url FROM bug_reports WHERE id = ?`, [id]))!;
    const files = await all<FileRow & { github_url: string | null; on_disk: number }>(
      "SELECT report_id, n, type, bytes, github_url, on_disk FROM bug_report_files WHERE received = bytes AND report_id = ? ORDER BY n", [id]);
    const attachments: { filename: string; content: Buffer }[] = [];
    let total = 0;
    for (const f of files) {
      // A retry after filing: the local copy is gone and GitHub has it (linked in the email instead).
      if (!Number(f.on_disk)) continue;
      if (total + Number(f.bytes) > EMAIL_ATTACH_BYTES) continue;
      const content = await readFile(filePath(id, Number(f.n), f.type as AttachmentType)).catch(() => null);
      if (!content) continue;
      total += content.length;
      attachments.push({ filename: `bug-${id}-${Number(f.n) + 1}.${EXTENSION[f.type as AttachmentType]}`, content });
    }
    const { subject, text: body, html } = bugEmail(r, files.map((f) => ({ ...f, github_url: Number(f.on_disk) ? null : f.github_url })), attachments.length);
    await sendEmail(to, subject, body, html, { ...(r.email ? { replyTo: r.email } : {}), attachments });
    await run("UPDATE bug_reports SET emailed = 1 WHERE id = ?", [id]);
  } catch (e) {
    await run("UPDATE bug_reports SET emailed = 0 WHERE id = ? AND emailed = 2", [id]).catch(() => {});
    console.warn(`[bug-reports] report #${id} stored but not emailed (will retry): ${reason(e)}`);
  }
}

// --- Filing on GitHub -----------------------------------------------------------------------------

export const BUG_ISSUE_LABELS = ["bug", "user-reported"];
/** How the attachments reach GitHub, for the audit log. */
export const UPLOAD_ROUTE = "uploads.github.com/user-attachments/assets (the gh --attach request)";
/** What the owner console says when there's no token to file with. */
export const NO_TOKEN = "GitHub filing isn't set up (no GITHUB_REPORT_TOKEN).";
/** What the owner console says about a report sent before the dialog said it would be public: never filed. */
export const PRIVATE_REPORT = "Private: sent before reports were filed on GitHub, so it's never filed.";
/** A claim this old belongs to a filer that died part-way (or whose reply was lost): another may take over. */
const FILE_CLAIM_STALE_MS = 10 * 60_000;
/** After a rate limit: no filing until GitHub allows it again. */
let githubPausedUntil = 0;
/** Tests: forget a rate-limit pause. */
export const resetBugFilingPause = () => { githubPausedUntil = 0; };

interface FilingRow extends ReportRow { issue_number: number | null; file_marker: string; file_attempts: number; file_error: string | null }
interface FilingFile extends FileRow { github_url: string | null; upload_error: string | null; on_disk: number }

/** The issue's title: "[user] " + the first line of the message, or the category when that line says nothing. */
export function bugIssueTitle(message: string, category: string): string {
  const first = message.split("\n", 1)[0].replace(/\s+/g, " ").trim();
  const usable = first.split(REDACTED).join("").replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
  if (!usable) return `[user] Bug report: ${categoryLabel(category)}`;
  return `[user] ${first.length > 110 ? `${first.slice(0, 109)}…` : first}`;
}

/** The name an attachment goes to GitHub under: never the sender's own file name. */
const assetName = (id: number, f: Pick<FileRow, "n" | "type">) => `bug-${id}-${Number(f.n) + 1}.${EXTENSION[f.type as AttachmentType] ?? "bin"}`;

/**
 * The issue body. The message (and the details) sit inside code fences, so nothing in them renders as a link or
 * @mentions anyone. Attachments: an image inline, a video as a bare URL on its own line (GitHub's player), and one
 * that didn't upload named as failed. `marker`: the report's id on GitHub, found again if a reply is lost.
 */
export function bugIssueBody(r: Pick<ReportRow, "id" | "category" | "message" | "email" | "page" | "release" | "viewport" | "device" | "theme" | "files_expected">,
  files: Pick<FilingFile, "n" | "type" | "bytes" | "github_url">[], marker: string): string {
  const field = (v: string) => sanitizeText(v, BUG_LIMITS.context) || "unknown";
  const details = [
    `Page:     ${r.page ? sanitizeRoute(r.page) : "unknown"}`,
    `Release:  ${field(r.release)}`,
    `Screen:   ${field(r.viewport)}`,
    `Device:   ${field(r.device)}`,
    `Theme:    ${field(r.theme)}`,
  ].join("\n");
  const shown = files.map((f) => {
    const name = assetName(r.id, f);
    if (!f.github_url) return `- ${name} (${isVideoType(f.type) ? "video" : "screenshot"}, ${formatBytes(Number(f.bytes))}) failed to upload to GitHub; it's kept with the report.`;
    return isVideoType(f.type) ? f.github_url : `![${name}](${f.github_url})`;
  });
  const missing = Number(r.files_expected) - files.length;
  if (missing > 0) shown.push(`- ${missing} attachment${missing === 1 ? " was" : "s were"} never uploaded from the browser.`);
  return [
    "### What happened",
    fenced(r.message),
    "",
    `**Category:** ${categoryLabel(r.category)}`,
    "",
    "### Context",
    fenced(details),
    ...(r.email ? ["", `**Email:** \`${r.email.replace(/`/g, "")}\``] : []),
    ...(shown.length ? ["", "### Attachments", "", shown.join("\n\n")] : []),
    "",
    `Report ID: \`${marker}\``,
    "",
    "Filed from the in-app Report a bug button.",
  ].join("\n");
}

const why = (e: unknown) => e instanceof GithubError ? e.message : (e as Error)?.name === "TimeoutError" ? "GitHub didn't answer in time" : "couldn't reach GitHub";

/** An issue already filed for this report (any state), found by its id in the body. */
async function findFiled(token: string, marker: string): Promise<number | null> {
  const q = encodeURIComponent(`"${marker}" repo:${GITHUB_REPO} is:issue in:body`);
  const found = await gh<{ items?: { number: number; body?: string | null }[] }>(token, "GET", `/search/issues?q=${q}&per_page=5`);
  return (found.items ?? []).find((i) => (i.body ?? "").includes(marker))?.number ?? null;
}

/** Records a failure for the owner console, and in the audit log when the reason changed. */
async function noteFailure(id: number, was: string | null, reason: string, attempt: number) {
  await run("UPDATE bug_reports SET file_error = ? WHERE id = ? AND issue_number IS NULL", [reason, id]);
  if (reason === was) return;
  console.warn(`[bug-reports] report #${id} stored, not filed on GitHub yet (will retry): ${reason}`);
  await recordAudit("system", "bugReport.fileFailed", { id, reason, attempt }).catch(() => {});
}

export type BugFilingOutcome = "no-token" | "paused" | "missing" | "private" | "claimed-elsewhere" | "filed" | "adopted" | "failed";

/**
 * Files one finished report as a GitHub issue, if this server wins the claim on it: uploads its attachments, opens the
 * issue with them embedded, then deletes each local copy whose GitHub URL opens. Never throws: a failure is recorded
 * on the report (and in the audit log) and the sweep tries again.
 */
export async function fileBugReport(id: number, now = new Date()): Promise<BugFilingOutcome> {
  const token = env.githubReportToken;
  if (!token) {
    await run("UPDATE bug_reports SET file_error = ? WHERE id = ? AND issue_number IS NULL AND to_github = 1", [NO_TOKEN, id]).catch(() => {});
    return "no-token";
  }
  if (Date.now() < githubPausedUntil) return "paused";
  const at = now.toISOString();
  let claimed: FilingRow | undefined;
  try {
    claimed = await get<FilingRow>(
      `UPDATE bug_reports SET filing_at = ?, file_attempts = file_attempts + 1, file_marker = COALESCE(file_marker, ?)
       WHERE id = ? AND issue_number IS NULL AND to_github = 1 AND (filing_at IS NULL OR filing_at < ?)
       RETURNING ${REPORT_COLS}, issue_number, file_marker, file_attempts, file_error`,
      [at, randomBytes(12).toString("hex"), id, new Date(now.getTime() - FILE_CLAIM_STALE_MS).toISOString()]);
  } catch { return "failed"; }
  if (!claimed) {
    const r = await get<{ to_github: number }>("SELECT to_github FROM bug_reports WHERE id = ?", [id]).catch(() => undefined);
    return !r ? "missing" : Number(r.to_github) === 0 ? "private" : "claimed-elsewhere";
  }
  const row = claimed;
  const attempt = Number(row.file_attempts);
  const release = () => run("UPDATE bug_reports SET filing_at = NULL WHERE id = ? AND filing_at = ?", [id, at]).catch(() => {});
  // Set once GitHub has made the issue: from then on a failure must not free the claim (a retry before GitHub's
  // search has the issue would file a second one); the claim goes stale and the next try adopts it.
  let created = false;
  const pause = (e: unknown) => { if (e instanceof GithubError && e.retryAt) githubPausedUntil = Math.max(githubPausedUntil, e.retryAt); };
  try {
    // An earlier try may have opened the issue without hearing back: adopt it rather than file a second one.
    const earlier = attempt > 1 ? await findFiled(token, row.file_marker) : null;
    let number = earlier;
    let labelsMissing: string[] = [];
    const failed: number[] = [];
    if (number == null) {
      const files = await all<FilingFile>(`SELECT report_id, n, type, bytes, github_url, upload_error, on_disk FROM bug_report_files
        WHERE received = bytes AND report_id = ? ORDER BY n`, [id]);
      // Uploads first: the issue is opened with the URLs that worked, and names the rest as failed.
      for (const f of files) {
        if (f.github_url) continue;
        try {
          const bytes = Number(f.on_disk) ? await readFile(filePath(id, Number(f.n), f.type as AttachmentType)) : null;
          if (!bytes) throw new Error("the local copy is missing");
          f.github_url = await uploadAsset(token, assetName(id, f), f.type, bytes);
          await run("UPDATE bug_report_files SET github_url = ?, upload_error = NULL WHERE report_id = ? AND n = ?", [f.github_url, id, Number(f.n)]);
        } catch (e) {
          pause(e);
          failed.push(Number(f.n) + 1);
          const reason = e instanceof GithubError || (e as Error)?.name === "TimeoutError" ? why(e) : (e as Error)?.message ?? "upload failed";
          await run("UPDATE bug_report_files SET upload_error = ? WHERE report_id = ? AND n = ?", [reason, id, Number(f.n)]);
        }
      }
      let issue: { number: number; labels?: { name?: string }[] };
      try {
        issue = await gh<{ number: number; labels?: { name?: string }[] }>(token, "POST", "/issues", {
          title: bugIssueTitle(row.message, row.category), body: bugIssueBody(row, files, row.file_marker), labels: BUG_ISSUE_LABELS,
        });
      } catch (e) {
        pause(e);
        // Refused outright: nothing was created, free the claim. No answer: keep the claim until it goes stale, by
        // when GitHub's search has the issue if it was made, and the next try adopts it.
        if (refused(e)) await release();
        await noteFailure(id, row.file_error, refused(e) ? `GitHub refused the issue: ${why(e)}` : `${why(e)}; will check before trying again`, attempt);
        return "failed";
      }
      created = true;
      number = Number(issue.number);
      const got = new Set((issue.labels ?? []).map((l) => l.name));
      labelsMissing = BUG_ISSUE_LABELS.filter((l) => !got.has(l));
    }
    const url = `https://github.com/${GITHUB_REPO}/issues/${number}`;
    await run(`UPDATE bug_reports SET issue_number = ?, issue_url = ?, filed_at = ?, filing_at = NULL, file_error = NULL, labels_missing = ?
      WHERE id = ?`, [number, url, at, labelsMissing.length ? labelsMissing.join(",") : null, id]);
    await recordAudit("system", "bugReport.filed", {
      id, issue: number, route: UPLOAD_ROUTE, ...(earlier ? { adopted: true } : {}),
      ...(failed.length ? { uploadFailed: failed } : {}), ...(labelsMissing.length ? { labelsMissing } : {}),
    }).catch(() => {});
    if (labelsMissing.length) console.warn(`[bug-reports] report #${id} filed as #${number} without label(s) ${labelsMissing.join(", ")} (create them on GitHub)`);
    await clearUploaded(id);
    if (await keptCopies(id)) clearSoon(id);
    return earlier ? "adopted" : "filed";
  } catch (e) {
    // The search or our own database. Before the issue exists: free the claim, try again later. After: keep it.
    pause(e);
    if (!created) await release();
    await noteFailure(id, row.file_error, created ? "Filed, but couldn't record the issue here; will find it again" : why(e), attempt).catch(() => {});
    return "failed";
  }
}

/**
 * Deletes the local copy of each attachment of a filed report whose GitHub URL opens (an attachment's URL opens only
 * once an issue uses it). One that doesn't open yet keeps its copy; the sweep checks again. Never while the owner
 * email is being sent (its claim is fresh): that send reads the copies. The check and the mark are one statement, so
 * an email claimed after it sees the copy gone and links GitHub instead.
 */
export async function clearUploaded(id: number, now = Date.now()): Promise<number> {
  const files = await all<FilingFile>(`SELECT f.report_id, f.n, f.type, f.bytes, f.github_url, f.upload_error, f.on_disk FROM bug_report_files f
    JOIN bug_reports r ON r.id = f.report_id WHERE f.report_id = ? AND r.issue_number IS NOT NULL AND f.github_url IS NOT NULL AND f.on_disk = 1`, [id]);
  let cleared = 0;
  for (const f of files) {
    if (!(await assetOpens(f.github_url!).catch(() => false))) continue;
    const marked = await get<{ n: number }>(
      `UPDATE bug_report_files SET on_disk = 0 WHERE report_id = ? AND n = ? AND on_disk = 1
         AND NOT EXISTS (SELECT 1 FROM bug_reports WHERE id = ? AND emailed = 2 AND email_claimed_at > ?) RETURNING n`,
      [id, Number(f.n), id, new Date(now - STALE_CLAIM_MS).toISOString()]);
    if (!marked) continue;
    await rm(filePath(id, Number(f.n), f.type as AttachmentType), { force: true });
    cleared++;
  }
  return cleared;
}

/** Right after an issue is made, GitHub can take a few seconds to open its attachments to everyone: check again
 *  after these waits rather than leave it to the sweep, which every restart (deploys can come every few minutes) puts
 *  off by another 10 minutes. */
export const clearRetries = { ms: [15_000, 60_000, 180_000] as number[] };
/** How many of a report's uploaded attachments still have a local copy. */
const keptCopies = async (id: number) => Number((await get<{ n: number }>(
  "SELECT COUNT(*) AS n FROM bug_report_files WHERE report_id = ? AND github_url IS NOT NULL AND on_disk = 1", [id]).catch(() => undefined))?.n ?? 0);
/** The last re-check started (tests wait on it). */
export let clearing: Promise<void> = Promise.resolve();
function clearSoon(id: number) {
  clearing = (async () => {
    for (const ms of clearRetries.ms) {
      await new Promise<void>((done) => { setTimeout(done, ms).unref?.(); });
      await clearUploaded(id).catch(() => 0);
      if (!(await keptCopies(id))) return;
    }
  })();
}

/** The last filing started (tests wait on it). */
export let filing: Promise<BugFilingOutcome> = Promise.resolve("missing");

/** What the dialog may show: a real issue, or that it isn't one yet. */
export async function bugFiling(id: number): Promise<BugFiling> {
  const r = await get<{ issue_number: number | null; issue_url: string | null; file_attempts: number; file_error: string | null }>(
    "SELECT issue_number, issue_url, file_attempts, file_error FROM bug_reports WHERE id = ?", [id]);
  if (r?.issue_number != null && r.issue_url) return { state: "filed", number: Number(r.issue_number), url: r.issue_url };
  return r && Number(r.file_attempts) > 0 && r.file_error ? { state: "failed" } : { state: "pending" };
}

/** At most this many open reports are asked about per check (one GitHub request per 50). */
const ISSUE_CHECK_MAX = 200;
/** The owner console's lists ask GitHub themselves at most this often (the 10-minute sweep asks too). */
export const ISSUE_SYNC_MS = 60_000;
/** How long a list waits for that check before answering with what it has (the check carries on). */
const LIST_SYNC_WAIT_MS = 3_000;
let lastIssueSync = 0;
let issueSync: Promise<unknown> | null = null;
/** Tests: forget when GitHub was last asked. */
export const resetIssueSync = () => { lastIssueSync = 0; issueSync = null; };

/**
 * Open reports follow their GitHub issue (issueStates: one GraphQL request per 50, the reports asked about longest ago
 * first). A closed issue closes the report here (status done) and records how ("completed" or "not_planned", when, and
 * the closing PR or commit). A report the owner reopened here closes again only for an issue closed after that. An
 * issue GitHub no longer finds is left as it is. Returns how many reports it closed. No token: nothing.
 */
export async function syncBugIssues(now = Date.now()): Promise<number> {
  const token = env.githubReportToken;
  if (!token || now < githubPausedUntil) return 0;
  const rows = await all<{ id: number; issue_number: number; reopened_at: string | null }>(
    `SELECT id, issue_number, reopened_at FROM bug_reports WHERE status = 'open' AND issue_number IS NOT NULL
       ORDER BY issue_checked_at IS NOT NULL, issue_checked_at, id DESC LIMIT ?`, [ISSUE_CHECK_MAX]);
  if (!rows.length) return 0;
  let states: Map<number, IssueState>;
  try {
    states = await issueStates(token, rows.map((r) => Number(r.issue_number)));
  } catch (e) {
    if (e instanceof GithubError && e.retryAt) githubPausedUntil = Math.max(githubPausedUntil, e.retryAt);
    throw e;
  }
  const checked = new Date(now).toISOString();
  let closed = 0;
  for (const r of rows) {
    const s = states.get(Number(r.issue_number));
    if (!s || s.state === "open") {
      await run("UPDATE bug_reports SET issue_checked_at = ?, issue_state = COALESCE(?, issue_state) WHERE id = ?", [checked, s ? "open" : null, r.id]);
      continue;
    }
    const closedAt = s.closedAt ?? checked;
    // Reopened here after GitHub closed it: the owner's call stands until the issue is closed again.
    if (r.reopened_at && closedAt <= r.reopened_at) {
      await run("UPDATE bug_reports SET issue_checked_at = ? WHERE id = ?", [checked, r.id]);
      continue;
    }
    const done = await get<{ id: number }>(
      `UPDATE bug_reports SET status = 'done', issue_state = ?, issue_closed_at = ?, closed_by_url = ?, closed_by_label = ?, issue_checked_at = ?
         WHERE id = ? AND status = 'open' AND reopened_at IS ? RETURNING id`,
      [s.state, closedAt, s.by?.url ?? null, s.by?.label ?? null, checked, r.id, r.reopened_at]);
    if (!done) continue;
    closed++;
    await recordAudit("system", "bugReport.issueClosed", { id: Number(r.id), issue: Number(r.issue_number), reason: s.state, by: s.by?.label ?? null }).catch(() => {});
  }
  return closed;
}

let lastSyncWarning = 0;
/** A failed check is logged (the reason only), at most once per 10 minutes. */
const warnSync = (what: string) => (e: unknown) => {
  if (Date.now() - lastSyncWarning >= 10 * 60_000) {
    lastSyncWarning = Date.now();
    console.warn(`[reports] couldn't check ${what} issues on GitHub: ${e instanceof GithubError ? e.message : (e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message ?? "error"}`);
  }
  return 0;
};

/** Bug reports and error reports both (the Bugs and Feedback & errors panels' lists, and the sweep). Never throws. */
export async function syncIssueStates(now = Date.now()): Promise<void> {
  lastIssueSync = now;
  await Promise.all([syncBugIssues(now).catch(warnSync("bug report")), syncErrorIssues(now).catch(warnSync("error report"))]);
}

/** For the owner console's lists: checks GitHub when it wasn't asked in the last minute, waiting up to 3 seconds. */
export async function freshIssueStates(now = Date.now()): Promise<void> {
  if (!env.githubReportToken) return;
  if (!issueSync && now - lastIssueSync >= ISSUE_SYNC_MS) {
    issueSync = syncIssueStates(now).finally(() => { issueSync = null; });
  }
  if (issueSync) await Promise.race([issueSync, new Promise((r) => setTimeout(r, LIST_SYNC_WAIT_MS).unref())]);
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
  // Not filed yet (no token then, GitHub down, a refusal, a lost reply whose claim has gone stale): try again.
  if (env.githubReportToken) {
    const unfiled = await all<{ id: number }>(
      `SELECT id FROM bug_reports WHERE issue_number IS NULL AND to_github = 1 AND (done_at IS NOT NULL OR created_at < ?)
         AND (filing_at IS NULL OR filing_at < ?) ORDER BY id LIMIT 20`,
      [closed, new Date(now - FILE_CLAIM_STALE_MS).toISOString()]);
    for (const { id } of unfiled) await fileBugReport(Number(id), new Date(now));
    // Filed, with a local copy whose GitHub URL didn't open yet: check again.
    const kept = await all<{ report_id: number }>(
      `SELECT DISTINCT f.report_id FROM bug_report_files f JOIN bug_reports r ON r.id = f.report_id
       WHERE r.issue_number IS NOT NULL AND f.github_url IS NOT NULL AND f.on_disk = 1 LIMIT 20`);
    for (const { report_id } of kept) await clearUploaded(Number(report_id), now).catch(() => 0);
    // Filed and still open here (bug reports and error reports): close the ones whose issue is now closed on GitHub.
    await syncIssueStates(now);
  }
  // Uploads stop at the window's end; clearing waits a second window, skips a file still being written, and removes
  // files only for a row it actually deleted (a piece finishing meanwhile keeps its row, so its file stays).
  const stale = await all<FileRow>("SELECT report_id, n, type, bytes FROM bug_report_files WHERE received < bytes AND created_at < ?",
    [new Date(now - 2 * UPLOAD_WINDOW_MS).toISOString()]);
  let cleared = 0;
  for (const f of stale) {
    const id = Number(f.report_id), n = Number(f.n);
    if (busy.has(`${id}-${n}`)) continue;
    const gone = await get("DELETE FROM bug_report_files WHERE report_id = ? AND n = ? AND received < bytes RETURNING n", [id, n]);
    if (!gone) continue;
    cleared++;
    await rm(partPath(id, n), { force: true });
    await rm(filePath(id, n, f.type as AttachmentType), { force: true });
  }
  return { emailed: due.length, cleared };
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
       SELECT ?, ?, ?, ?, 0, ? WHERE (SELECT COALESCE(SUM(bytes), 0) FROM bug_report_files WHERE on_disk = 1) + ? <= ?
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
    // Answered at once: the email (with attachments) and the GitHub issue happen after; the sweep retries a failure.
    // The email goes first: it reads the local copies, which filing deletes once they're on GitHub.
    emailing = emailReport(open.row.id);
    filing = emailing.catch(() => {}).then(() => fileBugReport(Number(open.row.id)));
    return { ok: true };
  }));

  // The dialog asks a few times after sending: the issue's real number and address once it exists, nothing made up.
  r.get("/:id/status", h(async (req, res) => {
    const open = await openForUpload(req);
    if (!open.ok) { res.status(open.status).json({ error: open.error }); return; }
    res.setHeader("Cache-Control", "no-store");
    return bugFiling(Number(open.row.id));
  }));
  return r;
}

// --- Owner console --------------------------------------------------------------------------------

type Handler = (req: Request, res: Response) => Promise<unknown>;
type Wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => void;

/** One page of reports, newest first: open ones or closed ones, older than report `before` when given. */
export async function listBugReports(status: "open" | "done" = "open", before: number | null = null, limit = OWNER_PAGE): Promise<BugReportList> {
  type ListRow = ReportRow & {
    issue_number: number | null; issue_url: string | null; file_error: string | null; to_github: number;
    issue_state: string | null; issue_closed_at: string | null; closed_by_url: string | null; closed_by_label: string | null;
  };
  const rows = await all<ListRow>(
    `SELECT ${REPORT_COLS}, issue_number, issue_url, file_error, to_github, issue_state, issue_closed_at, closed_by_url, closed_by_label FROM bug_reports
     WHERE status = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    [status, ...(before ? [before] : []), limit + 1]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const files = page.length
    ? await all<FilingFile>(`SELECT report_id, n, type, bytes, github_url, upload_error, on_disk FROM bug_report_files WHERE received = bytes
        AND report_id IN (${page.map(() => "?").join(", ")}) ORDER BY report_id, n`, page.map((r) => r.id))
    : [];
  const counts = await get<{ open: number | null; closed: number | null }>(
    "SELECT SUM(status = 'open') AS open, SUM(status = 'done') AS closed FROM bug_reports");
  const stored = Number((await get<{ s: number | null }>("SELECT SUM(bytes) AS s FROM bug_report_files WHERE on_disk = 1"))?.s ?? 0);
  const reportsOut: BugReportItem[] = page.map((r) => {
    const own = files.filter((f) => Number(f.report_id) === Number(r.id));
    const issue = r.issue_number != null && r.issue_url ? { number: Number(r.issue_number), url: r.issue_url } : null;
    const notFiled = issue ? null
      : Number(r.to_github) === 0 ? PRIVATE_REPORT
      : r.file_error ?? (env.githubReportToken ? "Being filed." : NO_TOKEN);
    return {
      id: Number(r.id), createdAt: r.created_at, category: r.category as BugCategory, message: r.message, email: r.email,
      context: { page: r.page, release: r.release, viewport: r.viewport, device: r.device, theme: r.theme },
      status: r.status === "done" ? "done" : "open", emailed: Number(r.emailed) === 1,
      missing: Math.max(0, Number(r.files_expected) - own.length),
      files: own.map((f) => ({
        n: Number(f.n), type: f.type, bytes: Number(f.bytes),
        url: Number(f.on_disk) ? `/api/owner/bug-reports/${r.id}/files/${f.n}` : null,
        githubUrl: f.github_url, uploadError: f.upload_error,
      })),
      issue, notFiled,
      issueClosed: issue && (r.issue_state === "completed" || r.issue_state === "not_planned")
        ? {
          reason: r.issue_state, at: r.issue_closed_at,
          by: r.closed_by_url && r.closed_by_label ? { label: r.closed_by_label, url: r.closed_by_url } : null,
        }
        : null,
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
    // The first page follows GitHub: an issue closed since the last check leaves the open list now, not at the next sweep.
    if (!(Number.isInteger(before) && before > 0)) await freshIssueStates();
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
    // Reopening: the issue's current state no longer closes it; only a later close on GitHub does.
    const row = await get<{ id: number }>(
      `UPDATE bug_reports SET status = ?, reopened_at = CASE WHEN ? = 'open' THEN ? ELSE reopened_at END WHERE id = ? RETURNING id`,
      [status, status, new Date().toISOString(), id]);
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
