// The check after a recording is added or its facts refreshed (the clips brief, Step 4): does every played match of
// that event now have a clip, or is there a missing list? Runs after each recordings pass (every 5 minutes: the
// checked list, short links, channel broadcasts, YouTube's facts) and after each official-channel watcher run, so a
// recording added by any of them, or by the owner, is checked within minutes. Each event's recording (its videos and
// their facts) and played matches make a fingerprint; only an event whose fingerprint moved is checked again (and every
// event once per process: a deploy can change how clips are placed). The result is kept in clip_coverage, each event
// with a played match and no clip triaged (server/videos/coverageTriage.ts): only actionable ones are the owner's "To
// review" in Owner > Clip coverage; the rest stay listed under their category and reason. A reviewed event opens again
// only when its missing list changes AND the new list is actionable: a fingerprint change alone (a deploy, refreshed
// facts) never opens one. Nothing is dropped: a gap is a row, never a log line only.
import { createHash } from "node:crypto";
import { all, get, inSnapshot, kvGet, kvSet, run, writeBatch } from "../db.js";
import { withDataLock, LockBusy } from "../data/lock.js";
import { recordAudit } from "../portal/audit.js";
import { checkedTo } from "../data/checkedTimings.js";
import { clipCheckFindings, clipCheckTotals } from "../data/clipChecks.js";
import { seasonRecordings, type Recording, isPartial } from "./recordings.js";
import { clipCoverage, eventMatchRows, UNPLAYABLE } from "./coverage.js";
import { baseTriage, seasonTriage, type BaseTriage } from "./coverageTriage.js";
import { currentSeason } from "../api/answers/season.js";
import { frameQueue, queueSummary, type FrameStatus, type Read } from "./frameQueue.js";
import type { ClipCoverage, CoverageFrames, CoverageMatch, CoverageFinding, CoveragePass, CoverageTriage, OwnerClipCoverage, OwnerCoverageEvent } from "../../src/shared/api.js";

/** Once per process: every event is checked again after a deploy. */
const BOOT = new Date().toISOString();

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** What an event's coverage depends on: its videos and their YouTube facts (chapters whole, whether it may be embedded,
 *  since when it can't be played), whether it's broadcast a day
 *  at a time (which matches each video holds), which of its videos the page plays, the event's time zone, and each of its
 *  matches (played, its time, FIRST's video): any of them moving checks the event again. */
function fingerprint(r: Recording | null, playable: Recording | null, timezone: string | null, matches: string): string {
  const videos = r ? [r, ...(r.more ?? [])].map((v) => [v.videoId, v.day ?? null, v.part ?? null, v.meta?.status ?? null, v.meta?.start ?? null, v.meta?.end ?? null, v.meta?.length ?? null, v.meta?.live ?? null, v.meta?.chapters ?? null, checkedTo(v.videoId), v.meta?.embeddable ?? null, v.meta?.unplayableSince ?? null]) : [];
  const plays = playable ? [playable, ...(playable.more ?? [])].map((v) => v.videoId) : [];
  return sha1(JSON.stringify([BOOT, videos, r?.daily ?? false, playable?.daily ?? false, plays, timezone, matches]));
}

/** The missing matches and their reasons, as a hash: the same list, however often checked, is the same key. It's also the
 *  list's version the owner panel sends back with Reviewed (markCoverageReviewed). Empty: nothing missing. */
const missingKey = (c: ClipCoverage) => {
  const list = c.matches.filter((m) => !m.clip).map((m) => `${m.label}:${m.reason}:${m.videoId ?? ""}`).join(",");
  return list ? sha1(list) : "";
};

/** How a missing match stands with its video (the pass log's breakdown): what the video's frames showed, or its reason. */
export function videoState(m: CoverageMatch): string {
  const v = m.video;
  if (!v) return m.reason ?? "unexplained";
  if (v.earlyStart) return "starts inside the match before, in the video";
  if (!v.checked) return "not yet checked against the video";
  return v.seenAt != null ? "seen in the video, no clip (a finding)" : "checked in the video, no start found";
}

/** The last check pass, as the owner console shows it (kv). */
const LAST_PASS = "clip-coverage:last-pass";

/** Every stored event's missing matches with a video that its frames haven't been read for yet ("not yet checked against
 *  the video", videoState), all seasons: the pending work, counted after each pass so the console shows it shrinking. */
async function pendingMatches(): Promise<number | undefined> {
  try {
    // An unreadable detail (readDetail tolerates them) is skipped, never a reason to lose the pass's record.
    const r = await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT detail FROM clip_coverage WHERE json_valid(detail)) c, json_each(c.detail, '$.missing') j
       WHERE json_type(j.value, '$.video') = 'object' AND json_extract(j.value, '$.video.checked') IS NULL AND json_extract(j.value, '$.video.earlyStart') IS NULL`);
    return Number(r?.n ?? 0);
  } catch {
    return undefined;
  }
}

let busy = false;
/** Check every event whose recording or played matches changed since its last check. Returns how many were checked. */
export async function checkClipCoverage(log: (s: string) => void, now = Date.now()): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
    let checked = 0, opened = 0;
    // The pass in numbers (zero-error brief, journey 7): every event checked, and why each missing match is missing.
    // A match whose recording can't be played (coverage.ts UNPLAYABLE) is settled: counted apart, never as missing.
    const pass = { events: 0, full: 0, clipped: 0, missing: 0, unplayable: 0, why: {} as Record<string, number> };
    for (const season of seasons) {
      const [full, recs, firstVideo, known] = await Promise.all([
        seasonRecordings(season, true),
        seasonRecordings(season),
        all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND video IS NOT NULL AND video != ''", [season]),
        all<{ code: string; fingerprint: string; missing_key: string; reviewed_at: string | null; triage: string | null }>("SELECT code, fingerprint, missing_key, reviewed_at, triage FROM clip_coverage WHERE season = ?", [season]),
      ]);
      // A read that failed part way (recordings.ts soft): checking on it would mark recorded events stats only and drop
      // them from review; the next pass checks them.
      if (isPartial(full) || isPartial(recs)) { log(`clip coverage: ${season} skipped, recordings read only in part`); continue; }
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
      const todo = codes.map((code) => ({ code, fp: fingerprint(full.get(code) ?? null, recs.get(code) ?? null, shape.get(code)?.tz ?? null, shape.get(code)?.matches ?? "") })).filter((x) => was.get(x.code)?.fingerprint !== x.fp);
      if (!todo.length) continue;
      const rows = await eventMatchRows(season, todo.map((t) => t.code));
      const writes: { sql: string; args: (string | number | null)[] }[] = [];
      for (const { code, fp } of todo) {
        const c = clipCoverage(rows.get(code) ?? [], recs.get(code) ?? null, full.get(code) ?? null, shape.get(code)?.tz, now);
        const key = missingKey(c), prev = was.get(code);
        const missing = c.matches.filter((m) => !m.clip);
        const t = key ? baseTriage(missing) : null;
        if (c.state !== "none") {
          const dead = missing.filter((m) => UNPLAYABLE.has(m.reason ?? "unexplained")).length;
          pass.events++; pass.clipped += c.withClip; pass.missing += missing.length - dead; pass.unplayable += dead;
          if (c.played > 0 && c.withClip >= c.played) pass.full++;
          for (const m of missing) if (!UNPLAYABLE.has(m.reason ?? "unexplained")) { const k = videoState(m); pass.why[k] = (pass.why[k] ?? 0) + 1; }
        }
        // Reviewed stays reviewed while the same matches are missing for the same reasons, and when a new list isn't
        // actionable; only a new actionable list opens it again (and only an actionable one asks the owner at all).
        // A list that was a pending check ("unchecked") and now has its video checked is new to the owner even with the
        // same missing key: a review given to its clock-only list doesn't carry over, whatever it becomes (the upsert
        // clears any review on a list that was a pending check).
        if (t?.triage === "actionable" && (prev?.missing_key !== key || prev?.triage === "unchecked")) opened++;
        const detail = { videos: c.videos, daysMissing: c.daysMissing, missing };
        writes.push({
          sql: `INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, triage, triage_why, reviewed_at, reviewed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT(season, code) DO UPDATE SET fingerprint = excluded.fingerprint, checked_at = excluded.checked_at, state = excluded.state,
                  played = excluded.played, with_clip = excluded.with_clip, detail = excluded.detail, triage = excluded.triage, triage_why = excluded.triage_why,
                  reviewed_at = CASE WHEN COALESCE(clip_coverage.triage, '') != 'unchecked' AND (clip_coverage.missing_key = excluded.missing_key OR COALESCE(excluded.triage, '') != 'actionable') THEN clip_coverage.reviewed_at END,
                  reviewed_by = CASE WHEN COALESCE(clip_coverage.triage, '') != 'unchecked' AND (clip_coverage.missing_key = excluded.missing_key OR COALESCE(excluded.triage, '') != 'actionable') THEN clip_coverage.reviewed_by END,
                  missing_key = excluded.missing_key`,
          args: [season, code, fp, new Date(now).toISOString(), c.state, c.played, c.withClip, key, JSON.stringify(detail), t?.triage ?? null, t?.why ?? null],
        });
      }
      await withDataLock("clip coverage", () => writeBatch(writes, 200), { ttlMs: 60_000, waitMs: 60_000, pollMs: 1000 });
      checked += todo.length;
    }
    if (checked) {
      const why = Object.entries(pass.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
      const [pending, before] = await Promise.all([pendingMatches(), kvGet<CoveragePass>(LAST_PASS).catch(() => null)]);
      const pendingBefore = before?.pending ?? null;
      log(`clip coverage: checked ${checked} event${checked === 1 ? "" : "s"} (${pass.events} recorded) · ${pass.full} fully clipped · ${pass.clipped} matches clipped · ${pass.missing} missing${why ? ` (${why})` : ""}${pass.unplayable ? ` · ${pass.unplayable} whose recording can't be played` : ""}${opened ? ` · ${opened} actionable for owner review` : ""}${pending != null ? ` · ${pending} matches not yet checked against the video${pendingBefore != null ? ` (was ${pendingBefore})` : ""}` : ""}`);
      const last: CoveragePass = { at: new Date(now).toISOString(), checked, ...pass, opened, pending, pendingBefore };
      await kvSet(LAST_PASS, last).catch(() => {});
    }
    return checked;
  } catch (e) {
    // The sync holding the writer lease: the next pass checks them (their fingerprints weren't written).
    if (e instanceof LockBusy) return 0;
    throw e;
  } finally { busy = false; }
}

/** Rows checked before triage existed (migration 89), triaged at boot from the missing list they already hold (each
 *  match's reason), so the minutes before the first check pass don't show every event as To review. Reviewed stays
 *  reviewed; the next check rewrites each row anyway. Returns how many were triaged. */
export async function triageUntriaged(log: (s: string) => void): Promise<number> {
  const rows = await all<{ season: number; code: string; detail: string }>("SELECT season, code, detail FROM clip_coverage WHERE triage IS NULL AND with_clip < played AND state != 'none'");
  if (!rows.length) return 0;
  const writes = rows.map((r) => {
    // A detail that can't be read gives no list: actionable, so one bad row neither stops the rest nor hides itself.
    const t = baseTriage(readDetail(r.detail).missing ?? []);
    return { sql: "UPDATE clip_coverage SET triage = ?, triage_why = ? WHERE season = ? AND code = ? AND triage IS NULL", args: [t.triage, t.why, r.season, r.code] };
  });
  try {
    await withDataLock("clip coverage triage", () => writeBatch(writes, 200), { ttlMs: 60_000, waitMs: 60_000, pollMs: 1000 });
  } catch (e) {
    // The sync holding the writer lease: the first check pass triages them instead.
    if (e instanceof LockBusy) return 0;
    throw e;
  }
  log(`clip coverage: triaged ${rows.length} event${rows.length === 1 ? "" : "s"} from their stored missing lists`);
  return rows.length;
}

/** A stored missing list, or none when it can't be read. */
function readDetail(detail: unknown): { videos?: OwnerCoverageEvent["videos"]; daysMissing?: OwnerCoverageEvent["daysMissing"]; missing?: OwnerCoverageEvent["missing"] } {
  try { return JSON.parse(String(detail)) ?? {}; } catch { return {}; }
}

export const TRIAGES: readonly CoverageTriage[] = ["actionable", "unchecked", "no-timing", "early-start", "unplayable", "old-season"];
/** An event missing a clip (in the owner's lists at all), and one not reviewed yet. */
const MISSING = "c.with_clip < c.played AND c.state != 'none'";
/** An event's category now: the stored one (from its reasons; NULL, a row not triaged yet, reads as actionable), made
 *  old-season when it isn't actionable and is older than last season, from the current season at read time, so the
 *  September rollover moves it without a recheck (seasonTriage, in SQL). */
const triageSql = (current = currentSeason()) => {
  const last = Math.trunc(current) - 1;
  return `(CASE WHEN COALESCE(c.triage, 'actionable') IN ('actionable', 'unchecked', 'unplayable') THEN COALESCE(c.triage, 'actionable') WHEN c.season < ${last} THEN 'old-season' ELSE c.triage END)`;
};
/** A pending video check is never reviewed: it's counted and listed as one whatever reviewed_at holds, and no Reviewed
 *  (one or bulk) marks it. */
const REVIEWED = (T: string) => `(c.reviewed_at IS NOT NULL AND ${T} != 'unchecked')`;

/** The owner console's findings, whatever an event's category or review: every missing match the video's frames saw (a
 *  read put it at a second in the video) that has no clip, and every clock-placed clip pulled because its first frame
 *  showed another match (server/data/clipChecks.ts). */
export async function coverageFindings(): Promise<CoverageFinding[]> {
  const rows = await all<{ season: number; code: string; name: string | null; detail: string }>(
    `SELECT c.season, c.code, e.name, c.detail FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE ${MISSING} AND c.detail LIKE '%"seenAt"%' ORDER BY c.season DESC, c.code`);
  const out: CoverageFinding[] = [];
  for (const r of rows) {
    for (const m of readDetail(r.detail).missing ?? []) {
      if (m.video?.seenAt == null || !m.videoId) continue;
      out.push({ kind: "seen", season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), label: m.label, videoId: m.videoId, at: m.video.seenAt, why: m.why ?? "" });
    }
  }
  const pulled = clipCheckFindings();
  if (pulled.length) {
    const names = new Map((await all<{ season: number; code: string; name: string }>(
      `SELECT season, code, name FROM events WHERE (season, code) IN (${pulled.map(() => "(?, ?)").join(", ")})`, pulled.flatMap((p) => [p.season, p.code])))
      .map((e) => [`${e.season}/${e.code}`, String(e.name)]));
    for (const p of pulled) {
      out.push({ kind: "pulled", season: p.season, code: p.code, name: names.get(`${p.season}/${p.code}`) ?? p.code, label: p.label, videoId: p.videoId, at: p.t,
        why: `Clip pulled: its first frame shows ${p.showed}, not ${p.label}` });
    }
  }
  return out;
}

/** Events with a played match missing a clip, a page at a time: one category's events not reviewed yet (actionable by
 *  default, the "To review"), or the reviewed, newest season first, then by code. That order doesn't move when the
 *  5-minute check rewrites a row, so paging never shows one twice or skips one. */
export async function ownerClipCoverage(o: { list?: CoverageTriage | "reviewed"; after?: { season: number; code: string } | null; limit?: number } = {}): Promise<OwnerClipCoverage> {
  const limit = Math.min(Math.max(o.limit ?? PAGE, 1), 200), list = o.list ?? "actionable";
  const current = currentSeason(), TRIAGE = triageSql(current);
  // The next page starts after the last event shown (season, then code), not at a count: rows leaving or joining the
  // list meanwhile (clips placed, a review elsewhere) can't make it skip one.
  const after = o.after ? " AND (c.season < ? OR (c.season = ? AND c.code > ?))" : "";
  const where = `${MISSING} AND ${list === "reviewed" ? REVIEWED(TRIAGE) : list === "unchecked" ? `${TRIAGE} = ?` : `c.reviewed_at IS NULL AND ${TRIAGE} = ?`}${after}`;
  const args = [...(list === "reviewed" ? [] : [list]), ...(o.after ? [o.after.season, o.after.season, o.after.code] : [])];
  // The page's rows and the queue read at one moment: a coverage check rewriting a row between two reads would pair an
  // event's missing list with another moment's frame status.
  const pageAndQueue = async (read: Read) => [await read<any>(`SELECT c.season, c.code, e.name, c.state, c.played, c.with_clip, c.checked_at, c.reviewed_at, c.reviewed_by, c.missing_key, c.detail, c.triage, c.triage_why
              FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
              WHERE ${where} ORDER BY c.season DESC, c.code LIMIT ?`, [...args, limit]), await frameQueue(Date.now(), read)] as const;
  const [[rows, queue], t, cats, seasons, findings, lastPass] = await Promise.all([
    inSnapshot((read) => pageAndQueue(read as Read)).then((x) => x ?? pageAndQueue(all)),
    get<any>(`SELECT COUNT(*) AS events, COALESCE(SUM(played), 0) AS played, COALESCE(SUM(with_clip), 0) AS with_clip,
              SUM(CASE WHEN played > 0 AND with_clip >= played THEN 1 ELSE 0 END) AS full FROM clip_coverage WHERE state != 'none'`),
    all<{ t: string; reviewed: number; n: number }>(`SELECT ${TRIAGE} AS t, ${REVIEWED(TRIAGE)} AS reviewed, COUNT(*) AS n FROM clip_coverage c WHERE ${MISSING} GROUP BY 1, 2`),
    all<{ season: number; n: number; a: number }>(`SELECT c.season, COUNT(*) AS n, SUM(CASE WHEN ${TRIAGE} = 'actionable' THEN 1 ELSE 0 END) AS a
              FROM clip_coverage c WHERE ${MISSING} AND c.reviewed_at IS NULL AND ${TRIAGE} != 'unchecked' GROUP BY c.season ORDER BY c.season DESC`),
    coverageFindings(),
    kvGet<CoveragePass>(LAST_PASS).catch(() => null),
  ]);
  const frames = new Map(queue.map((q) => [`${q.season}/${q.code}`, q.frames]));
  const categories = Object.fromEntries(TRIAGES.map((k) => [k, 0])) as Record<CoverageTriage, number>;
  let reviewed = 0;
  for (const r of cats) {
    if (Number(r.reviewed)) reviewed += Number(r.n);
    else if ((TRIAGES as string[]).includes(String(r.t))) categories[r.t as CoverageTriage] += Number(r.n);
  }
  const events = rows.map((r): OwnerCoverageEvent => {
    const d = readDetail(r.detail);
    const t = r.triage ? seasonTriage({ triage: String(r.triage) as BaseTriage, why: String(r.triage_why ?? "") }, Number(r.season), current)
      : { triage: "actionable" as const, why: "Not triaged yet: checked again within minutes" };
    return {
      season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), state: r.state, played: Number(r.played), withClip: Number(r.with_clip),
      checkedAt: String(r.checked_at), reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null, version: String(r.missing_key),
      videos: d.videos ?? [], daysMissing: d.daysMissing ?? [], missing: d.missing ?? [],
      triage: t.triage, triageWhy: t.why,
      ...(frames.has(`${r.season}/${r.code}`) ? { frames: publicFrames(frames.get(`${r.season}/${r.code}`)!) } : {}),
    };
  });
  return {
    events, list, open: categories.actionable, reviewed, categories, findings, lastPass: lastPass ?? null, clipChecks: clipCheckTotals(),
    seasons: seasons.map((x) => ({ season: Number(x.season), open: Number(x.n), actionable: Number(x.a ?? 0) })),
    totals: { events: Number(t?.events ?? 0), played: Number(t?.played ?? 0), withClip: Number(t?.with_clip ?? 0), full: Number(t?.full ?? 0) },
    frameQueue: queueSummary(queue),
  };
}
/** An event's frame status as the console gets it (the ranking's own count left out). */
const publicFrames = ({ due: _due, ...f }: FrameStatus): CoverageFrames => f;
const PAGE = 50;

/** How many events wait for the owner's review: actionable ones not reviewed yet (the console's badge). */
export async function openCoverageCount(): Promise<number> {
  return Number((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM clip_coverage c WHERE ${MISSING} AND c.reviewed_at IS NULL AND COALESCE(c.triage, 'actionable') = 'actionable'`))?.n ?? 0);
}

/** Bulk Reviewed: every event not reviewed yet in a category ("non-actionable": all but actionable), in a season, or
 *  both. `expected`: the count the owner confirmed; when the list moved meanwhile nothing is marked ("changed", with the
 *  count now). Marks only: the missing list stays, and the 5-minute check keeps checking these events. */
export async function markCoverageBulkReviewed(f: { category?: CoverageTriage | "non-actionable"; season?: number }, expected: number, actor: string, now = Date.now()):
  Promise<{ status: "ok" | "changed"; count: number }> {
  const TRIAGE = triageSql();
  // A pending video check is never marked reviewed, by any bulk.
  const conds = [MISSING, "c.reviewed_at IS NULL", `${TRIAGE} != 'unchecked'`], args: (string | number)[] = [];
  if (f.category === "non-actionable") conds.push(`${TRIAGE} != 'actionable'`);
  else if (f.category) { conds.push(`${TRIAGE} = ?`); args.push(f.category); }
  if (f.season != null) { conds.push("c.season = ?"); args.push(f.season); }
  const where = conds.join(" AND ");
  // One statement: it marks only if the set is still the one the owner confirmed (no count, then a different update).
  const n = await run(`UPDATE clip_coverage AS c SET reviewed_at = ?, reviewed_by = ? WHERE ${where} AND (SELECT COUNT(*) FROM clip_coverage c WHERE ${where}) = ?`,
    [new Date(now).toISOString(), actor, ...args, ...args, expected]);
  if (!n) return { status: "changed", count: Number((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM clip_coverage c WHERE ${where}`, args))?.n ?? 0) };
  await recordAudit(actor, "clipCoverage.bulkReviewed", { category: f.category ?? null, season: f.season ?? null, count: n });
  return { status: "ok", count: n };
}

/** The owner has seen an event's missing list (`version`: the one shown, missingKey): it moves to Reviewed until that list
 *  changes. A list that changed since it was shown isn't marked: "changed", to show the new one. */
export async function markCoverageReviewed(season: number, code: string, version: string, actor: string, now = Date.now()): Promise<"ok" | "changed" | "none"> {
  // A pending video check isn't a list to review: nothing to mark.
  const row = await get<{ code: string }>("SELECT code FROM clip_coverage WHERE season = ? AND code = ? COLLATE NOCASE AND reviewed_at IS NULL AND with_clip < played AND state != 'none' AND COALESCE(triage, 'actionable') != 'unchecked'", [season, code]);
  if (!row) return "none";
  const n = await run("UPDATE clip_coverage SET reviewed_at = ?, reviewed_by = ? WHERE season = ? AND code = ? AND reviewed_at IS NULL AND missing_key = ?", [new Date(now).toISOString(), actor, season, row.code, version]);
  if (!n) return "changed";
  await recordAudit(actor, "clipCoverage.reviewed", { season, code: row.code });
  return "ok";
}
