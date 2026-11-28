// Decisions from evidence (docs/official-videos.md, "Decisions from evidence"): the owner's review queue and the
// channel audit's findings, decided by checking each video (its title and description, its broadcast date against
// the event's days, its length, and where those leave it open, frames read from the video), shipped as data in
// server/data/videoDecisions.ts and applied once a process, like the checked list. Each lands the way an owner's
// decision does (official_watch approved or rejected, a link in official_videos), decided_by "evidence", with the
// reason and the evidence line in its why, so Owner › Official videos shows it as decided from evidence.
//
// A decision never overrides one already made: a video the owner (or the watcher) has decided keeps that, and a link
// whose day is taken by another playable video, or whose event isn't in this database, isn't written (logged). One this
// file made itself is the file's to change: an entry that no longer says what evidence wrote (a set-aside turned into a
// link, or a link's part named) is applied again; moving or taking off a link evidence made is left to the owner.
import { db, get } from "../db.js";
import { withDataLock, LockBusy } from "../data/lock.js";
import { recordAudit } from "../portal/audit.js";
import { VIDEO_DECISIONS, type VideoDecision } from "../data/videoDecisions.js";
import { eventVideosByDay, forgetOfficial } from "./officialVideos.js";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY } from "./eventDays.js";

/** Who the console says decided it. */
export const EVIDENCE = "evidence";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** What a decision's row says: the reason (set aside / rejected) or the link, then what was checked. */
export function decisionWhy(d: VideoDecision): string {
  const head = d.decision === "link" ? `linked from evidence to ${d.season} ${d.code} ${d.day}${d.part ? ` (${d.part})` : ""}`
    : d.decision === "reject" ? `rejected from evidence: ${d.reason}` : `set aside from evidence: ${d.reason}`;
  return `${head}. Checked: ${d.evidence}`.slice(0, 1000);
}

/** Whether an entry is complete enough to apply: a video id, a link's event and day, and a reason and evidence line. */
export function decisionProblem(d: VideoDecision): string | null {
  if (!VIDEO_ID.test(d.videoId)) return "not a YouTube video id";
  if (!d.evidence?.trim()) return "no evidence line";
  if (d.decision === "link") {
    if (!Number.isInteger(d.season) || !d.code || !d.day || !DAY.test(d.day)) return "a link needs its season, event code and day";
  } else if (d.decision === "reject" || d.decision === "setAside") {
    if (!d.reason?.trim()) return "no reason";
  } else return `unknown decision ${String((d as { decision: unknown }).decision)}`;
  return null;
}

export interface DecisionsRun { applied: number; linked: number; rejected: number; setAside: number; kept: number; skipped: string[]; /** Threw this pass (a busy database, say): tried again next pass. */ failed: string[] }

let applied = false;

/**
 * Apply every decision not applied yet. A video with no row anywhere (the audit hasn't read its channel in this
 * database) waits: it's applied on a later pass once the audit has its title. Returns what it did.
 */
export async function applyVideoDecisions(log: (s: string) => void, list: VideoDecision[] = VIDEO_DECISIONS, opts: { again?: boolean; now?: number; lockWaitMs?: number } = {}): Promise<DecisionsRun | null> {
  if (applied && !opts.again) return null;
  const out: DecisionsRun = { applied: 0, linked: 0, rejected: 0, setAside: 0, kept: 0, skipped: [], failed: [] };
  const at = new Date(opts.now ?? Date.now()).toISOString();
  let waiting = 0;
  try {
    await withDataLock("video decisions", async () => {
      for (const d of list) {
        const problem = decisionProblem(d);
        if (problem) { out.skipped.push(`${d.videoId}: ${problem}`); continue; }
        // One that fails (a busy database, say) is retried next pass; the rest still go.
        let r: Awaited<ReturnType<typeof applyOne>>;
        try { r = await applyOne(d, at); }
        catch (e) { out.failed.push(`${d.videoId}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); continue; }
        if (r === "waiting") waiting++;
        else if (r === "kept") out.kept++;
        else if (typeof r === "string" && r.startsWith("skip:")) out.skipped.push(`${d.videoId}: ${r.slice(5)}`);
        else if (r === "done") {
          out.applied++;
          if (d.decision === "link") out.linked++; else if (d.decision === "reject") out.rejected++; else out.setAside++;
        }
      }
    }, { ttlMs: 120_000, waitMs: opts.lockWaitMs ?? 30_000, pollMs: 500 });
  } catch (e) {
    // The data sync holds the lease: the next pass applies them.
    if (e instanceof LockBusy) return null;
    throw e;
  }
  if (out.linked) forgetOfficial();
  if (!waiting && !out.failed.length) applied = true;
  if (out.applied || out.skipped.length || out.failed.length) {
    log(`official videos: decisions from evidence: ${out.applied} applied (${out.linked} linked, ${out.rejected} rejected, ${out.setAside} set aside), ${out.kept} already decided${waiting ? `, ${waiting} not read by the audit yet` : ""}${out.failed.length ? `; ${out.failed.length} failed, tried again next pass: ${out.failed.slice(0, 3).join("; ")}` : ""}${out.skipped.length ? `; not applied: ${out.skipped.slice(0, 5).join("; ")}` : ""}`);
    if (out.applied) await recordAudit(EVIDENCE, "officialVideo.evidence", { applied: out.applied, linked: out.linked, rejected: out.rejected, setAside: out.setAside });
  }
  return out;
}

/** Whether the queue row evidence wrote still says what the entry says (its status, and a link's event, day and part). */
export function decidedAsEntry(w: { status: unknown; season: unknown; code: unknown; day: unknown; part: unknown }, d: VideoDecision): boolean {
  const want = d.decision === "link" ? ["approved", d.season, d.code, d.day, d.part ?? null] : ["rejected", null, null, null, null];
  const has = [w.status, w.season == null ? null : Number(w.season), w.code ?? null, w.day ?? null, w.part ?? null];
  return want.every((x, i) => x === has[i]);
}

/** One decision: "done", "kept" (already decided), "waiting" (no row to take its title from yet), or "skip:<why>". */
async function applyOne(d: VideoDecision, at: string): Promise<"done" | "kept" | "waiting" | `skip:${string}`> {
  const w = await get<any>("SELECT status, channel_id, title, season, code, day, part, decided_by FROM official_watch WHERE video_id = ?", [d.videoId]);
  // Decided by evidence, and the entry says otherwise now: decided again (an owner's or the watcher's decision never is).
  const again = !!w && String(w.decided_by) === EVIDENCE && !["pending", "ignored"].includes(String(w.status)) && !decidedAsEntry(w, d);
  if (w && !["pending", "ignored"].includes(String(w.status)) && !again) return "kept";
  // A finding the owner (or an earlier decision) already dismissed is decided: never overridden, a link least of all,
  // unless evidence dismissed it and is deciding again.
  const found = await get<any>("SELECT finding, finding_by FROM official_audit_videos WHERE video_id = ?", [d.videoId]);
  if (found?.finding === "dismissed" && !(again && found.finding_by === EVIDENCE)) return "kept";
  if (again && String(w.status) === "approved") return nameLinkedPart(d, w, at);
  const a = w ? null : await get<any>("SELECT channel_id, title, start, published, duration FROM official_audit_videos WHERE video_id = ?", [d.videoId]);
  if (!w && !a) return "waiting";
  const why = decisionWhy(d);
  const channel = String(w?.channel_id ?? a.channel_id), title = String(w?.title ?? a.title);
  // The queue row (written for an audit finding, which has none), decided.
  const status = d.decision === "link" ? "approved" : "rejected";
  const claim = w
    ? { sql: `UPDATE official_watch SET status = ?, season = ?, code = ?, day = ?, part = ?, why = ?, decided_at = ?, decided_by = ? WHERE video_id = ?
              AND ${again ? "decided_by = 'evidence' AND status NOT IN ('pending', 'ignored')" : "status IN ('pending', 'ignored')"}`,
        args: [status, d.season ?? null, d.code ?? null, d.day ?? null, d.part ?? null, why, at, EVIDENCE, d.videoId] }
    : { sql: `INSERT INTO official_watch (video_id, channel_id, title, start, published, duration, status, season, code, day, part, why, seen_at, decided_at, decided_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING`,
        args: [d.videoId, channel, title, a.start ?? null, a.published ?? null, a.duration ?? null, status, d.season ?? null, d.code ?? null, d.day ?? null, d.part ?? null, why, at, at, EVIDENCE] };
  // The audit's finding is settled by it: a link is a record now; anything else is the owner's kind of dismissal.
  const settles = again ? "(finding = 'open' OR (finding = 'dismissed' AND finding_by = 'evidence'))" : "finding = 'open'";
  const finding = d.decision === "link"
    ? { sql: `UPDATE official_audit_videos SET finding = NULL, found_at = NULL WHERE video_id = ? AND ${settles}`, args: [d.videoId] }
    : { sql: `UPDATE official_audit_videos SET finding = 'dismissed', finding_why = ?, finding_by = ? WHERE video_id = ? AND ${settles}`, args: [d.reason!.slice(0, 300), EVIDENCE, d.videoId] };
  if (d.decision !== "link") return (await inOne(d.videoId, [claim, finding], 0, undefined, undefined, again)) ? "done" : "kept";
  // A link: its event and day, the day free (or held only by a video YouTube no longer plays, named in replaces).
  // Its days: the listed ones and the days it played (eventDays.ts).
  const ev = await get<any>(`SELECT e.season, e.code, ${EVENT_FIRST_DAY} AS start, ${EVENT_LAST_DAY} AS end FROM events e WHERE e.season = ? AND e.code = ?`, [d.season!, d.code!]);
  if (!ev) return `skip:${d.season} ${d.code} isn't in this database`;
  const start = String(ev.start).slice(0, 10), end = String(ev.end ?? ev.start).slice(0, 10);
  if (d.day! < start || d.day! > end) return `skip:${d.code} runs ${start} to ${end}, not ${d.day}`;
  const has = await eventVideosByDay(Number(ev.season), String(ev.code));
  if (has.some((h) => h.videoId === d.videoId)) return `skip:${d.code} already plays it`;
  // A video of the event whose day isn't known yet (its timing not read) may hold that day: wait, like the seed does.
  if (has.some((h) => !h.timed)) return "waiting";
  const held = has.filter((h) => h.day === d.day && (d.part == null || h.part == null || h.part === d.part));
  const dead = held.filter((h) => h.gone && h.videoId === d.replaces);
  if (held.length > dead.length) return `skip:${d.code} already plays ${held.find((h) => !dead.includes(h))!.videoId} for ${d.day}`;
  const writes = [
    // A replaced video is one YouTube no longer plays (deleted or private): taken off, so the day is free.
    ...dead.map((h) => ({ sql: "UPDATE official_videos SET removed_at = ? WHERE video_id = ? AND season = ? AND code = ? AND removed_at IS NULL", args: [at, h.videoId, Number(ev.season), String(ev.code)] })),
    claim,
    { sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
            VALUES (?, ?, ?, 'recording', ?, ?, ?, ?, 'evidence', ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [d.videoId, Number(ev.season), String(ev.code), d.day!, d.part ?? null, channel, title, why, at, EVIDENCE] },
    finding,
  ];
  // The link itself must land (no other recording on that day and part), or none of it does.
  // The day read again inside the write: an owner's approval since (it takes no data lock) of another recording on
  // that day and an overlapping part (the whole day, or the same part) leaves it taken, and nothing is written.
  const taken = { sql: `SELECT 1 FROM official_videos WHERE season = ? AND code = ? AND kind = 'recording' AND removed_at IS NULL AND day = ? AND video_id != ?
            AND (? IS NULL OR part IS NULL OR part = ?)${dead.length ? ` AND video_id NOT IN (${dead.map(() => "?").join(", ")})` : ""} LIMIT 1`,
    args: [Number(ev.season), String(ev.code), d.day!, d.videoId, d.part ?? null, d.part ?? null, ...dead.map((h) => h.videoId)] };
  return (await inOne(d.videoId, writes, dead.length, dead.length + 1, taken, again)) ? "done" : `skip:${d.code} ${d.day} is taken, the video is on another event, or the owner decided it meanwhile`;
}

/**
 * A link evidence made whose entry now names another part of the same event's day (a restarted broadcast's Part 1/2):
 * the part is renamed on the queue row and the recording, unless another recording holds that day and part (or the
 * whole day). Any other change to a link (another event or day, or no link at all) is the owner's, on the event page.
 */
async function nameLinkedPart(d: VideoDecision, w: any, at: string): Promise<"done" | `skip:${string}`> {
  if (d.decision !== "link" || Number(w.season) !== d.season || w.code !== d.code || w.day !== d.day)
    return `skip:evidence linked it to ${w.season} ${w.code} ${w.day}: moving or taking off a link is the owner's, on the event page`;
  const why = decisionWhy(d);
  const writes = [
    { sql: "UPDATE official_watch SET part = ?, why = ?, decided_at = ? WHERE video_id = ? AND status = 'approved' AND decided_by = 'evidence'",
      args: [d.part ?? null, why, at, d.videoId] },
    { sql: "UPDATE official_videos SET part = ?, why = ? WHERE video_id = ? AND season = ? AND code = ? AND day = ? AND source = 'evidence' AND removed_at IS NULL",
      args: [d.part ?? null, why, d.videoId, d.season!, d.code!, d.day!] },
  ];
  const taken = { sql: `SELECT 1 FROM official_videos WHERE season = ? AND code = ? AND kind = 'recording' AND removed_at IS NULL AND day = ? AND video_id != ?
            AND (? IS NULL OR part IS NULL OR part = ?) LIMIT 1`,
    args: [d.season!, d.code!, d.day!, d.videoId, d.part ?? null, d.part ?? null] };
  return (await inOne(d.videoId, writes, 0, 1, taken, true)) ? "done" : `skip:${d.code} ${d.day}${d.part ? ` (${d.part})` : ""} is taken, or the link isn't evidence's to rename`;
}

/**
 * The writes in one transaction, committed only when the video's finding isn't dismissed (again: by anyone but evidence;
 * read inside it: an owner's
 * dismissal since the first read stands), nothing holds the day (taken: a query that must find no row, for a link),
 * the queue row was claimed (at claimAt: an owner's decision made since the status read leaves it unclaimed) and, for
 * a link, its recording landed (at landAt). false: rolled back.
 */
async function inOne(videoId: string, writes: { sql: string; args: (string | number | null)[] }[], claimAt: number, landAt?: number, taken?: { sql: string; args: (string | number | null)[] }, again = false): Promise<boolean> {
  const tx = await db().transaction("write");
  try {
    // Deciding again, evidence's own dismissal is no bar; the owner's always is.
    const dismissed = await tx.execute({ sql: `SELECT 1 FROM official_audit_videos WHERE video_id = ? AND finding = 'dismissed'${again ? " AND finding_by IS NOT 'evidence'" : ""}`, args: [videoId] });
    if (dismissed.rows.length) { await tx.rollback(); return false; }
    if (taken && (await tx.execute(taken)).rows.length) { await tx.rollback(); return false; }
    const results = [];
    for (const s of writes) results.push(await tx.execute(s));
    if (!results[claimAt].rowsAffected || (landAt != null && !results[landAt].rowsAffected)) { await tx.rollback(); return false; }
    await tx.commit();
    return true;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

/** Test hook: forget that this process applied them. */
export function resetVideoDecisions() { applied = false; }
