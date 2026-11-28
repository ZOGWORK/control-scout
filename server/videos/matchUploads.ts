// Per-match uploads (docs/official-videos.md, "Per-match uploads"; migration 121): a watched channel's short upload of
// one match ("Qualification 8 - 2025 FTC North Scarborough Qualifier") becomes that match's clip, the whole video.
// The channel audit (./officialAudit.ts) already keeps every watched channel's uploads with their facts
// (official_audit_videos); after each audit, runMatchUploads decides the short ones not decided yet by ./uploadMatch.ts
// and writes each verdict once: an add plays at once (audited, as "match uploads"), a set-aside waits for the owner
// (Owner › Official videos), an ignored one is kept with why (read again while it's recent: a match's results can come
// in after its upload). A match a recording already clips plays the recording: an upload is only the clip of a match
// nothing else clips (withUploads), so how full-day streams are linked never changes.
//
// What plays is ./uploadClips.ts (held in memory, read by every surface that plays a clip).
import { all, db, get } from "../db.js";
import { clearClipCaches } from "../caches.js";
import { recordAudit } from "../portal/audit.js";
import { withDataLock } from "../data/lock.js";
import { eventsBetween } from "./officialWatch.js";
import { MAX_MATCH_UPLOAD_S, MIN_MATCH_UPLOAD_S, claimOnce, matchUpload, nearEvents, type PlannedUpload, type UploadMatchRow, type UploadVideo } from "./uploadMatch.js";
import type { ChannelRule } from "./officialMatch.js";
import type { OwnerMatchUploads } from "../../src/shared/api.js";
import { loadMatchUploads, refreshMatchUploads } from "./uploadClips.js";

export const MATCH_UPLOADS_ACTOR = "match uploads";
/** An ignored upload is read again while it went up this recently (its event's results may not be in yet). */
export const REREAD_IGNORED_DAYS = 30;
export type { PlannedUpload };

const yieldNow = () => new Promise<void>((r) => setImmediate(r));

/**
 * Each short upload of the watched channels not decided yet (with `all`, every one: a dry run), and its verdict.
 * Reads only; yields to the event loop as it goes (a first run reads thousands).
 */
export async function planMatchUploads(opts: { all?: boolean; now?: number } = {}): Promise<PlannedUpload[]> {
  const channels = new Map((await all<{ channel_id: string; title: string; region: string; words: string | null; title_pattern: string | null }>(
    "SELECT channel_id, title, region, words, title_pattern FROM official_channels WHERE removed_at IS NULL")).map((r) => [String(r.channel_id), r]));
  if (!channels.size) return [];
  const recent = new Date((opts.now ?? Date.now()) - REREAD_IGNORED_DAYS * 864e5).toISOString();
  const rows = await all<any>(
    `SELECT a.video_id, a.channel_id, a.title, a.published, a.start, a.duration, a.privacy, a.embeddable, a.blocked_in FROM official_audit_videos a
     WHERE a.gone_at IS NULL AND a.start IS NULL AND a.duration BETWEEN ? AND ?
       ${opts.all ? "" : "AND NOT EXISTS (SELECT 1 FROM match_uploads u WHERE u.video_id = a.video_id AND (u.status != 'ignored' OR a.published < ?))"}`,
    opts.all ? [MIN_MATCH_UPLOAD_S, MAX_MATCH_UPLOAD_S] : [MIN_MATCH_UPLOAD_S, MAX_MATCH_UPLOAD_S, recent]);
  const vids = rows.filter((r) => channels.has(String(r.channel_id))).map((r): UploadVideo => ({
    videoId: String(r.video_id), channelId: String(r.channel_id), title: String(r.title), published: r.published ?? null, start: r.start ?? null,
    durationS: r.duration == null ? null : Number(r.duration), privacy: r.privacy ?? null, embeddable: Number(r.embeddable ?? 1) !== 0, blockedIn: Number(r.blocked_in ?? 0),
  }));
  if (!vids.length) return [];
  const near = nearEvents(await eventsBetween("2000-01-01", "2100-01-01"));
  const ruleOf = (id: string): ChannelRule => { const c = channels.get(id)!; return { region: String(c.region), words: c.words ?? null, titlePattern: c.title_pattern ?? null }; };
  // First the events titles could name (their matches are read, not every season's), then each upload decided.
  const matches = new Map<string, UploadMatchRow[]>();
  const needed = new Set<string>();
  for (let i = 0; i < vids.length; i++) {
    const v = vids[i];
    matchUpload(v, ruleOf(v.channelId), near(ruleOf(v.channelId), v.published), (e) => { needed.add(`${e.season}|${e.code}`); return []; });
    if (i % 200 === 199) await yieldNow();
  }
  const keys = [...needed];
  for (let i = 0; i < keys.length; i += 50) {
    const part = keys.slice(i, i + 50).map((k) => k.split("|"));
    const where = part.map(() => "(season = ? AND code = ?)").join(" OR ");
    const args = part.flatMap(([s, c]) => [Number(s), c]);
    const ms = await all<any>(`SELECT season, code, level, series, number, label, description, played FROM matches WHERE ${where}`, args);
    const ts = await all<any>(`SELECT season, code, level, series, number, team FROM match_teams WHERE ${where}`, args);
    const teams = new Map<string, number[]>();
    for (const t of ts) { const k = `${t.season}|${t.code}|${t.level}|${t.series}|${t.number}`; (teams.get(k) ?? teams.set(k, []).get(k)!).push(Number(t.team)); }
    for (const m of ms) {
      const k = `${m.season}|${m.code}`;
      (matches.get(k) ?? matches.set(k, []).get(k)!).push({ level: String(m.level), series: Number(m.series), number: Number(m.number), label: String(m.label), description: m.description ?? null, played: !!Number(m.played), teams: teams.get(`${k}|${m.level}|${m.series}|${m.number}`) ?? [] });
    }
  }
  const out: PlannedUpload[] = [];
  for (let i = 0; i < vids.length; i++) {
    const v = vids[i];
    out.push({ video: v, channel: String(channels.get(v.channelId)!.title), verdict: matchUpload(v, ruleOf(v.channelId), near(ruleOf(v.channelId), v.published), (e) => matches.get(`${e.season}|${e.code}`) ?? []) });
    if (i % 200 === 199) await yieldNow();
  }
  return claimOnce(out, opts.all ? [] : await claimed());
}

/** The matches an upload already plays, or one waits for the owner on (season|code|label). */
async function claimed(): Promise<string[]> {
  return (await all<{ k: string }>("SELECT season || '|' || code || '|' || label AS k FROM match_uploads WHERE status IN ('added', 'review') AND removed_at IS NULL AND label IS NOT NULL")).map((r) => String(r.k));
}

/** Writes the plan's verdicts, each video once (an ignored one written again when read again). */
export async function applyMatchUploads(plan: PlannedUpload[], log: (s: string) => void, now = Date.now()): Promise<{ added: number; review: number; ignored: number }> {
  const at = new Date(now).toISOString();
  const writes: { sql: string; args: (string | number | null)[] }[] = [];
  const n = { added: 0, review: 0, ignored: 0 };
  for (const { video: v, verdict: x } of plan) {
    const ev = x.kind === "ignore" ? undefined : x.event, m = x.kind === "ignore" ? undefined : x.match;
    const status = x.kind === "add" ? "added" : x.kind === "review" ? "review" : "ignored";
    n[x.kind === "add" ? "added" : x.kind === "review" ? "review" : "ignored"]++;
    writes.push({
      sql: `INSERT INTO match_uploads (video_id, channel_id, title, season, code, level, series, number, label, t, status, why, seen_at, decided_at, decided_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, season = excluded.season, code = excluded.code, level = excluded.level, series = excluded.series,
              number = excluded.number, label = excluded.label, t = excluded.t, status = excluded.status, why = excluded.why, seen_at = excluded.seen_at,
              decided_at = excluded.decided_at, decided_by = excluded.decided_by
            WHERE match_uploads.status = 'ignored'`,
      args: [v.videoId, v.channelId, v.title.slice(0, 300), ev?.season ?? null, ev?.code ?? null, m?.level ?? null, m?.series ?? null, m?.number ?? null, m?.label ?? null,
        x.kind === "add" ? x.t : 0, status, x.why.slice(0, 500), at, x.kind === "add" ? at : null, x.kind === "add" ? MATCH_UPLOADS_ACTOR : null],
    });
  }
  for (let i = 0; i < writes.length; i += 100) await db().batch(writes.slice(i, i + 100), "write");
  const adds = plan.filter((p) => p.verdict.kind === "add");
  // One audit line a run, naming every match it added (thousands on a first run would bury the log otherwise).
  if (adds.length) await recordAudit(MATCH_UPLOADS_ACTOR, "matchUpload.add", { count: adds.length, adds: adds.map((p) => p.verdict.kind === "add" ? `${p.video.videoId} ${p.verdict.event.season} ${p.verdict.event.code} ${p.verdict.match.label}` : "") });
  if (n.added) { await loadMatchUploads(); clearClipCaches(); }
  if (n.added || n.review) log(`match uploads: ${n.added} added, ${n.review} set aside for the owner, ${n.ignored} not a match's upload`);
  return n;
}

/**
 * After an audit run: what plays loaded again (the audit may have read an added upload as private or gone), then the
 * new short uploads decided and written, under the data writer's lease. The matches already taken are read again
 * inside the lease, so an owner's approval while this one planned never gives a match two uploads. changed: what
 * plays changed (the caller checks coverage again).
 */
export async function runMatchUploads(log: (s: string) => void, now = Date.now()): Promise<{ added: number; review: number; ignored: number; changed: boolean }> {
  const dropped = await refreshMatchUploads();
  if (dropped) clearClipCaches();
  const plan = await planMatchUploads({ now });
  if (!plan.length) return { added: 0, review: 0, ignored: 0, changed: dropped };
  const n = await withDataLock("match uploads", async () => applyMatchUploads(claimOnce(plan, await claimed()), log, now), { ttlMs: 60_000, waitMs: 3 * 60_000, pollMs: 1000 });
  return { ...n, changed: dropped || n.added > 0 };
}

// ── The owner's decisions (Owner › Official videos) ──

/** The set-asides waiting for the owner, newest first, and how many play. */
export async function ownerMatchUploads(): Promise<OwnerMatchUploads> {
  const rows = await all<any>(
    `SELECT u.video_id, u.title, COALESCE(c.title, u.channel_id) AS channel, u.season, u.code, u.label, u.why, u.seen_at FROM match_uploads u
     LEFT JOIN official_channels c ON c.channel_id = u.channel_id WHERE u.status = 'review' ORDER BY u.seen_at DESC, u.season DESC, u.code, u.label LIMIT 500`);
  const added = await get<{ n: number }>("SELECT COUNT(*) AS n FROM match_uploads WHERE status = 'added' AND removed_at IS NULL");
  return {
    review: rows.map((r) => ({ videoId: String(r.video_id), title: String(r.title), channel: String(r.channel), season: r.season == null ? null : Number(r.season), code: r.code ?? null, label: r.label ?? null, why: String(r.why), seenAt: String(r.seen_at) })),
    added: Number(added?.n ?? 0),
  };
}

type Result = { ok: true } | { ok: false; status: number; error: string };

/** The owner says a set-aside is its match: the match it names (or the one they type, "Q12") of the event it names. */
export async function approveMatchUpload(videoId: string, body: { label?: unknown }, actor: string, now = Date.now()): Promise<Result> {
  const at = new Date(now).toISOString();
  // Every check inside the lease: a run adding, or another approval, can't slip in between a check and the write.
  const r = await withDataLock("match uploads", async (): Promise<Result | { ok: true; season: number; code: string; label: string }> => {
    const row = await get<{ season: number | null; code: string | null; label: string | null; status: string }>("SELECT season, code, label, status FROM match_uploads WHERE video_id = ?", [videoId]);
    if (!row || row.status !== "review") return { ok: false, status: 404, error: "That upload isn't waiting for you." };
    if (row.season == null || !row.code) return { ok: false, status: 400, error: "No event fits this upload: it can't be added." };
    const label = (typeof body.label === "string" && body.label.trim() ? body.label.trim() : row.label ?? "").toUpperCase();
    const m = await get<{ level: string; series: number; number: number; label: string; played: number }>("SELECT level, series, number, label, played FROM matches WHERE season = ? AND code = ? AND UPPER(label) = ?", [row.season, row.code, label]);
    if (!m) return { ok: false, status: 400, error: `${label || "That match"} isn't one of ${row.code}'s matches (Q12, M3, F1 …).` };
    if (!Number(m.played)) return { ok: false, status: 400, error: `${row.code} ${m.label} wasn't played.` };
    const other = await get<{ video_id: string }>("SELECT video_id FROM match_uploads WHERE season = ? AND code = ? AND label = ? AND status = 'added' AND removed_at IS NULL AND video_id != ?", [row.season, row.code, m.label, videoId]);
    if (other) return { ok: false, status: 409, error: `${row.code} ${m.label} already plays another upload (${other.video_id}).` };
    const w = await db().batch([{
      sql: "UPDATE match_uploads SET status = 'added', level = ?, series = ?, number = ?, label = ?, decided_at = ?, decided_by = ? WHERE video_id = ? AND status = 'review'",
      args: [m.level, Number(m.series), Number(m.number), m.label, at, actor, videoId],
    }], "write");
    if (!Number(w[0]?.rowsAffected ?? 0)) return { ok: false, status: 404, error: "That upload isn't waiting for you." };
    return { ok: true, season: Number(row.season), code: String(row.code), label: String(m.label) };
  }, { ttlMs: 30_000, waitMs: 60_000, pollMs: 500 });
  if (!("season" in r)) return r;
  await recordAudit(actor, "matchUpload.approve", { videoId, season: r.season, code: r.code, label: r.label });
  await loadMatchUploads();
  clearClipCaches();
  return { ok: true };
}

/** The owner says a set-aside isn't a match's upload: never proposed again. */
export async function rejectMatchUpload(videoId: string, reason: string | null, actor: string, now = Date.now()): Promise<Result> {
  const n = await withDataLock("match uploads", () => db().batch([{ sql: "UPDATE match_uploads SET status = 'rejected', why = COALESCE(?, why), decided_at = ?, decided_by = ? WHERE video_id = ? AND status = 'review'", args: [reason, new Date(now).toISOString(), actor, videoId] }], "write"), { ttlMs: 30_000, waitMs: 60_000, pollMs: 500 });
  if (!Number(n[0]?.rowsAffected ?? 0)) return { ok: false, status: 404, error: "That upload isn't waiting for you." };
  await recordAudit(actor, "matchUpload.reject", { videoId, ...(reason ? { reason } : {}) });
  return { ok: true };
}

/** The owner takes an added upload off its match: it stops playing, and is never added again. */
export async function removeMatchUpload(videoId: string, actor: string, now = Date.now()): Promise<Result> {
  const n = await withDataLock("match uploads", () => db().batch([{ sql: "UPDATE match_uploads SET removed_at = ?, decided_by = ? WHERE video_id = ? AND status = 'added' AND removed_at IS NULL", args: [new Date(now).toISOString(), actor, videoId] }], "write"), { ttlMs: 30_000, waitMs: 60_000, pollMs: 500 });
  if (!Number(n[0]?.rowsAffected ?? 0)) return { ok: false, status: 404, error: "That upload isn't on a match." };
  await recordAudit(actor, "matchUpload.remove", { videoId });
  await loadMatchUploads();
  clearClipCaches();
  return { ok: true };
}
