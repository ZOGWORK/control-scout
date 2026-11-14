// The check after a recording is added or its facts refreshed (the clips brief, Step 4): does every played match of
// that event now have a clip, or is there a missing list? Runs after each recordings pass (every 5 minutes: the
// checked list, short links, channel broadcasts, YouTube's facts) and after each official-channel watcher run, so a
// recording added by any of them, or by the owner, is checked within minutes. Each event's recording (its videos and
// their facts) and played matches make a fingerprint; only an event whose fingerprint moved is checked again (and every
// event once per process: a deploy can change how clips are placed). The result is kept in clip_coverage; an event
// with a played match and no clip stays open in Owner > Clip coverage until the owner marks it reviewed, and opens
// again when its missing list changes. Nothing is dropped: a gap is a row, never a log line only.
import { all, get, run, writeBatch } from "../db.js";
import { withDataLock, LockBusy } from "../data/lock.js";
import { recordAudit } from "../portal/audit.js";
import { checkedTo } from "../data/checkedTimings.js";
import { seasonRecordings, type Recording } from "./recordings.js";
import { clipCoverage, eventMatchRows } from "./coverage.js";
import type { ClipCoverage, OwnerClipCoverage, OwnerCoverageEvent } from "../../src/shared/api.js";

/** Once per process: every event is checked again after a deploy. */
const BOOT = new Date().toISOString();

/** What an event's coverage depends on: its videos and their YouTube facts, and its played matches. */
function fingerprint(r: Recording | null, played: { n: number; last: string | null; videos: number } | undefined): string {
  const videos = r ? [r, ...(r.more ?? [])].map((v) => [v.videoId, v.day ?? null, v.part ?? null, v.meta?.status ?? null, v.meta?.start ?? null, v.meta?.end ?? null, v.meta?.length ?? null, v.meta?.live ?? null, v.meta?.chapters?.length ?? null, checkedTo(v.videoId)]) : [];
  return JSON.stringify([BOOT, videos, played?.n ?? 0, played?.last ?? null, played?.videos ?? 0]);
}

/** The missing matches and their reasons, in order: the same list, however often checked, is the same key. */
const missingKey = (c: ClipCoverage) => c.matches.filter((m) => !m.clip).map((m) => `${m.label}:${m.reason}:${m.videoId ?? ""}`).join(",");

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
      const played = new Map<string, { n: number; last: string | null; videos: number }>();
      for (let i = 0; i < codes.length; i += 200) {
        const part = codes.slice(i, i + 200);
        for (const r of await all<{ code: string; n: number; last: string | null; v: number }>(
          `SELECT code, COUNT(*) AS n, MAX(time) AS last, SUM(CASE WHEN video IS NOT NULL AND video != '' THEN 1 ELSE 0 END) AS v FROM matches
           WHERE season = ? AND played = 1 AND code IN (${part.map(() => "?").join(",")}) GROUP BY code`, [season, ...part])) played.set(String(r.code), { n: Number(r.n), last: r.last, videos: Number(r.v) });
      }
      const todo = codes.map((code) => ({ code, fp: fingerprint(full.get(code) ?? null, played.get(code)) })).filter((x) => was.get(x.code)?.fingerprint !== x.fp);
      if (!todo.length) continue;
      const [recs, rows, zones] = await Promise.all([
        seasonRecordings(season), eventMatchRows(season, todo.map((t) => t.code)),
        all<{ code: string; timezone: string | null }>(`SELECT code, timezone FROM events WHERE season = ? AND code IN (${todo.map(() => "?").join(",")})`, [season, ...todo.map((t) => t.code)]),
      ]);
      const tz = new Map(zones.map((z) => [String(z.code), z.timezone]));
      const writes: { sql: string; args: (string | number | null)[] }[] = [];
      for (const { code, fp } of todo) {
        const c = clipCoverage(rows.get(code) ?? [], recs.get(code) ?? null, full.get(code) ?? null, tz.get(code), now);
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

/** Every event with a played match missing a clip: open ones first (newest check first), then the reviewed. */
export async function ownerClipCoverage(): Promise<OwnerClipCoverage> {
  const [rows, t] = await Promise.all([
    all<any>(`SELECT c.season, c.code, e.name, c.state, c.played, c.with_clip, c.checked_at, c.reviewed_at, c.reviewed_by, c.detail
              FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
              WHERE c.with_clip < c.played ORDER BY c.reviewed_at IS NOT NULL, c.season DESC, c.checked_at DESC LIMIT 1000`),
    get<any>(`SELECT COUNT(*) AS events, COALESCE(SUM(played), 0) AS played, COALESCE(SUM(with_clip), 0) AS with_clip,
              SUM(CASE WHEN played > 0 AND with_clip >= played THEN 1 ELSE 0 END) AS full FROM clip_coverage WHERE state != 'none'`),
  ]);
  const list = rows.map((r): OwnerCoverageEvent => {
    const d = JSON.parse(String(r.detail));
    return {
      season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), state: r.state, played: Number(r.played), withClip: Number(r.with_clip),
      checkedAt: String(r.checked_at), reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null,
      videos: d.videos ?? [], daysMissing: d.daysMissing ?? [], missing: d.missing ?? [],
    };
  });
  return {
    open: list.filter((x) => !x.reviewedAt), reviewed: list.filter((x) => x.reviewedAt),
    totals: { events: Number(t?.events ?? 0), played: Number(t?.played ?? 0), withClip: Number(t?.with_clip ?? 0), full: Number(t?.full ?? 0) },
  };
}

/** How many events wait for the owner's review. */
export async function openCoverageCount(): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM clip_coverage WHERE with_clip < played AND reviewed_at IS NULL"))?.n ?? 0);
}

/** The owner has seen an event's missing list: it stays listed, under Reviewed, until that list changes. */
export async function markCoverageReviewed(season: number, code: string, actor: string, now = Date.now()): Promise<boolean> {
  const n = await run("UPDATE clip_coverage SET reviewed_at = ?, reviewed_by = ? WHERE season = ? AND code = ? AND reviewed_at IS NULL", [new Date(now).toISOString(), actor, season, code]);
  if (n) await recordAudit(actor, "clipCoverage.reviewed", { season, code });
  return n > 0;
}
