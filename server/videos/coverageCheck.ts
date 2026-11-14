// The check after a recording is added or its facts refreshed (the clips brief, Step 4): does every played match of
// that event now have a clip, or is there a missing list? Runs after each recordings pass (every 5 minutes: the
// checked list, short links, channel broadcasts, YouTube's facts) and after each official-channel watcher run, so a
// recording added by any of them, or by the owner, is checked within minutes. Each event's recording (its videos and
// their facts) and played matches make a fingerprint; only an event whose fingerprint moved is checked again (and every
// event once per process: a deploy can change how clips are placed). The result is kept in clip_coverage; an event
// with a played match and no clip stays open in Owner > Clip coverage until the owner marks it reviewed, and opens
// again when its missing list changes. Nothing is dropped: a gap is a row, never a log line only.
import { createHash } from "node:crypto";
import { all, get, run, writeBatch } from "../db.js";
import { withDataLock, LockBusy } from "../data/lock.js";
import { recordAudit } from "../portal/audit.js";
import { checkedTo } from "../data/checkedTimings.js";
import { seasonRecordings, type Recording } from "./recordings.js";
import { clipCoverage, eventMatchRows } from "./coverage.js";
import type { ClipCoverage, OwnerClipCoverage, OwnerCoverageEvent } from "../../src/shared/api.js";

/** Once per process: every event is checked again after a deploy. */
const BOOT = new Date().toISOString();

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** What an event's coverage depends on: its videos and their YouTube facts (chapters whole), the event's time zone, and
 *  each of its matches (played, its time, FIRST's video): any of them moving checks the event again. */
function fingerprint(r: Recording | null, timezone: string | null, matches: string): string {
  const videos = r ? [r, ...(r.more ?? [])].map((v) => [v.videoId, v.day ?? null, v.part ?? null, v.meta?.status ?? null, v.meta?.start ?? null, v.meta?.end ?? null, v.meta?.length ?? null, v.meta?.live ?? null, v.meta?.chapters ?? null, checkedTo(v.videoId)]) : [];
  return sha1(JSON.stringify([BOOT, videos, timezone, matches]));
}

/** The missing matches and their reasons, as a hash: the same list, however often checked, is the same key. It's also the
 *  list's version the owner panel sends back with Reviewed (markCoverageReviewed). Empty: nothing missing. */
const missingKey = (c: ClipCoverage) => {
  const list = c.matches.filter((m) => !m.clip).map((m) => `${m.label}:${m.reason}:${m.videoId ?? ""}`).join(",");
  return list ? sha1(list) : "";
};

let busy = false;
/** Check every event whose recording or played matches changed since its last check. Returns how many were checked. */
export async function checkClipCoverage(log: (s: string) => void, now = Date.now()): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
    let checked = 0, opened = 0;
    for (const season of seasons) {
      const [full, firstVideo, known] = await Promise.all([
        seasonRecordings(season, true),
        all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND video IS NOT NULL AND video != ''", [season]),
        all<{ code: string; fingerprint: string; missing_key: string; reviewed_at: string | null }>("SELECT code, fingerprint, missing_key, reviewed_at FROM clip_coverage WHERE season = ?", [season]),
      ]);
      const was = new Map(known.map((k) => [String(k.code), k]));
      const codes = [...new Set([...full.keys(), ...firstVideo.map((r) => String(r.code)), ...was.keys()])];
      if (!codes.length) continue;
      // Each event's matches as one string (played, key, time, FIRST's video), and its time zone.
      const shape = new Map<string, { tz: string | null; matches: string }>();
      for (let i = 0; i < codes.length; i += 200) {
        const part = codes.slice(i, i + 200), q = part.map(() => "?").join(",");
        for (const e of await all<{ code: string; timezone: string | null }>(`SELECT code, timezone FROM events WHERE season = ? AND code IN (${q})`, [season, ...part])) shape.set(String(e.code), { tz: e.timezone, matches: "" });
        for (const r of await all<{ code: string; m: string }>(
          `SELECT code, group_concat(played || level || series || ':' || number || '@' || COALESCE(time, '') || '#' || COALESCE(video, ''), ',') AS m
           FROM (SELECT code, played, level, series, number, time, video FROM matches WHERE season = ? AND code IN (${q}) ORDER BY code, level, series, number) GROUP BY code`, [season, ...part])) {
          const e = shape.get(String(r.code));
          if (e) e.matches = String(r.m ?? "");
        }
      }
      const todo = codes.map((code) => ({ code, fp: fingerprint(full.get(code) ?? null, shape.get(code)?.tz ?? null, shape.get(code)?.matches ?? "") })).filter((x) => was.get(x.code)?.fingerprint !== x.fp);
      if (!todo.length) continue;
      const [recs, rows] = await Promise.all([seasonRecordings(season), eventMatchRows(season, todo.map((t) => t.code))]);
      const writes: { sql: string; args: (string | number | null)[] }[] = [];
      for (const { code, fp } of todo) {
        const c = clipCoverage(rows.get(code) ?? [], recs.get(code) ?? null, full.get(code) ?? null, shape.get(code)?.tz, now);
        const key = missingKey(c), prev = was.get(code);
        // Reviewed stays reviewed while the same matches are missing for the same reasons; a new list opens it again.
        if (key && prev?.missing_key !== key) opened++;
        const detail = { videos: c.videos, daysMissing: c.daysMissing, missing: c.matches.filter((m) => !m.clip) };
        writes.push({
          sql: `INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, reviewed_at, reviewed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT(season, code) DO UPDATE SET fingerprint = excluded.fingerprint, checked_at = excluded.checked_at, state = excluded.state,
                  played = excluded.played, with_clip = excluded.with_clip, detail = excluded.detail,
                  reviewed_at = CASE WHEN clip_coverage.missing_key = excluded.missing_key THEN clip_coverage.reviewed_at END,
                  reviewed_by = CASE WHEN clip_coverage.missing_key = excluded.missing_key THEN clip_coverage.reviewed_by END,
                  missing_key = excluded.missing_key`,
          args: [season, code, fp, new Date(now).toISOString(), c.state, c.played, c.withClip, key, JSON.stringify(detail)],
        });
      }
      await withDataLock("clip coverage", () => writeBatch(writes, 200), { ttlMs: 60_000, waitMs: 60_000, pollMs: 1000 });
      checked += todo.length;
    }
    if (checked) log(`clip coverage: checked ${checked} event${checked === 1 ? "" : "s"}${opened ? `, ${opened} with matches missing a clip for owner review` : ""}`);
    return checked;
  } catch (e) {
    // The sync holding the writer lease: the next pass checks them (their fingerprints weren't written).
    if (e instanceof LockBusy) return 0;
    throw e;
  } finally { busy = false; }
}

/** Events with a played match missing a clip, a page at a time: open ones (newest check first) or the reviewed. */
export async function ownerClipCoverage(o: { reviewed?: boolean; offset?: number; limit?: number } = {}): Promise<OwnerClipCoverage> {
  const limit = Math.min(Math.max(o.limit ?? PAGE, 1), 200), offset = Math.max(Math.floor(o.offset ?? 0), 0);
  const where = `c.with_clip < c.played AND c.state != 'none' AND c.reviewed_at IS ${o.reviewed ? "NOT NULL" : "NULL"}`;
  const [rows, t, n] = await Promise.all([
    all<any>(`SELECT c.season, c.code, e.name, c.state, c.played, c.with_clip, c.checked_at, c.reviewed_at, c.reviewed_by, c.missing_key, c.detail
              FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
              WHERE ${where} ORDER BY c.season DESC, ${o.reviewed ? "c.reviewed_at" : "c.checked_at"} DESC, c.code LIMIT ? OFFSET ?`, [limit, offset]),
    get<any>(`SELECT COUNT(*) AS events, COALESCE(SUM(played), 0) AS played, COALESCE(SUM(with_clip), 0) AS with_clip,
              SUM(CASE WHEN played > 0 AND with_clip >= played THEN 1 ELSE 0 END) AS full FROM clip_coverage WHERE state != 'none'`),
    get<any>(`SELECT SUM(CASE WHEN reviewed_at IS NULL THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN reviewed_at IS NOT NULL THEN 1 ELSE 0 END) AS reviewed
              FROM clip_coverage WHERE with_clip < played AND state != 'none'`),
  ]);
  const events = rows.map((r): OwnerCoverageEvent => {
    const d = JSON.parse(String(r.detail));
    return {
      season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), state: r.state, played: Number(r.played), withClip: Number(r.with_clip),
      checkedAt: String(r.checked_at), reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null, version: String(r.missing_key),
      videos: d.videos ?? [], daysMissing: d.daysMissing ?? [], missing: d.missing ?? [],
    };
  });
  return {
    events, offset, open: Number(n?.open ?? 0), reviewed: Number(n?.reviewed ?? 0),
    totals: { events: Number(t?.events ?? 0), played: Number(t?.played ?? 0), withClip: Number(t?.with_clip ?? 0), full: Number(t?.full ?? 0) },
  };
}
const PAGE = 50;

/** How many events wait for the owner's review. */
export async function openCoverageCount(): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM clip_coverage WHERE with_clip < played AND state != 'none' AND reviewed_at IS NULL"))?.n ?? 0);
}

/** The owner has seen an event's missing list (`version`: the one shown, missingKey): it moves to Reviewed until that list
 *  changes. A list that changed since it was shown isn't marked: "changed", to show the new one. */
export async function markCoverageReviewed(season: number, code: string, version: string, actor: string, now = Date.now()): Promise<"ok" | "changed" | "none"> {
  const row = await get<{ code: string }>("SELECT code FROM clip_coverage WHERE season = ? AND code = ? COLLATE NOCASE AND reviewed_at IS NULL AND with_clip < played AND state != 'none'", [season, code]);
  if (!row) return "none";
  const n = await run("UPDATE clip_coverage SET reviewed_at = ?, reviewed_by = ? WHERE season = ? AND code = ? AND reviewed_at IS NULL AND missing_key = ?", [new Date(now).toISOString(), actor, season, row.code, version]);
  if (!n) return "changed";
  await recordAudit(actor, "clipCoverage.reviewed", { season, code: row.code });
  return "ok";
}
