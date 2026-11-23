// In-app error reports → GitHub issues (docs/error-reporting.md).
//
// POST /api/reports/error takes one sanitized crash report from the web app,
// re-validates and re-sanitizes it, groups it by fingerprint (normalized
// message + first 3 stack frames) in error_reports, and answers at once. Filing
// on GitHub happens afterwards, in the background, and only when
// GITHUB_REPORT_TOKEN is set:
//   - a new fingerprint opens an issue "[auto] <message>" (labels bug, auto-reported);
//   - more reports of it add a "seen N more times" comment, at most once a day;
//   - an issue closed as completed that comes back gets a new issue linking the old one;
//     one closed as not planned stays closed (reports are still counted here).
// Two servers (or two requests) never open two issues for one fingerprint: the
// filer first claims the row with a conditional UPDATE, and only the winner files.
// When a write's outcome is unknown (no answer, a timeout, a 5xx), the claim is
// kept until it goes stale, and the next attempt first searches GitHub for an
// open issue carrying the fingerprint and adopts it instead of opening another.
//
// Nothing here may ever fail loudly: a broken report path is logged (the reason
// only, never the report or the token) and the app carries on.
//
// GET /api/reports/errors lists the stored reports for the owner portal (OWNER_EMAILS); 404 for anyone else.
//
// The GitHub client below (gh, GITHUB_REPO, GITHUB_REPORT_TOKEN) is the one GitHub reporting path: failed searches
// (server/searchFailures.ts, docs/failed-search-reporting.md) file through it too.
import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { all, db, get, run } from "./db.js";
import { env } from "./env.js";
import { RELEASE } from "./release.js";
import { currentUser } from "./auth/session.js";
import { ownerOf } from "./owner.js";
import { isEnabled } from "./flags.js";
import { fingerprintSource, reportShapeError, sanitizeReport, type ErrorReport } from "../src/shared/errorReport.js";

/** The repository this codebase lives in (git remote origin). It moved from Control-Point-FTC: GitHub forwards the
 *  old name's REST calls, but its issue search refuses the old name (422), so it's the new one here. */
export const GITHUB_REPO = "ZOGWORK/control-scout";
export const ISSUE_LABELS = ["bug", "auto-reported"];

// --- Rate limit -----------------------------------------------------------------------------------

/** Accepted reports per hour: per signed-in account, or per IP address when signed out. */
export const REPORT_RATE = { account: 5, ip: 20, windowMs: 60 * 60_000 };
/** Above this many tracked keys, keys whose reports have all expired are dropped; far above it, everything is. */
const SWEEP_AT = 10_000;
const HARD_CAP = 50_000;

const hits = new Map<string, number[]>();
/** Tests: forget every key's recent reports. */
export const resetReportLimits = () => hits.clear();
/** Tests: how many accounts/IPs the limiter is tracking. */
export const trackedReportKeys = () => hits.size;

/**
 * Takes one slot for `key` if it has fewer than `max` reports in the window. Check and record
 * happen together (synchronously), so parallel requests can't all slip under the limit.
 * Memory is bounded like the contact form's limiter: expired keys are swept once the map is large.
 */
export function takeReportSlot(key: string, max: number, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const w = REPORT_RATE.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < w);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w - (now - recent[0])) / 1000)) };
  }
  if (hits.size > SWEEP_AT) for (const [k, ts] of hits) if (!ts.some((t) => now - t < w)) hits.delete(k);
  if (hits.size > HARD_CAP) hits.clear();
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

/** How many more reports `key` may take in the window, without taking one: a caller that must check two keys before
 *  spending either (the Discord bot checks a person and a server) can ask first. */
export function reportSlotsLeft(key: string, max: number, now = Date.now()): number {
  const w = REPORT_RATE.windowMs;
  return Math.max(0, max - (hits.get(key) ?? []).filter((t) => now - t < w).length);
}

/** Give one report slot back: a filing that ended without an issue shouldn't count against the asker. */
export function returnReportSlot(key: string): void {
  const recent = hits.get(key)?.slice();
  if (!recent?.length) return;
  recent.pop();
  if (recent.length) hits.set(key, recent); else hits.delete(key);
}

// --- Storage --------------------------------------------------------------------------------------

/** A stable id for "the same bug": a hash of the normalized message and first 3 stack frames. */
export const fingerprintOf = (r: Pick<ErrorReport, "message" | "stack">) => createHash("sha256").update(fingerprintSource(r)).digest("hex").slice(0, 32);

interface Row {
  fingerprint: string; message: string; count: number; first_seen: string; last_seen: string; sample: string;
  issue_number: number | null; issue_state: string | null; reported_count: number; last_comment_at: string | null; filing_at: string | null;
  owner_note?: string | null; owner_note_at?: string | null; resolved_at?: string | null;
}

/** Every error_reports column (a Row). */
const ROW_COLUMNS = "fingerprint, message, count, first_seen, last_seen, sample, issue_number, issue_state, reported_count, last_comment_at, filing_at, owner_note, owner_note_at, resolved_at";

/** Adds one occurrence (a new row for a new fingerprint). The sample is always the latest report. */
export async function storeReport(r: ErrorReport, now = new Date()): Promise<{ fingerprint: string; count: number }> {
  const fingerprint = fingerprintOf(r);
  const at = now.toISOString();
  const row = await get<{ count: number }>(
    `INSERT INTO error_reports (fingerprint, message, count, first_seen, last_seen, sample) VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT (fingerprint) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen, sample = excluded.sample, resolved_at = NULL,
       reopened_at = CASE WHEN error_reports.resolved_at IS NOT NULL THEN excluded.last_seen ELSE error_reports.reopened_at END
     RETURNING count`,
    [fingerprint, r.message, at, at, JSON.stringify(r)],
  );
  return { fingerprint, count: Number(row?.count ?? 1) };
}

// --- GitHub ---------------------------------------------------------------------------------------

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests: replace the HTTP client used for GitHub (null = the real fetch). */
export function setGithubFetch(f: Fetch | null) { fetchImpl = f; }

export class GithubError extends Error {
  /** Rate-limited (403/429 with Retry-After, or no requests left): when GitHub allows the next one (epoch ms). */
  readonly retryAt: number | null;
  constructor(readonly status: number, headers?: Headers) {
    super(`GitHub answered ${status}`);
    const after = Number(headers?.get("retry-after"));
    const reset = Number(headers?.get("x-ratelimit-reset"));
    this.retryAt = (status === 403 || status === 429) && (after > 0 || (headers?.get("x-ratelimit-remaining") === "0" && reset > 0))
      ? (after > 0 ? Date.now() + after * 1000 : reset * 1000)
      : status === 429 ? Date.now() + 60_000 : null;
  }
}

/** GitHub definitely refused (a 4xx answer): nothing was created, so it's safe to try again later. Anything
 *  else after a write was sent (no answer, a timeout, a 5xx, or our own failure to save the result) is
 *  uncertain: the write may have gone through. */
export const refused = (e: unknown) => e instanceof GithubError && e.status >= 400 && e.status < 500;

/** `path` is under the repository ("/issues"), or absolute from the API root when it starts with "/search/" or is
 *  "/graphql". */
export async function gh<T>(token: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("/search/") || path === "/graphql" ? `https://api.github.com${path}` : `https://api.github.com/repos/${GITHUB_REPO}${path}`;
  const res = await (fetchImpl ?? fetch)(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "control-scout-error-reports",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GithubError(res.status, res.headers);
  return (await res.json()) as T;
}

let repoId: number | null = null;
/** Tests: forget the cached repository id. */
export const resetRepositoryId = () => { repoId = null; };
/** The repository's numeric id (the upload endpoint asks for it), read once. */
export async function repositoryId(token: string): Promise<number> {
  repoId ??= (await gh<{ id: number }>(token, "GET", "")).id;
  return repoId;
}

/** What an uploaded attachment's address must look like before it goes into an issue: GitHub's own asset URL. */
export const ASSET_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Uploads one image or video as an issue attachment and returns its GitHub URL. The same request GitHub CLI's
 * supported `gh issue create --attach` makes (cli/cli internal/attachments/client.go, gh 2.104.0): POST the bytes to
 * uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=…. Tested live with
 * GITHUB_REPORT_TOKEN on 2026-11-14 (201). GitHub answers 404 when the token can't write to the repository.
 */
export async function uploadAsset(token: string, name: string, contentType: string, bytes: Uint8Array): Promise<string> {
  const q = new URLSearchParams({ name, content_type: contentType, repository_id: String(await repositoryId(token)) });
  const res = await (fetchImpl ?? fetch)(`https://uploads.github.com/user-attachments/assets?${q}`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "User-Agent": "control-scout-bug-reports",
    },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new GithubError(res.status, res.headers);
  const url = String(((await res.json().catch(() => ({}))) as { url?: unknown }).url ?? "");
  if (!ASSET_URL.test(url)) throw new Error("GitHub returned no attachment URL");
  return url;
}

/** Whether an attachment URL opens for anyone (signed out): GitHub redirects it to the file. */
export async function assetOpens(url: string): Promise<boolean> {
  const res = await (fetchImpl ?? fetch)(url, { method: "HEAD", redirect: "manual", headers: { "User-Agent": "control-scout-bug-reports" }, signal: AbortSignal.timeout(10_000) });
  return res.status === 302 || res.status === 200;
}

/** A code fence longer than any run of backticks in the text, so report text can never break out of it. */
export function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

const day = (iso: string) => iso.slice(0, 10);

export function issueTitle(message: string): string {
  const first = message.split("\n", 1)[0].trim();
  return `[auto] ${first.length > 110 ? `${first.slice(0, 109)}…` : first}`;
}

/** The issue body. Everything from the report sits inside code fences (no markdown, links or @mentions run). */
export function issueBody(row: Pick<Row, "fingerprint" | "count" | "first_seen" | "last_seen">, r: ErrorReport, previous?: number | null): string {
  const env = [
    `Route:        ${r.route}`,
    `App version:  ${r.appVersion}`,
    `Server:       ${RELEASE ?? "development"}`,
    `Browser:      ${r.userAgent || "unknown"}`,
    `Happened at:  ${r.timestamp}`,
  ].join("\n");
  return [
    "Filed automatically by Control Scout's in-app error reporting (see `docs/error-reporting.md`). The report is sanitized: no personal data, notes or scout entries.",
    "",
    `**Occurrences:** ${row.count} (first seen ${row.first_seen}, last seen ${row.last_seen})`,
    `**Fingerprint:** \`${row.fingerprint}\``,
    ...(previous ? [`**Came back:** #${previous} was closed as completed; this is the same error again.`] : []),
    "",
    "### Error",
    fenced(r.message),
    "",
    "### Stack",
    fenced(r.stack.split("\n").slice(0, 40).join("\n") || "(no stack)"),
    "",
    "### Environment",
    fenced(env),
  ].join("\n");
}

export function commentBody(more: number, total: number, since: string | null, r: ErrorReport): string {
  return [
    `Seen ${more} more time${more === 1 ? "" : "s"}${since ? ` since ${day(since)}` : ""} (${total} in total).`,
    "",
    "Latest occurrence:",
    fenced([`Route:        ${r.route}`, `App version:  ${r.appVersion}`, `Server:       ${RELEASE ?? "development"}`, `Browser:      ${r.userAgent || "unknown"}`, `Happened at:  ${r.timestamp}`].join("\n")),
  ].join("\n");
}

/** Claims older than this are from a filer that died part-way: another may take over. */
const CLAIM_STALE_MS = 10 * 60_000;
const COMMENT_EVERY_MS = 24 * 60 * 60_000;

export type FilingOutcome = "no-token" | "missing" | "opened" | "adopted" | "claimed-elsewhere" | "commented" | "throttled" | "up-to-date" | "not-planned";

/** Opens an issue for the row, if this server wins the claim on it. `previous`: the closed issue this one replaces. */
async function openIssue(fp: string, token: string, now: Date, previous: number | null): Promise<FilingOutcome> {
  const at = now.toISOString();
  const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  // The claim: exactly one caller can move filing_at from empty (or stale) to now while the issue is still the same.
  const claimed = await run(
    "UPDATE error_reports SET filing_at = ? WHERE fingerprint = ? AND issue_number IS ? AND (filing_at IS NULL OR filing_at < ?)",
    [at, fp, previous, stale],
  );
  if (!claimed) return "claimed-elsewhere";
  const release = () => run("UPDATE error_reports SET filing_at = NULL WHERE fingerprint = ? AND filing_at = ?", [fp, at]);
  let row: Row | undefined;
  let existing: { number: number; reported: number } | null;
  try {
    row = await get<Row>(`SELECT ${ROW_COLUMNS} FROM error_reports WHERE fingerprint = ?`, [fp]);
    if (!row) { await release(); return "missing"; }
    // An earlier attempt may have opened the issue without hearing back: adopt it instead of opening another.
    existing = await findOpenIssue(token, fp, previous);
  } catch (e) {
    await release(); // nothing was written to GitHub yet
    throw e;
  }
  const report = JSON.parse(row.sample) as ErrorReport;
  const count = Number(row.count);
  try {
    // reported_count is always what GitHub was actually told: the count in the body we sent (or find).
    const issue = existing ?? {
      number: (await gh<{ number: number }>(token, "POST", "/issues", { title: issueTitle(row.message), body: issueBody(row, report, previous), labels: ISSUE_LABELS })).number,
      reported: count,
    };
    await run(
      "UPDATE error_reports SET issue_number = ?, issue_state = 'open', reported_count = ?, last_comment_at = ?, filing_at = NULL WHERE fingerprint = ?",
      [issue.number, issue.reported, at, fp],
    );
    if (!existing) return "opened";
  } catch (e) {
    // Refused outright: free the claim for the next report. Uncertain: keep the claim until it goes stale
    // (CLAIM_STALE_MS), by when GitHub's search has indexed any issue that did get created, and the next
    // attempt adopts it rather than opening a duplicate.
    if (refused(e)) await release();
    throw e;
  }
  // Adopted: the issue still shows the count it was opened with. Tell GitHub about the rest now, rather than
  // waiting for another report. Refused: reported_count stays as it is and the next daily comment catches up.
  // Unknown outcome: counted as told, so the same occurrences are never announced twice.
  if (count > existing.reported) {
    try {
      await gh(token, "POST", `/issues/${existing.number}/comments`, { body: commentBody(count - existing.reported, count, row.first_seen, report) });
    } catch (e) {
      if (refused(e)) throw e;
    }
    await run("UPDATE error_reports SET reported_count = MAX(reported_count, ?) WHERE fingerprint = ?", [count, fp]);
  }
  return "adopted";
}

/** An open issue already filed for this fingerprint (not `previous`), found by the fingerprint in its body,
 *  with the occurrence count that body states. */
async function findOpenIssue(token: string, fp: string, previous: number | null): Promise<{ number: number; reported: number } | null> {
  const q = encodeURIComponent(`"${fp}" repo:${GITHUB_REPO} is:issue is:open in:body`);
  const found = await gh<{ items?: { number: number; state: string; body?: string | null }[] }>(token, "GET", `/search/issues?q=${q}&per_page=5`);
  const hit = (found.items ?? []).find((i) => i.state === "open" && i.number !== previous && (i.body ?? "").includes(fp));
  if (!hit) return null;
  const stated = Number(/\*\*Occurrences:\*\* (\d+)/.exec(hit.body ?? "")?.[1]);
  return { number: hit.number, reported: Number.isInteger(stated) && stated > 0 ? stated : 1 };
}

/**
 * Brings GitHub up to date for one fingerprint: opens its issue, or adds the daily
 * "seen N more times" comment, or does nothing. Throws on a GitHub/database error
 * (queueFiling catches and logs it).
 */
export async function fileReport(fp: string, now = new Date()): Promise<FilingOutcome> {
  const token = env.githubReportToken;
  if (!token) return "no-token";
  const row = await get<Row>(`SELECT ${ROW_COLUMNS} FROM error_reports WHERE fingerprint = ?`, [fp]);
  if (!row) return "missing";
  if (row.issue_number == null) return openIssue(fp, token, now, null);
  if (row.issue_state === "not_planned") return "not-planned";
  if (Number(row.count) <= Number(row.reported_count)) return "up-to-date";

  // At most one comment a day: claim the day's slot by moving last_comment_at forward.
  const at = now.toISOString();
  const dayAgo = new Date(now.getTime() - COMMENT_EVERY_MS).toISOString();
  const claimed = await run(
    "UPDATE error_reports SET last_comment_at = ? WHERE fingerprint = ? AND issue_number = ? AND (last_comment_at IS NULL OR last_comment_at <= ?)",
    [at, fp, row.issue_number, dayAgo],
  );
  if (!claimed) return "throttled";
  const giveBack = () => run("UPDATE error_reports SET last_comment_at = ? WHERE fingerprint = ? AND last_comment_at = ?", [row.last_comment_at, fp, at]);
  let issue: { state: string; state_reason?: string | null } | null;
  try {
    issue = await gh<{ state: string; state_reason?: string | null }>(token, "GET", `/issues/${row.issue_number}`);
  } catch (e) {
    // Deleted or transferred: as good as closed, so the error gets a fresh issue.
    if (e instanceof GithubError && (e.status === 404 || e.status === 410)) issue = null;
    else { await giveBack(); throw e; }
  }
  if (issue && issue.state === "closed" && issue.state_reason === "not_planned") {
    await run("UPDATE error_reports SET issue_state = 'not_planned' WHERE fingerprint = ?", [fp]);
    return "not-planned";
  }
  if (!issue || issue.state === "closed") {
    await run("UPDATE error_reports SET issue_state = 'closed' WHERE fingerprint = ?", [fp]);
    try { return await openIssue(fp, token, now, row.issue_number); } catch (e) { await giveBack(); throw e; }
  }
  try {
    const report = JSON.parse(row.sample) as ErrorReport;
    const more = Number(row.count) - Number(row.reported_count);
    await gh(token, "POST", `/issues/${row.issue_number}/comments`, { body: commentBody(more, Number(row.count), row.last_comment_at ?? row.first_seen, report) });
    // Only up to the count this comment announced: reports that arrived meanwhile go in the next one.
    await run("UPDATE error_reports SET reported_count = MAX(reported_count, ?), issue_state = 'open' WHERE fingerprint = ?", [Number(row.count), fp]);
    return "commented";
  } catch (e) {
    // Refused: give the day's slot back. Uncertain (the comment may be posted): keep it, so a retry can't
    // post the same comment twice; the next one goes out a day later and covers these reports too.
    if (refused(e)) await giveBack();
    throw e;
  }
}

const inflight = new Set<Promise<unknown>>();

/** Files in the background; the request that stored the report has already been answered. Never throws. */
export function queueFiling(fp: string): void {
  if (!env.githubReportToken) return; // store only
  const p = fileReport(fp)
    .catch((e) => { console.warn(`[reports] stored, not filed on GitHub: ${e instanceof GithubError ? e.message : (e as Error)?.name === "TimeoutError" ? "timeout" : "error"}`); })
    .finally(() => { inflight.delete(p); });
  inflight.add(p);
}

/** Tests: wait until every background filing has finished. */
export async function settleFilings(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

// --- Owner portal -----------------------------------------------------------------------------

export interface ErrorReportSummary {
  fingerprint: string; message: string; count: number; firstSeen: string; lastSeen: string;
  issueNumber: number | null; issueUrl: string | null; issueState: string | null; lastCommentAt: string | null;
  /** The owner's own note (migration 56), shown in the console only; never sent to GitHub. */
  ownerNote: string | null; ownerNoteAt: string | null;
  /** When the owner cleared it or its issue was closed; null while it needs him. A new occurrence opens it again. */
  resolvedAt: string | null;
  sample: ErrorReport;
}

const toSummary = (r: Row): ErrorReportSummary => ({
  fingerprint: r.fingerprint, message: r.message, count: Number(r.count), firstSeen: r.first_seen, lastSeen: r.last_seen,
  issueNumber: r.issue_number == null ? null : Number(r.issue_number),
  issueUrl: r.issue_number == null ? null : `https://github.com/${GITHUB_REPO}/issues/${r.issue_number}`,
  issueState: r.issue_state, lastCommentAt: r.last_comment_at,
  ownerNote: r.owner_note ?? null, ownerNoteAt: r.owner_note_at ?? null,
  resolvedAt: r.resolved_at ?? null,
  sample: JSON.parse(r.sample) as ErrorReport,
});

/** The ones still needing the owner first, then the cleared ones; most recently seen first within each. */
export async function listErrorReports(limit = 50): Promise<ErrorReportSummary[]> {
  const rows = await all<Row>(`SELECT ${ROW_COLUMNS} FROM error_reports ORDER BY resolved_at IS NOT NULL, last_seen DESC LIMIT ?`, [Math.min(200, Math.max(1, Math.floor(limit) || 50))]);
  return rows.map(toSummary);
}

/** What GitHub says about one issue: its state and, once closed, why, when and what closed it. */
export interface IssueState { state: "open" | "completed" | "not_planned"; closedAt: string | null; by: { label: string; url: string } | null }
type Closer = { __typename: string; number?: number; url?: string; abbreviatedOid?: string } | null;
interface IssueNode { number: number; state: string; stateReason: string | null; closedAt: string | null; timelineItems?: { nodes?: ({ closer?: Closer } | null)[] } }
/** Issues asked about per GitHub request (GraphQL aliases). */
const ISSUE_BATCH = 50;

/** The pull request or commit GitHub says closed an issue, as a label and a GitHub link, or null. */
export function closerOf(c: Closer): { label: string; url: string } | null {
  if (!c?.url || !c.url.startsWith("https://github.com/")) return null;
  if (c.__typename === "PullRequest" && Number.isInteger(c.number)) return { label: `PR #${c.number}`, url: c.url };
  if (c.__typename === "Commit") return { label: `commit ${(c.abbreviatedOid ?? "").slice(0, 7) || "on main"}`.trim(), url: c.url };
  return null;
}

/**
 * The state of each issue, one GraphQL request per 50 numbers (state, why it closed, when, and the closing PR or
 * commit). An issue GitHub doesn't find is left out of the answer. A batch that fails stops the rest: what the earlier
 * batches found is still answered, with the error as `failed` (the caller uses the answers, then reports it). Throws
 * when the first batch fails (a GithubError with retryAt when rate limited).
 */
export async function issueStates(token: string, numbers: number[]): Promise<Map<number, IssueState> & { failed?: unknown }> {
  const out: Map<number, IssueState> & { failed?: unknown } = new Map<number, IssueState>();
  const wanted = [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))];
  const [owner, name] = GITHUB_REPO.split("/");
  const fields = "number state stateReason closedAt timelineItems(itemTypes: CLOSED_EVENT, last: 1) { nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number url } ... on Commit { url abbreviatedOid } } } } }";
  for (let i = 0; i < wanted.length; i += ISSUE_BATCH) {
    const batch = wanted.slice(i, i + ISSUE_BATCH);
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${batch.map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(" ")} } }`;
    let repo: Record<string, IssueNode | null>;
    try {
      const answer = await gh<{ data?: { repository?: Record<string, IssueNode | null> | null }; errors?: { type?: string; path?: unknown[] }[] }>(
        token, "POST", "/graphql", { query, variables: { owner, name } });
      if (!answer.data?.repository) throw new Error("GitHub didn't answer for the repository");
      // GraphQL answers 200 with an errors list: only "not found" on one issue means it's gone; anything else is a failure.
      const other = (answer.errors ?? []).find((e) => e.type !== "NOT_FOUND");
      if (other) throw new Error(`GitHub answered with an error${other.type ? ` (${other.type})` : ""}`);
      repo = answer.data.repository;
    } catch (e) {
      if (i === 0) throw e;
      out.failed = e;
      return out;
    }
    for (const n of batch) {
      const issue = repo[`i${n}`];
      if (!issue) continue;
      if (issue.state !== "CLOSED") { out.set(n, { state: "open", closedAt: null, by: null }); continue; }
      out.set(n, {
        state: issue.stateReason === "NOT_PLANNED" || issue.stateReason === "DUPLICATE" ? "not_planned" : "completed",
        closedAt: issue.closedAt, by: closerOf(issue.timelineItems?.nodes?.at(-1)?.closer ?? null),
      });
    }
  }
  return out;
}

/**
 * Error reports follow their issue too: one still needing the owner whose issue was last seen open and is now closed
 * is cleared (resolved_at: when GitHub closed it) and takes the issue's state. One the owner put back on the list is
 * cleared again only for an issue closed after that (reopened_at); one whose issue was known closed then isn't asked
 * about at all. Returns how many it cleared. No token: nothing.
 */
export async function syncErrorIssues(now = Date.now()): Promise<number> {
  const token = env.githubReportToken;
  if (!token) return 0;
  const rows = await all<{ fingerprint: string; issue_number: number; reopened_at: string | null }>(
    `SELECT fingerprint, issue_number, reopened_at FROM error_reports WHERE resolved_at IS NULL AND issue_number IS NOT NULL AND issue_state = 'open'
       ORDER BY issue_checked_at IS NOT NULL, issue_checked_at LIMIT 200`);
  if (!rows.length) return 0;
  const states = await issueStates(token, rows.map((r) => Number(r.issue_number)));
  const checked = new Date(now).toISOString();
  for (const r of rows) await run("UPDATE error_reports SET issue_checked_at = ? WHERE fingerprint = ?", [checked, r.fingerprint]);
  let cleared = 0;
  for (const r of rows) {
    const s = states.get(Number(r.issue_number));
    if (!s || s.state === "open") continue;
    const closedAt = s.closedAt ?? new Date(now).toISOString();
    // Put back on the list after GitHub closed it: the owner's call stands until the issue is closed again.
    if (r.reopened_at && closedAt <= r.reopened_at) continue;
    const done = await get(
      `UPDATE error_reports SET resolved_at = ?, issue_state = ? WHERE fingerprint = ? AND issue_number = ? AND resolved_at IS NULL
         AND issue_state = 'open' AND reopened_at IS ? RETURNING fingerprint`,
      [closedAt, s.state === "not_planned" ? "not_planned" : "closed", r.fingerprint, r.issue_number, r.reopened_at]);
    if (done) cleared++;
  }
  if (states.failed) throw states.failed;
  return cleared;
}

/**
 * The owner clears an error report (or opens it again). Clearing one whose issue is open also closes the issue on
 * GitHub as completed, when there's a token; if GitHub refuses or doesn't answer, the report is still cleared and
 * `issueClosed` says it wasn't. Null for an unknown report.
 */
export async function resolveErrorReport(fingerprint: string, resolved: boolean, now = new Date()): Promise<{ report: ErrorReportSummary; issueClosed: boolean } | null> {
  const row = await get<Row>(
    `UPDATE error_reports SET resolved_at = ?, reopened_at = CASE WHEN ? THEN reopened_at ELSE ? END WHERE fingerprint = ? RETURNING ${ROW_COLUMNS}`,
    [resolved ? now.toISOString() : null, resolved ? 1 : 0, now.toISOString(), fingerprint]);
  if (!row) return null;
  let issueClosed = false;
  const token = env.githubReportToken;
  if (resolved && token && row.issue_number != null && row.issue_state === "open") {
    try {
      await gh(token, "PATCH", `/issues/${row.issue_number}`, { state: "closed", state_reason: "completed" });
      await run("UPDATE error_reports SET issue_state = 'closed' WHERE fingerprint = ?", [fingerprint]);
      row.issue_state = "closed";
      issueClosed = true;
    } catch { /* cleared here; the issue stays open on GitHub */ }
  }
  return { report: toSummary(row), issueClosed };
}

/** The longest owner note kept. */
export const OWNER_NOTE_MAX = 2000;

/**
 * Set (or clear, with an empty note) the owner's note on one report. Returns the note it replaced and the
 * updated report, or null when there's no such report.
 */
export async function setErrorNote(fingerprint: string, note: string, now = new Date()): Promise<{ was: string | null; report: ErrorReportSummary } | null> {
  const text = note.trim().slice(0, OWNER_NOTE_MAX) || null;
  // The note replaced is read in the same transaction as the write, so the audit log's old value is the real one.
  const [before, after] = await db().batch([
    { sql: "SELECT owner_note FROM error_reports WHERE fingerprint = ?", args: [fingerprint] },
    { sql: "UPDATE error_reports SET owner_note = ?, owner_note_at = ? WHERE fingerprint = ? RETURNING *", args: [text, text ? now.toISOString() : null, fingerprint] },
  ], "write");
  const row = after.rows[0] as unknown as Row | undefined;
  if (!row) return null;
  const was = (before.rows[0] as unknown as { owner_note: string | null } | undefined)?.owner_note ?? null;
  return { was, report: toSummary(row) };
}

// --- Routes ---------------------------------------------------------------------------------------

export function reportsRouter(): Router {
  const r = express.Router();
  r.post("/error", (req: Request, res: Response) => {
    (async () => {
      // JSON only: a cross-site form can't post JSON without a preflight we never allow.
      if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
      // Switched off in the owner portal: accepted and dropped (the app stops asking too, via /api/flags).
      if (!(await isEnabled("errorReporting"))) { res.status(202).json({ ok: true }); return; }
      const problem = reportShapeError(req.body);
      if (problem) { res.status(400).json({ error: problem }); return; }
      const user = await currentUser(req).catch(() => null);
      const slot = user ? takeReportSlot(`u:${user.id}`, REPORT_RATE.account) : takeReportSlot(`ip:${req.ip ?? "?"}`, REPORT_RATE.ip);
      if (!slot.ok) {
        res.setHeader("Retry-After", String(slot.retryAfter));
        res.status(429).json({ error: "Several reports were sent in the last hour. Thanks, we have them.", retryAfter: slot.retryAfter });
        return;
      }
      const { fingerprint } = await storeReport(sanitizeReport(req.body));
      res.status(202).json({ ok: true });
      queueFiling(fingerprint);
    })().catch((e) => {
      // The reporting path never takes anything else down, and never reports itself.
      console.warn(`[reports] could not store an error report: ${(e as Error)?.name ?? "error"}`);
      if (!res.headersSent) res.status(503).json({ error: "Couldn't save the report right now." });
    });
  });
  r.get("/errors", (req: Request, res: Response) => {
    (async () => {
      if (!(await ownerOf(req))) { res.status(404).json({ error: "Not found" }); return; }
      res.json({ reports: await listErrorReports(Number(req.query.limit ?? 50)) });
    })().catch(() => { if (!res.headersSent) res.status(503).json({ error: "Couldn't load reports right now." }); });
  });
  return r;
}
