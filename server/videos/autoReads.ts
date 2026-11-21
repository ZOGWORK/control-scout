// What the clip autopilot reads, put on the live site with no PR and no deploy (docs/clip-autopilot.md). The autopilot
// (scripts/clip-autopilot.ts, on computers at home) drops each delivery, one JSON file of frame-read rows
// (server/data/frameTimings) or first-frame clip checks (server/data/clipChecks), into an inbox in the data directory
// over ssh. This server takes each file, checks every row against the row it serves now with the same rules the
// autopilot keeps (server/data/frameRowRules.ts), and:
//   - a row that keeps every rule goes live at once (auto_reads.live_json, laid over the code's row: setAutoFrameRows);
//   - a row that breaks any waits for the owner (pending_json, with its problems in plain words): Owner › Clip coverage,
//     Waiting for approval, Approve (live as read) or Reject (dropped; the event can be read again);
//   - a row whose video showed the reader nothing (nothingRead) is a failed read: dropped, logged, never the owner's.
// A later read of the same video and event replaces a waiting one. Every delivery and decision is audited.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, get, run } from "../db.js";
import { env } from "../env.js";
import { FRAME_TIMINGS, frameRow, frameRowSeason, frameStart, playableStarts, setAutoFrameRows, type FrameTiming } from "../data/frameTimings.js";
import { clipCheckRow, setAutoClipChecks, type ClipCheck } from "../data/clipChecks.js";
import { carryApproved, clipCheckProblems, nothingRead, rowProblems, SAME_S } from "../data/frameRowRules.js";
import { CLIP_LEAD_S } from "../../src/shared/recording.js";
import { LockBusy, withDataLock } from "../data/lock.js";
import { recordAudit } from "../portal/audit.js";
import { clearAllCaches } from "../caches.js";
import type { AutoReadChange, AutoReadKind, OwnerAutoReads, PendingAutoRead, PendingReview } from "../../src/shared/api.js";

/** Who the audit names for what the autopilot hands over. */
export const AUTOPILOT_ACTOR = "clip autopilot";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CODE = /^[A-Za-z0-9_-]{1,40}$/;
const isSecondsMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---- The live rows, into memory --------------------------------------------------------------------------------------

/** What was loaded last (how many live rows, the latest live_at): a poll that finds the table moved (another server
 *  process wrote it, during a zero-gap deploy's hand-off) loads again. */
let loadedSig = "";
async function liveSig(): Promise<string> {
  const r = await get<{ n: number; m: string | null }>("SELECT COUNT(*) AS n, MAX(live_at) AS m FROM auto_reads WHERE live_json IS NOT NULL");
  return `${r?.n ?? 0}|${r?.m ?? ""}`;
}

/** Every live auto read into memory, laid over the code's rows (at boot, and after each change). The rows loaded. */
export async function loadAutoReads(): Promise<number> {
  const sig = await liveSig();
  const rows = await all<{ kind: string; season: number; live_json: string }>("SELECT kind, season, live_json FROM auto_reads WHERE live_json IS NOT NULL ORDER BY kind, code, video_id");
  const frames: FrameTiming[] = [], seasons: number[] = [], clips: ClipCheck[] = [];
  for (const r of rows) {
    try {
      const row = JSON.parse(String(r.live_json));
      if (r.kind === "frames") { frames.push(row); seasons.push(Number(r.season)); } else if (r.kind === "clips") clips.push(row);
    } catch { /* a row that isn't JSON is never served */ }
  }
  setAutoFrameRows(frames, seasons);
  setAutoClipChecks(clips);
  loadedSig = sig;
  return frames.length + clips.length;
}

/** The live auto reads of one kind, with each row's season: for the autopilot, which lays them over main's files before
 *  it reads (so what's live from the database counts as read). A database without the table (an older snapshot): none. */
export async function autoLiveRows(kind: "frames"): Promise<{ season: number; row: FrameTiming }[]>;
export async function autoLiveRows(kind: "clips"): Promise<{ season: number; row: ClipCheck }[]>;
export async function autoLiveRows(kind: AutoReadKind): Promise<{ season: number; row: FrameTiming | ClipCheck }[]> {
  try {
    const rows = await all<{ season: number; live_json: string }>("SELECT season, live_json FROM auto_reads WHERE kind = ? AND live_json IS NOT NULL ORDER BY code, video_id", [kind]);
    return rows.flatMap((r) => { try { return [{ season: Number(r.season), row: JSON.parse(String(r.live_json)) }]; } catch { return []; } });
  } catch (e) {
    if (/no such table/i.test((e as Error).message)) return [];
    throw e;
  }
}

// ---- The decision -----------------------------------------------------------------------------------------------------

/** What becomes of one row handed over: `same` (already live as it is), `live` (no problem: served at once), `pending`
 *  (a problem: the owner's), `drop` (a failed read, or not a row at all). */
export type Verdict = { to: "same" } | { to: "live" } | { to: "pending"; problems: string[] } | { to: "drop"; why: string };

/** The decision for a frame-read row against the row served now (`live`: the database's, else the code's; none: new). */
export function judgeFrames(next: FrameTiming, live: FrameTiming | null, order: string[] | undefined): Verdict {
  // The caller lays the live row's owner-approved starts on first (carryApproved): judged with them.
  if (nothingRead(next)) return { to: "drop", why: "no frame of the video could be read or the video couldn't be played: a failed read, the event read again later" };
  if (live && JSON.stringify(live) === JSON.stringify(next)) return { to: "same" };
  const problems = rowProblems(next, live ?? undefined, order);
  return problems.length ? { to: "pending", problems } : { to: "live" };
}

/** The decision for a first-frame clip check against the one live now. */
export function judgeClips(next: ClipCheck, live: ClipCheck | null): Verdict {
  if (live && JSON.stringify(live) === JSON.stringify(next)) return { to: "same" };
  const problems = clipCheckProblems(next, live ?? undefined);
  return problems.length ? { to: "pending", problems } : { to: "live" };
}

/** Each event's played matches in the order they were played (FIRST's times are the venue's own, so they sort): the
 *  order check's list, as the autopilot builds it. */
export async function playedOrder(season: number, codes: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!codes.length) return out;
  for (const m of await all<{ code: string; label: string }>(`SELECT code, label FROM matches WHERE season = ? AND played = 1 AND time IS NOT NULL AND code IN (${codes.map(() => "?").join(",")}) ORDER BY code, time`, [season, ...codes])) {
    (out.get(String(m.code)) ?? out.set(String(m.code), []).get(String(m.code))!).push(String(m.label));
  }
  return out;
}

/** Why a frame-read row isn't one (null: it is). */
function frameShape(r: unknown): string | null {
  if (!isObj(r)) return "not a row";
  if (typeof r.videoId !== "string" || !VIDEO_ID.test(r.videoId)) return "no YouTube video id";
  if (typeof r.code !== "string" || !CODE.test(r.code)) return "no event code";
  if (typeof r.checked !== "string") return "no checked date";
  if (!isSecondsMap(r.starts)) return "its starts aren't seconds";
  if (r.opens != null && !isSecondsMap(r.opens)) return "its openings aren't seconds";
  return null;
}
/** Why a first-frame clip check isn't one (null: it is). */
function clipShape(r: unknown): string | null {
  if (!isObj(r)) return "not a row";
  if (typeof r.videoId !== "string" || !VIDEO_ID.test(r.videoId)) return "no YouTube video id";
  if (typeof r.code !== "string" || !CODE.test(r.code)) return "no event code";
  if (typeof r.checked !== "string") return "no checked date";
  if (!Number.isInteger(r.season)) return "no season";
  return null;
}

/** One delivery as the autopilot writes it (scripts/clip-autopilot.ts deliver). */
export interface Delivery { kind: AutoReadKind; season: number; rows: unknown[]; source?: string }

/** Why a parsed file isn't a delivery (null: it is). */
export function deliveryShape(d: unknown): string | null {
  if (!isObj(d)) return "not a JSON object";
  if (d.kind !== "frames" && d.kind !== "clips") return `kind ${JSON.stringify(d.kind)} isn't frames or clips`;
  if (!Number.isInteger(d.season) || (d.season as number) < 2000 || (d.season as number) > 2100) return "no season";
  if (!Array.isArray(d.rows)) return "no rows";
  return null;
}

export interface DeliveryResult { live: string[]; pending: string[]; same: number; dropped: { key: string; why: string }[] }

/** Puts one delivery's rows where they belong (live, waiting, or nowhere), each against the row served now. The caller
 *  holds the data lock. Memory and caches are refreshed when anything went live. */
export async function applyDelivery(d: Delivery, now = Date.now(), log: (s: string) => void = () => {}): Promise<DeliveryResult> {
  // Another server process may have put rows live since this one loaded: decide against the table as it is.
  if ((await liveSig()) !== loadedSig) await loadAutoReads();
  const at = new Date(now).toISOString(), source = typeof d.source === "string" ? d.source.slice(0, 200) : null;
  const out: DeliveryResult = { live: [], pending: [], same: 0, dropped: [] };
  const valid: (FrameTiming | ClipCheck)[] = [];
  for (const r of d.rows) {
    const bad = d.kind === "frames" ? frameShape(r) : clipShape(r);
    if (bad) { out.dropped.push({ key: isObj(r) ? `${String(r.videoId)}|${String(r.code)}` : "?", why: bad }); continue; }
    valid.push(r as FrameTiming | ClipCheck);
  }
  const order = d.kind === "frames" ? await playedOrder(d.season, [...new Set(valid.map((r) => r.code))]) : new Map<string, string[]>();
  for (const read of valid) {
    // A frame-read row keeps the starts the owner approved on the live row (carryApproved), unless a frame names
    // another match there; and never approves anything itself.
    const r = d.kind === "frames" ? carryApproved(read as FrameTiming, frameRow(read.videoId, read.code)) : read;
    const key = `${r.videoId}|${r.code}`;
    const season = d.kind === "clips" ? (r as ClipCheck).season : d.season;
    const v = d.kind === "frames"
      ? judgeFrames(r as FrameTiming, frameRow(r.videoId, r.code), order.get(r.code))
      : judgeClips(r as ClipCheck, clipCheckRow(r.videoId, r.code));
    if (v.to === "drop") { out.dropped.push({ key, why: v.why }); log(`auto reads: ${season} ${key}: dropped, ${v.why}`); continue; }
    if (v.to === "same") {
      out.same++;
      // Read again as it's served: a read waiting for the owner is outdated by it.
      await run("UPDATE auto_reads SET pending_json = NULL, pending_problems = NULL, pending_at = NULL WHERE kind = ? AND video_id = ? AND code = ?", [d.kind, r.videoId, r.code]);
      continue;
    }
    const json = JSON.stringify(r);
    if (v.to === "live") {
      // Live at once; a read waiting for the owner is outdated by this newer one.
      await run(`INSERT INTO auto_reads (kind, video_id, code, season, live_json, live_at, decided_by, source) VALUES (?, ?, ?, ?, ?, ?, 'auto', ?)
        ON CONFLICT (kind, video_id, code) DO UPDATE SET season = excluded.season, live_json = excluded.live_json, live_at = excluded.live_at,
          decided_by = 'auto', source = excluded.source, pending_json = NULL, pending_problems = NULL, pending_at = NULL`,
      [d.kind, r.videoId, r.code, season, json, at, source]);
      out.live.push(key);
    } else {
      await run(`INSERT INTO auto_reads (kind, video_id, code, season, pending_json, pending_problems, pending_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (kind, video_id, code) DO UPDATE SET pending_json = excluded.pending_json, pending_problems = excluded.pending_problems,
          pending_at = excluded.pending_at, source = excluded.source`,
      [d.kind, r.videoId, r.code, season, json, JSON.stringify(v.problems), at, source]);
      out.pending.push(key);
      log(`auto reads: ${season} ${key}: waits for the owner, ${v.problems.join("; ")}`);
    }
  }
  await recordAudit(AUTOPILOT_ACTOR, "autoReads.delivery", { kind: d.kind, season: d.season, source, live: out.live, pending: out.pending, same: out.same, dropped: out.dropped });
  if (out.live.length) { await loadAutoReads(); clearAllCaches(); }
  return out;
}

// ---- The inbox ---------------------------------------------------------------------------------------------------------

/** A delivery that fails to apply this many times goes to rejected/. Its tries so far are in its name (x.try2.json). */
export const APPLY_TRIES = 5;
export const triesOf = (name: string) => Number(/\.try(\d+)\.json$/.exec(name)?.[1] ?? 0);
export const withTries = (name: string, tries: number) => `${name.replace(/(\.try\d+)?\.json$/, "")}.try${tries}.json`;

/** Where the autopilot drops its deliveries (scripts/clip-autopilot.ts: <data dir>/auto-reads-inbox on the VM). */
export const inboxDir = () => process.env.AUTO_READS_INBOX ?? join(env.dataDir, "auto-reads-inbox");
/** A claim left this long (its server stopped mid-file) goes back into the inbox for the next poll. */
export const CLAIM_STALE_MS = 30 * 60_000;
/** A delivery bigger than this isn't read (a season's whole file is about 1 MB). */
export const DELIVERY_MAX_BYTES = 8 << 20;

export function ensureInbox(dir = inboxDir()): void {
  for (const d of [dir, join(dir, "claimed"), join(dir, "rejected")]) mkdirSync(d, { recursive: true });
}
/** Deliveries waiting: *.json in the inbox (a file still being written is a dot-file, renamed in when whole). */
const waiting = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")) : []);

/** Claims every waiting delivery for this process: each moved into claimed/ by a rename, which only one process's can
 *  do (two servers poll at once during a zero-gap deploy's hand-off; the other's rename finds the file gone). Claims a
 *  stopped server left are put back first. The claimed paths, with each one's name in the inbox. */
export function claimInbox(dir = inboxDir(), now = Date.now()): { path: string; name: string }[] {
  ensureInbox(dir);
  const claimedDir = join(dir, "claimed");
  for (const f of readdirSync(claimedDir)) {
    const p = join(claimedDir, f);
    try {
      if (now - statSync(p).mtimeMs < CLAIM_STALE_MS) continue;
      // Its name in the inbox: the claim's name less the ".<claim id>" this process added.
      renameSync(p, join(dir, f.replace(/\.claim-[^.]+$/, "")));
    } catch { /* another process put it back first, or finished it */ }
  }
  const out: { path: string; name: string }[] = [];
  for (const name of waiting(dir)) {
    const path = join(claimedDir, `${name}.claim-${process.pid}-${randomUUID().slice(0, 8)}`);
    try { renameSync(join(dir, name), path); out.push({ path, name }); } catch { /* another process claimed it */ }
  }
  return out;
}

/** Every delivery in the inbox, put live or held for the owner, under the data lock (one writer at a time, across the
 *  server's processes and the sync cycle). A file that isn't a delivery goes to rejected/ with why; one whose rows
 *  couldn't be written (the database busy) goes back into the inbox for the next poll. Nothing waiting: no lock taken. */
export async function processInbox(o: { dir?: string; now?: number; log?: (s: string) => void } = {}): Promise<{ files: number; live: number; pending: number; dropped: number; rejected: number } | "busy"> {
  const dir = o.dir ?? inboxDir(), log = o.log ?? (() => {}), now = o.now ?? Date.now();
  const totals = { files: 0, live: 0, pending: 0, dropped: 0, rejected: 0 };
  const stale = existsSync(join(dir, "claimed")) && readdirSync(join(dir, "claimed")).length > 0;
  if (!waiting(dir).length && !stale) return totals;
  try {
    await withDataLock("auto reads inbox", async () => {
      for (const c of claimInbox(dir, now)) {
        let d: unknown;
        try {
          const size = statSync(c.path).size;
          if (size > DELIVERY_MAX_BYTES) throw new Error(`${size} bytes, over ${DELIVERY_MAX_BYTES}`);
          d = JSON.parse(readFileSync(c.path, "utf8"));
          const bad = deliveryShape(d);
          if (bad) throw new Error(bad);
        } catch (e) {
          const why = (e as Error).message;
          // Set aside on its own: a rejected/ that can't be written never stops the files claimed after this one.
          try {
            renameSync(c.path, join(dir, "rejected", c.name));
            writeFileSync(join(dir, "rejected", `${c.name}.error.txt`), `${new Date(now).toISOString()} ${why}\n`);
            totals.rejected++;
            log(`auto reads: ${c.name}: not a delivery (${why}); moved to rejected/`);
          } catch (e2) {
            log(`auto reads: ${c.name}: not a delivery (${why}), and it couldn't be set aside (${(e2 as Error).message}); left claimed`);
          }
          continue;
        }
        try {
          const r = await applyDelivery(d as Delivery, now, log);
          rmSync(c.path, { force: true });
          totals.files++; totals.live += r.live.length; totals.pending += r.pending.length; totals.dropped += r.dropped.length;
          log(`auto reads: ${c.name}: ${r.live.length} live, ${r.pending.length} waiting for the owner, ${r.same} as served, ${r.dropped.length} dropped`);
        } catch (e) {
          // Back into the inbox, whole, for the next poll (a row written already is written again the same), its tries
          // counted in its name; after APPLY_TRIES it goes to rejected/ with why, so a file that always fails isn't
          // claimed every minute for ever.
          const why = (e as Error).message, tries = triesOf(c.name) + 1;
          try {
            if (tries >= APPLY_TRIES) {
              renameSync(c.path, join(dir, "rejected", c.name));
              writeFileSync(join(dir, "rejected", `${c.name}.error.txt`), `${new Date(now).toISOString()} couldn't be applied ${tries} times: ${why}\n`);
              totals.rejected++;
              log(`auto reads: ${c.name}: couldn't be applied ${tries} times (${why}); moved to rejected/`);
            } else {
              renameSync(c.path, join(dir, withTries(c.name, tries)));
              log(`auto reads: ${c.name}: couldn't be applied (${why}); read again next poll (try ${tries} of ${APPLY_TRIES})`);
            }
          } catch { log(`auto reads: ${c.name}: couldn't be applied (${why}), and couldn't be put back; left claimed until stale`); }
        }
      }
    }, { ttlMs: 120_000 });
  } catch (e) {
    if (e instanceof LockBusy) return "busy";
    throw e;
  }
  return totals;
}

/** How often the inbox is looked at (and the live rows checked for another process's writes). */
export const INBOX_POLL_MS = 60_000;
/** The inbox made, read once now and then every INBOX_POLL_MS; memory loaded again whenever the table moved. */
export function startAutoReadsInbox(log: (s: string) => void): void {
  try { ensureInbox(); } catch (e) { log(`auto reads: the inbox couldn't be made (${(e as Error).message})`); }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if ((await liveSig()) !== loadedSig) { await loadAutoReads(); clearAllCaches(); }
      await processInbox({ log });
    } catch (e) { log(`auto reads: ${(e as Error).message}`); } finally { busy = false; }
  };
  setTimeout(() => void tick(), 5_000).unref();
  setInterval(() => void tick(), INBOX_POLL_MS).unref();
}

// ---- The owner's side (Owner › Clip coverage, Waiting for approval) ------------------------------------------------------

/** What a waiting frame-read row changes against the live one: matches added, moved and pulled (their seconds), and the
 *  second worth opening the video at (the first change). */
export function frameChanges(next: FrameTiming, live: FrameTiming | null): { changes: AutoReadChange[]; before: number; after: number } {
  const was = live ? playableStarts(live) : {}, now = playableStarts(next), changes: AutoReadChange[] = [];
  for (const [label, t] of Object.entries(now)) {
    if (was[label] == null) changes.push({ label, what: "added", from: null, to: t });
    else if (Math.abs(was[label] - t) > SAME_S) changes.push({ label, what: "moved", from: was[label], to: t });
  }
  for (const [label, t] of Object.entries(was)) if (now[label] == null) changes.push({ label, what: "pulled", from: t, to: null });
  changes.sort((a, b) => (a.to ?? a.from ?? 0) - (b.to ?? b.from ?? 0));
  return { changes, before: Object.keys(was).length, after: Object.keys(now).length };
}

/** What a waiting first-frame check changes against the live one: clips confirmed, pulled, back, unconfirmed. */
export function clipChanges(next: ClipCheck, live: ClipCheck | null): { changes: AutoReadChange[]; before: number; after: number } {
  const changes: AutoReadChange[] = [], ok = new Set(next.ok ?? []), wasOk = new Set(live?.ok ?? []);
  for (const l of ok) if (!wasOk.has(l)) changes.push({ label: l, what: live?.pulled?.[l] ? "restored" : "confirmed", from: live?.pulled?.[l]?.t ?? null, to: null });
  for (const [l, p] of Object.entries(next.pulled ?? {})) if (!live?.pulled?.[l]) changes.push({ label: l, what: "pulled", from: p.t, to: null, showed: p.showed });
  for (const [l, u] of Object.entries(next.unconfirmed ?? {})) if (!live?.unconfirmed?.[l]) changes.push({ label: l, what: "unconfirmed", from: u.t, to: null });
  for (const l of wasOk) if (!ok.has(l) && !next.pulled?.[l]) changes.push({ label: l, what: "dropped", from: null, to: null });
  for (const l of Object.keys(live?.pulled ?? {})) if (!next.pulled?.[l] && !ok.has(l)) changes.push({ label: l, what: "dropped", from: live!.pulled![l].t, to: null });
  const served = (c: ClipCheck | null) => c?.ok?.length ?? 0;
  return { changes, before: served(live), after: served(next) };
}

type PendingRow = { kind: string; video_id: string; code: string; season: number; pending_json: string; pending_problems: string | null; pending_at: string; source: string | null; live_json: string | null };

/** Everything waiting for the owner, newest first, and what the autopilot handed over last. */
export async function ownerAutoReads(limit = 200): Promise<OwnerAutoReads> {
  const rows = await all<PendingRow>(`SELECT kind, video_id, code, season, pending_json, pending_problems, pending_at, source, live_json FROM auto_reads
    WHERE pending_json IS NOT NULL ORDER BY pending_at DESC, season DESC, code, video_id LIMIT ?`, [limit]);
  const total = Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM auto_reads WHERE pending_json IS NOT NULL"))?.n ?? 0);
  const names = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.season}/${r.code}`;
    if (names.has(k)) continue;
    const e = await get<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [r.season, r.code]);
    names.set(k, e?.name ? String(e.name) : "");
  }
  const pending: PendingAutoRead[] = rows.flatMap((r) => {
    let next: FrameTiming | ClipCheck;
    try { next = JSON.parse(String(r.pending_json)); } catch { return []; }
    const kind = r.kind === "clips" ? "clips" : "frames", videoId = String(r.video_id), code = String(r.code);
    const live = kind === "frames" ? frameRow(videoId, code) : clipCheckRow(videoId, code);
    const d = kind === "frames" ? frameChanges(next as FrameTiming, live as FrameTiming | null) : clipChanges(next as ClipCheck, live as ClipCheck | null);
    let problems: string[] = [];
    try { problems = JSON.parse(String(r.pending_problems ?? "[]")); } catch { /* none recorded */ }
    const first = d.changes.find((c) => c.to != null || c.from != null);
    return [{
      kind, videoId, code, season: Number(r.season), eventName: names.get(`${r.season}/${code}`) || null,
      pendingAt: String(r.pending_at), source: r.source ? String(r.source) : null, problems,
      changes: d.changes, before: d.before, after: d.after,
      at: first ? Math.max(0, (first.to ?? first.from ?? 0) - 5) : null,
      checked: String((next as { checked?: string }).checked ?? ""),
      liveFrom: live ? (r.live_json ? "auto" : "code") : null,
    }];
  });
  const last = await get<{ at: string; details: string | null }>("SELECT at, details FROM owner_audit WHERE action = 'autoReads.delivery' ORDER BY id DESC LIMIT 1");
  let lastDelivery: OwnerAutoReads["lastDelivery"] = null;
  if (last) {
    try {
      const x = JSON.parse(String(last.details ?? "{}"));
      lastDelivery = { at: String(last.at), source: x.source ?? null, kind: x.kind === "clips" ? "clips" : "frames", live: (x.live ?? []).length, pending: (x.pending ?? []).length, dropped: (x.dropped ?? []).length };
    } catch { /* an entry cut short: no summary */ }
  }
  return { pending, total, lastDelivery, ...(await ownerReviews(Math.max(limit, 500))) };
}

/** What waits for the owner: auto reads held back, and the frames' review entries not yet decided. */
export const pendingAutoReadCount = async () => Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM auto_reads WHERE pending_json IS NOT NULL"))?.n ?? 0) + (await reviewEntries()).length;

// ---- The frames' review entries: matches the frames saw at a second, kept off the site ---------------------------------
// A frame row's `review` ({ t, why }) is a start the reader saw with one signal only, or found implausible (its opening
// shows the previous match, out of order, outside the video, played twice). Never a clip on its own. Listed for the
// owner from the frame rows themselves (code and database alike, so a video with no clock is never hidden), less
// those already served (a typed start, a frame start) and those rejected at that second. Approve writes the start into
// the event's live row in the database, owner-approved (served whatever the plausibility check says, kept through
// re-reads: carryApproved); Reject stops listing it.

type ReviewEntry = { videoId: string; code: string; label: string; t: number; why: string; row: FrameTiming };
/** Every undecided review entry, in season files' order. */
export async function reviewEntries(): Promise<ReviewEntry[]> {
  const rejected = new Map<string, number>();
  for (const d of await all<{ video_id: string; code: string; label: string; t: number }>("SELECT video_id, code, label, t FROM review_decisions WHERE decision = 'rejected'")) {
    rejected.set(`${d.video_id}|${d.code}|${d.label}`, Number(d.t));
  }
  const out: ReviewEntry[] = [];
  for (const row of FRAME_TIMINGS) {
    for (const [label, e] of Object.entries(row.review ?? {})) {
      if (!e || !Number.isFinite(e.t) || e.t < 0) continue;
      // Already served: a start typed by the owner, or one the frames placed.
      if (frameStart(row.videoId, row.code, label) != null) continue;
      const no = rejected.get(`${row.videoId}|${row.code}|${label}`);
      if (no != null && Math.abs(no - e.t) <= SAME_S) continue;
      out.push({ videoId: row.videoId, code: row.code, label, t: Math.round(e.t), why: String(e.why ?? ""), row });
    }
  }
  return out;
}

/** A season for a row the files don't place (a test's): the event's latest season of that code. */
async function seasonOf(videoId: string, code: string): Promise<number> {
  return frameRowSeason(videoId, code) ?? Number((await get<{ season: number }>("SELECT MAX(season) AS season FROM events WHERE code = ?", [code]))?.season ?? 0);
}

type ReviewBody = { videoId?: unknown; code?: unknown; label?: unknown; t?: unknown };
function reviewKey(b: ReviewBody): { videoId: string; code: string; label: string; t: number } | null {
  const videoId = typeof b.videoId === "string" && VIDEO_ID.test(b.videoId) ? b.videoId : null;
  const code = typeof b.code === "string" && CODE.test(b.code) ? b.code : null;
  const label = typeof b.label === "string" && /^[A-Za-z0-9-]{1,12}$/.test(b.label) ? b.label : null;
  const t = Number.isInteger(b.t) && (b.t as number) >= 0 ? (b.t as number) : null;
  return videoId && code && label && t != null ? { videoId, code, label, t } : null;
}
const reviewGone = { ok: false as const, status: 409, error: "This match changed or was decided since you opened it: look again." };

/** Approve a review entry: `t` becomes the match's clip start, written into the event's live row in the database (the
 *  code's row copied there first), with its opening CLIP_LEAD_S before it where the row checks openings, out of review
 *  and missing, owner-approved. Only the entry the owner saw (its second `t`). */
export async function approveReview(body: ReviewBody, actor: string, now = Date.now()): Promise<Out> {
  return ownerWrite(() => approveReviewLocked(body, actor, now));
}
async function approveReviewLocked(body: ReviewBody, actor: string, now = Date.now()): Promise<Out> {
  const k = reviewKey(body);
  if (!k) return { ok: false, status: 400, error: "Not a match waiting for approval." };
  if ((await liveSig()) !== loadedSig) await loadAutoReads();
  const row = frameRow(k.videoId, k.code), e = row?.review?.[k.label];
  if (!row || !e || Math.round(e.t) !== k.t || frameStart(k.videoId, k.code, k.label) != null) return reviewGone;
  const next: FrameTiming = { ...row, starts: { ...row.starts, [k.label]: k.t } };
  if (row.opens) next.opens = { ...row.opens, [k.label]: Math.max(0, k.t - CLIP_LEAD_S) };
  const review = { ...row.review }; delete review[k.label];
  if (Object.keys(review).length) next.review = review; else delete next.review;
  if (row.missing?.[k.label] != null) { const missing = { ...row.missing }; delete missing[k.label]; if (Object.keys(missing).length) next.missing = missing; else delete next.missing; }
  next.approved = [...new Set([...(row.approved ?? []), k.label])];
  next.approvedWhy = { ...(row.approvedWhy ?? {}), [k.label]: e.why };
  const season = await seasonOf(k.videoId, k.code), at = new Date(now).toISOString();
  await run(`INSERT INTO auto_reads (kind, video_id, code, season, live_json, live_at, decided_by, source) VALUES ('frames', ?, ?, ?, ?, ?, ?, 'owner')
    ON CONFLICT (kind, video_id, code) DO UPDATE SET live_json = excluded.live_json, live_at = excluded.live_at, decided_by = excluded.decided_by`,
  [k.videoId, k.code, season, JSON.stringify(next), at, actor]);
  await run(`INSERT INTO review_decisions (video_id, code, label, season, t, decision, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)
    ON CONFLICT (video_id, code, label) DO UPDATE SET t = excluded.t, decision = excluded.decision, decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
  [k.videoId, k.code, k.label, season, k.t, actor, at]);
  await recordAudit(actor, "autoReads.reviewApprove", { videoId: k.videoId, season, code: k.code, label: k.label, t: k.t, why: e.why });
  await loadAutoReads();
  clearAllCaches();
  return { ok: true };
}

/** Reject a review entry: no longer listed at that second (a re-read that sees it elsewhere lists it again). */
export async function rejectReview(body: ReviewBody, actor: string, now = Date.now()): Promise<Out> {
  return ownerWrite(() => rejectReviewLocked(body, actor, now));
}
async function rejectReviewLocked(body: ReviewBody, actor: string, now = Date.now()): Promise<Out> {
  const k = reviewKey(body);
  if (!k) return { ok: false, status: 400, error: "Not a match waiting for approval." };
  const e = frameRow(k.videoId, k.code)?.review?.[k.label];
  if (!e || Math.round(e.t) !== k.t) return reviewGone;
  const season = await seasonOf(k.videoId, k.code);
  await run(`INSERT INTO review_decisions (video_id, code, label, season, t, decision, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?)
    ON CONFLICT (video_id, code, label) DO UPDATE SET t = excluded.t, decision = excluded.decision, decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
  [k.videoId, k.code, k.label, season, k.t, actor, new Date(now).toISOString()]);
  await recordAudit(actor, "autoReads.reviewReject", { videoId: k.videoId, season, code: k.code, label: k.label, t: k.t, why: e.why });
  return { ok: true };
}

/** The review entries for the owner's list, newest season first, with each event's name. */
async function ownerReviews(limit: number): Promise<{ reviews: PendingReview[]; reviewTotal: number }> {
  const all_ = await reviewEntries();
  const withSeason = await Promise.all(all_.map(async (e) => ({ e, season: await seasonOf(e.videoId, e.code) })));
  withSeason.sort((a, b) => b.season - a.season || a.e.code.localeCompare(b.e.code) || a.e.t - b.e.t);
  const shown = withSeason.slice(0, limit), names = new Map<string, string>();
  for (const { e, season } of shown) {
    const k = `${season}/${e.code}`;
    if (!names.has(k)) names.set(k, String((await get<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [season, e.code]))?.name ?? ""));
  }
  return {
    reviewTotal: all_.length,
    reviews: shown.map(({ e, season }) => ({ videoId: e.videoId, season, code: e.code, eventName: names.get(`${season}/${e.code}`) || null, label: e.label, t: e.t, why: e.why, checked: e.row.checked })),
  };
}

/** An owner's Approve or Reject, under the data lock the inbox writes under: a delivery can't land between what the
 *  decision read and what it writes (a newer read overwritten, or an approval dropped). Busy past a few seconds (a sync
 *  holding the lock): try again. */
async function ownerWrite(fn: () => Promise<Out>): Promise<Out> {
  try {
    return await withDataLock("owner: auto reads", fn, { ttlMs: 60_000, waitMs: 15_000, pollMs: 250 });
  } catch (e) {
    if (e instanceof LockBusy) return { ok: false, status: 503, error: "The site's data is being written right now: try again in a minute." };
    throw e;
  }
}

type Decide = { kind?: unknown; videoId?: unknown; code?: unknown; pendingAt?: unknown };
type Out = { ok: true } | { ok: false; status: number; error: string };
function decideKey(b: Decide): { kind: AutoReadKind; videoId: string; code: string; pendingAt: string } | null {
  const kind = b.kind === "frames" || b.kind === "clips" ? b.kind : null;
  const videoId = typeof b.videoId === "string" && VIDEO_ID.test(b.videoId) ? b.videoId : null;
  const code = typeof b.code === "string" && CODE.test(b.code) ? b.code : null;
  const pendingAt = typeof b.pendingAt === "string" && b.pendingAt.length <= 40 ? b.pendingAt : null;
  return kind && videoId && code && pendingAt ? { kind, videoId, code, pendingAt } : null;
}

/** Approve: the waiting read goes live as it was read. Only the read the owner saw (`pendingAt`): a newer one that came
 *  in meanwhile is refused (look again). */
export async function approveAutoRead(body: Decide, actor: string, now = Date.now()): Promise<Out> {
  return ownerWrite(() => approveAutoReadLocked(body, actor, now));
}
async function approveAutoReadLocked(body: Decide, actor: string, now = Date.now()): Promise<Out> {
  const k = decideKey(body);
  if (!k) return { ok: false, status: 400, error: "Not a read waiting for approval." };
  const row = await get<{ season: number; pending_json: string; pending_problems: string | null }>("SELECT season, pending_json, pending_problems FROM auto_reads WHERE kind = ? AND video_id = ? AND code = ? AND pending_at = ? AND pending_json IS NOT NULL", [k.kind, k.videoId, k.code, k.pendingAt]);
  if (!row) return { ok: false, status: 409, error: "This read changed or was decided since you opened it: look again." };
  // A frame read keeps the starts the owner approved on the row live now (one approved after this read came in, too):
  // approving the read never takes a match the owner put on the site off it.
  if ((await liveSig()) !== loadedSig) await loadAutoReads();
  let json = String(row.pending_json);
  if (k.kind === "frames") {
    try { json = JSON.stringify(carryApproved(JSON.parse(json) as FrameTiming, frameRow(k.videoId, k.code))); } catch { /* not JSON: loadAutoReads never serves it */ }
  }
  const n = await run(`UPDATE auto_reads SET live_json = ?, live_at = ?, decided_by = ?, pending_json = NULL, pending_problems = NULL, pending_at = NULL
    WHERE kind = ? AND video_id = ? AND code = ? AND pending_at = ? AND pending_json IS NOT NULL`, [json, new Date(now).toISOString(), actor, k.kind, k.videoId, k.code, k.pendingAt]);
  if (!n) return { ok: false, status: 409, error: "This read changed or was decided since you opened it: look again." };
  await recordAudit(actor, "autoReads.approve", { kind: k.kind, videoId: k.videoId, season: Number(row.season), code: k.code, problems: JSON.parse(String(row.pending_problems ?? "[]")) });
  await loadAutoReads();
  clearAllCaches();
  return { ok: true };
}

/** Reject: the waiting read is dropped; what's live stays; the event can be read again. */
export async function rejectAutoRead(body: Decide, actor: string): Promise<Out> {
  return ownerWrite(() => rejectAutoReadLocked(body, actor));
}
async function rejectAutoReadLocked(body: Decide, actor: string): Promise<Out> {
  const k = decideKey(body);
  if (!k) return { ok: false, status: 400, error: "Not a read waiting for approval." };
  const row = await get<{ season: number }>("SELECT season FROM auto_reads WHERE kind = ? AND video_id = ? AND code = ? AND pending_at = ? AND pending_json IS NOT NULL", [k.kind, k.videoId, k.code, k.pendingAt]);
  if (!row) return { ok: false, status: 409, error: "This read changed or was decided since you opened it: look again." };
  const n = await run("UPDATE auto_reads SET pending_json = NULL, pending_problems = NULL, pending_at = NULL WHERE kind = ? AND video_id = ? AND code = ? AND pending_at = ?", [k.kind, k.videoId, k.code, k.pendingAt]);
  if (!n) return { ok: false, status: 409, error: "This read changed or was decided since you opened it: look again." };
  // Nothing live from the database either: the row has nothing left to keep.
  await run("DELETE FROM auto_reads WHERE kind = ? AND video_id = ? AND code = ? AND live_json IS NULL AND pending_json IS NULL", [k.kind, k.videoId, k.code]);
  await recordAudit(actor, "autoReads.reject", { kind: k.kind, videoId: k.videoId, season: Number(row.season), code: k.code });
  return { ok: true };
}
