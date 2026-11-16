// The channel audit (docs/official-videos.md, "The channel audit"): after every watcher run, each watched channel's
// uploads list is read with the YouTube Data API (playlistItems on the channel's UU list, then videos for the facts;
// never a search) and compared, video by video, with what Scout has: the checked list, the watcher's own rows, FIRST's
// link, short links, the channels' broadcasts and the owner's streams. Each upload is stored once in
// official_audit_videos with where Scout has it. One Scout has nothing for gets the watcher's rules applied to it and
// a best-guess event: by its title it is set aside with the reason (a webinar, FRC, no competition named), and
// anything that may be a recording is a finding in Owner › Official videos. One that passes every check of the
// watcher's (its event's day free) is added, as the watcher would, and checked with the watcher's adds from then on.
// One inside the watcher's window, older than the watcher's last run, is a watcher miss, counted by the run: added
// when every check passes, else a finding at once, sent to the review queue when a watcher run after it was found
// still has no row for it. Newer than the watcher's last run, or live then, it's the watcher's next run's to read.
// The watcher's own adds are each checked again against their video's facts and their event; a wrong one is a finding.
//
// Quota: every run reads each channel's newest uploads page (1 unit a channel, more only when a page is all new) and
// the facts of new uploads that may be competitions (1 unit per 50); each channel's whole list is read once a week,
// oldest read first (1 unit per 50 uploads: 34,447 uploads on 63 channels is about 700 units, spread over the week's
// runs by the run's cap). About 63 to 130 units a run, under 600 a day with the weekly reads; the cap is 800 a run.
import { all, db, get, run } from "../db.js";
import { env } from "../env.js";
import { recordAudit } from "../portal/audit.js";
import { withDataLock } from "../data/lock.js";
import { isoDuration } from "./youtube.js";
import { eventVideosByDay, forgetOfficial, localDate } from "./officialVideos.js";
import { LOOKBACK_MS, record, settle, type WatchVerdict } from "./officialWatch.js";
import { NOT_EVENTS, bestGuess, matchVideo, notCompetition, videoWindow, type ChannelRule, type WatchEvent, type WatchVideo } from "./officialMatch.js";

const API = "https://www.googleapis.com/youtube/v3";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Units one audit may use at most. */
export const AUDIT_MAX_UNITS = 800;
/** Each channel's whole uploads list is read again after this long. */
export const FULL_EVERY_MS = 7 * 864e5;
/** Pages of one channel's list read at most (50 a page): FIRST Indiana Robotics has 4,114 uploads (83 pages). */
const MAX_PAGES = 200;
/** The season shown on its own beside the total: 2026-27. */
export const CURRENT_SEASON = 2026;
const YT_LINK = /(?:v=|youtu\.be\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/g;

type Fetch = typeof fetch;
class QuotaError extends Error {}
async function api(path: string, params: Record<string, string>, key: string, fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(`${API}/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(20_000) });
  if (res.ok) return res.json();
  let reason = "";
  try { reason = String((await res.json())?.error?.errors?.[0]?.reason ?? ""); } catch { /* no body */ }
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaError(`YouTube quota used up (${reason})`);
  throw new Error(`YouTube ${path} answered ${res.status}${reason ? ` (${reason})` : ""}`);
}

export interface AuditRun {
  units: number; channels: number; fullChannels: number; uploads: number; recorded: number; setAside: number;
  /** Videos that pass every check of the watcher's, Scout having no record of them or only the watcher's review or
   *  set-aside row: added by the audit. */
  added: number; findings: number; missed: number; queued: number; addsChecked: number; addsWrong: number; error: string | null;
}

/** Where Scout has a video: what plays it on an event (with the event), else the watcher's row. */
interface Record_ { record: string; season: number | null; code: string | null; plays: boolean }

/** Every video Scout has a record of, by id. */
/** The record labels of the rows the audit decides again each run (see needFacts). */
const REVIEW = "in the owner's review";
const SET_ASIDE = "set aside by the watcher";
const SET_ASIDE_BY_AUDIT = "set aside by the channel audit";
async function scoutRecords(): Promise<Map<string, Record_>> {
  const out = new Map<string, Record_>();
  const put = (id: string, r: Record_) => { if (VIDEO_ID.test(id) && (!out.has(id) || (r.plays && !out.get(id)!.plays))) out.set(id, r); };
  for (const r of await all<any>("SELECT video_id, season, code, source, why, removed_at FROM official_videos")) {
    put(String(r.video_id), r.removed_at
      ? { record: "removed from its event by the owner", season: Number(r.season), code: String(r.code), plays: false }
      : { record: r.source === "list" ? "the checked list" : r.source === "watcher" ? (String(r.why ?? "").startsWith("channel audit:") ? "added by the channel audit" : "added by the watcher") : r.source === "evidence" ? "linked from evidence" : "added by the owner", season: Number(r.season), code: String(r.code), plays: true });
  }
  for (const [sql, label] of [
    ["SELECT video_id, season, code FROM event_broadcasts", "the channel's broadcasts on FIRST's channel link"],
    ["SELECT video_id, season, code FROM event_stream_links WHERE video_id IS NOT NULL", "the event's short stream link"],
    ["SELECT video_id, season, code FROM event_streams", "the owner's stream"],
  ] as const) for (const r of await all<any>(sql)) put(String(r.video_id), { record: label, season: Number(r.season), code: String(r.code), plays: true });
  for (const r of await all<any>("SELECT season, code, livestream FROM events WHERE livestream LIKE '%youtu%'")) {
    for (const m of String(r.livestream).matchAll(YT_LINK)) put(m[1], { record: "FIRST's event link", season: Number(r.season), code: String(r.code), plays: true });
  }
  const watch: Record<string, string> = { added: "added by the watcher", approved: "approved by the owner", pending: REVIEW, ignored: SET_ASIDE, duplicate: "a duplicate the watcher logged", rejected: "rejected by the owner" };
  for (const r of await all<any>("SELECT video_id, status, season, code, decided_by FROM official_watch")) {
    const label = r.decided_by === "evidence" && (r.status === "approved" || r.status === "rejected") ? `${r.status === "approved" ? "linked" : "decided"} from evidence`
      : r.decided_by === "channel audit" && r.status === "added" ? "added by the channel audit"
      : watch[String(r.status)];
    put(String(r.video_id), { record: label ?? `the watcher: ${r.status}`, season: r.season == null ? null : Number(r.season), code: r.code ?? null, plays: false });
  }
  return out;
}

/** Every event with a date, for matching in memory, bucketed by month so a window reads two or three buckets. */
async function eventIndex(): Promise<(lo: string, hi: string) => WatchEvent[]> {
  const rows = await all<any>("SELECT season, code, name, type, city, state, country, start, end, timezone, division_code FROM events WHERE start IS NOT NULL");
  const parents = new Set(rows.filter((r) => r.division_code && r.division_code !== r.code).map((r) => `${r.season}/${r.division_code}`));
  const buckets = new Map<string, WatchEvent[]>();
  for (const r of rows) {
    const e: WatchEvent = {
      season: Number(r.season), code: String(r.code), name: String(r.name ?? ""), type: String(r.type ?? ""), city: r.city ?? null, state: r.state ?? null,
      country: r.country ?? null, start: String(r.start).slice(0, 10), end: r.end ? String(r.end).slice(0, 10) : null, timezone: r.timezone ?? null,
      divisionCode: r.division_code ?? null, parent: parents.has(`${r.season}/${r.code}`),
    };
    for (let m = e.start.slice(0, 7); m <= (e.end ?? e.start).slice(0, 7); m = nextMonth(m)) {
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m)!.push(e);
      if (buckets.get(m)!.length > 100_000) break;
    }
  }
  return (lo, hi) => {
    const seen = new Set<WatchEvent>();
    for (let m = lo.slice(0, 7); m <= hi.slice(0, 7); m = nextMonth(m)) for (const e of buckets.get(m) ?? []) if (e.start <= hi && (e.end ?? e.start) >= lo) seen.add(e);
    return [...seen];
  };
}
const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

let busy = false;

/**
 * One audit over every watched channel. Without YOUTUBE_API_KEY nothing is read. Toward what plays it writes only
 * what the watcher would: an upload that passes every check, and the review queue for a watcher miss.
 */
export async function runChannelAudit(log: (s: string) => void, opts: { apiKey?: string | null; fetchImpl?: Fetch; now?: () => number; maxUnits?: number; lockWaitMs?: number } = {}): Promise<AuditRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key || busy) return null;
  busy = true;
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxUnits = opts.maxUnits ?? AUDIT_MAX_UNITS;
  const locked = <T>(fn: () => Promise<T>) => withDataLock("official channel audit", fn, { ttlMs: 60_000, waitMs: opts.lockWaitMs ?? 3 * 60_000, pollMs: 1000 });
  const out: AuditRun = { units: 0, channels: 0, fullChannels: 0, uploads: 0, recorded: 0, setAside: 0, added: 0, findings: 0, missed: 0, queued: 0, addsChecked: 0, addsWrong: 0, error: null };
  const startedAt = new Date(now()).toISOString();
  let runId = 0;
  try {
    const watchRun = await get<{ id: number; started_at: string }>("SELECT id, started_at FROM official_watch_runs WHERE finished_at IS NOT NULL AND COALESCE(error, '') NOT LIKE 'database busy%' ORDER BY id DESC LIMIT 1");
    // What went up, or ended, after the watcher's last run started is its to read next: not a miss.
    const watchedAt = watchRun?.started_at ?? null;
    runId = Number((await locked(() => get<{ id: number }>("INSERT INTO official_audit_runs (watch_run, started_at) VALUES (?, ?) RETURNING id", [watchRun?.id ?? null, startedAt])))?.id ?? 0);
    const channels = await all<any>(`SELECT c.channel_id, c.title, c.region, c.words, c.title_pattern, c.watch_from, a.full_at, a.uploads
      FROM official_channels c LEFT JOIN official_audit_channels a ON a.channel_id = c.channel_id WHERE c.removed_at IS NULL
      ORDER BY a.full_at IS NOT NULL, a.full_at, c.channel_id`);
    const errors = new Map<string, string>();
    const fullRead = new Set<string>();
    // The channels this run got to (read, or failed with its error): one the units ran out before keeps its last check.
    const reached = new Set<string>();
    // 1. The uploads lists: each channel's newest page every run; its whole list once a week, while the units last.
    for (const ch of channels) {
      if (out.units >= maxUnits) { out.error = `stopped at the audit's ${maxUnits} units; the rest next run`; break; }
      const id = String(ch.channel_id);
      reached.add(id);
      const due = !ch.full_at || now() - Date.parse(String(ch.full_at)) >= FULL_EVERY_MS;
      const pages = Math.ceil(Number(ch.uploads ?? 500) / 50) + 1;
      const full = due && out.units + pages <= maxUnits;
      try {
        const whole = await readUploads(id, full, key, fetchImpl, out, maxUnits, startedAt, locked);
        out.channels++;
        if (whole) {
          fullRead.add(id); out.fullChannels++;
          // Saved now: a failure later in the run (the quota, a busy database) mustn't spend this read again next run.
          await locked(() => run("INSERT INTO official_audit_channels (channel_id, full_at) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET full_at = excluded.full_at", [id, startedAt]));
        }
      } catch (e) {
        if (e instanceof QuotaError) throw e;
        errors.set(id, String((e as Error).message ?? e).slice(0, 300));
      }
    }
    // 2. The facts of what may be a competition, Scout having no record of it, and of the watcher's adds (read again
    //    each run: one made private or blocked since is wrong now).
    const records = await scoutRecords();
    const rows = await all<any>("SELECT video_id, channel_id, title, published, start, duration, privacy, embeddable, blocked_in, facts_at, finding, found_at FROM official_audit_videos WHERE gone_at IS NULL");
    const adds = new Set((await all<{ video_id: string }>("SELECT video_id FROM official_videos WHERE source = 'watcher'")).map((r) => String(r.video_id)));
    // The review queue and the watcher's set-aside rows are decided again each run with today's rules: a video the
    // rules now decide never waits on the owner, and one set aside for want of its event is added once Scout has it.
    const again = (id: string) => { const r = records.get(id); return !!r && (r.record === REVIEW || r.record === SET_ASIDE); };
    const needFacts = rows.filter((r) => ((!records.has(String(r.video_id)) || again(String(r.video_id))) && !r.facts_at && !notCompetition(String(r.title))) || adds.has(String(r.video_id))).map((r) => String(r.video_id));
    const facts = new Map<string, any>();
    let factsError: string | null = null;
    for (let i = 0; i < needFacts.length && out.units < maxUnits; i += 50) {
      const ids = needFacts.slice(i, i + 50);
      out.units++;
      let body: any;
      try {
        body = await api("videos", { part: "snippet,contentDetails,status,liveStreamingDetails", id: ids.join(","), maxResults: "50" }, key, fetchImpl);
      } catch (e) {
        // One failed call (a 5xx, a timeout) leaves these without facts, read again next run; the rest of the audit goes on.
        if (e instanceof QuotaError) throw e;
        factsError ??= `facts of ${ids.length} videos couldn't be read: ${String((e as Error).message ?? e).slice(0, 200)}`;
        continue;
      }
      const got = new Set<string>();
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        const vid = String(item?.id ?? "");
        if (!VIDEO_ID.test(vid)) continue;
        got.add(vid);
        facts.set(vid, {
          start: item?.liveStreamingDetails?.actualStartTime ?? null, duration: isoDuration(item?.contentDetails?.duration),
          privacy: String(item?.status?.privacyStatus ?? "public"), embeddable: item?.status?.embeddable !== false ? 1 : 0,
          blocked_in: Array.isArray(item?.contentDetails?.regionRestriction?.blocked) ? item.contentDetails.regionRestriction.blocked.length : 0,
          live: String(item?.snippet?.liveBroadcastContent ?? "none"), end: item?.liveStreamingDetails?.actualEndTime ?? null,
        });
      }
      // Listed but not answered for: private or deleted since.
      for (const vid of ids) if (!got.has(vid)) facts.set(vid, { start: null, duration: null, privacy: "unavailable", embeddable: 0, blocked_in: 0, live: "none" });
    }
    // Each upload against Scout, the watcher's rules on what Scout has nothing for, and the findings.
    const events = await eventIndex();
    const rules = new Map<string, ChannelRule & { floor: string; title: string }>(channels.map((c) => {
      const back = new Date(now() - LOOKBACK_MS).toISOString();
      return [String(c.channel_id), { region: String(c.region), words: c.words ?? null, titlePattern: c.title_pattern ?? null, floor: String(c.watch_from) < back ? String(c.watch_from) : back, title: String(c.title) }];
    }));
    const queue: { v: WatchVideo; ch: string; status: string; why: string; season: number | null; code: string | null; day: string | null; part: string | null; guessWhy: string | null }[] = [];
    const at = new Date(now()).toISOString();
    const writes: { sql: string; args: (string | number | null)[] }[] = [];
    // 3. The watcher's own adds, each checked again first: one taken off its event here isn't what its event plays
    //    when the uploads are weighed against it below.
    const checks = await checkAdds(rows, facts, rules, events, at);
    out.addsChecked = checks.length;
    out.addsWrong = checks.filter((c) => !c.ok).length;
    if (checks.length) await locked(() => db().batch(checks.map((c) => ({ sql: "INSERT INTO official_audit_adds (video_id, ok, why, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET ok = excluded.ok, why = excluded.why, checked_at = excluded.checked_at", args: [c.videoId, c.ok ? 1 : 0, c.why, at] })), "write"));
    // An add the watcher's own title rules set aside today (a rule tightened since: a drone or FRC stream) comes off
    // its event, as the watcher would have left it; it still counts as a wrong add. Any other wrong add waits for the
    // owner's Remove.
    const off = checks.filter((c) => c.setAside);
    if (off.length) {
      await locked(() => db().batch(off.flatMap((c) => [
        { sql: "UPDATE official_videos SET removed_at = ? WHERE video_id = ? AND removed_at IS NULL", args: [at, c.videoId] },
        { sql: "UPDATE official_watch SET status = 'rejected', decided_at = ?, decided_by = 'channel audit', why = ? WHERE video_id = ?", args: [at, `taken off its event by the channel audit: ${c.setAside} (was: added by the watcher)`.slice(0, 500), c.videoId] },
      ]), "write"));
      forgetOfficial();
      for (const c of off) { const rec = records.get(c.videoId); if (rec) records.set(c.videoId, { ...rec, record: "taken off its event by the channel audit", plays: false }); }
      for (const c of off) await recordAudit("channel audit", "officialVideo.remove", { videoId: c.videoId, why: c.setAside });
    }
    // The watcher's rules on one upload, before its event's videos are weighed (settle): null for one Scout has a record
    // of that isn't decided again.
    const firstLook = (r: any) => {
      const vid = String(r.video_id);
      const f = facts.get(vid);
      // Facts read while it's live or still to come aren't final: not marked read, so the next audit reads them again.
      const fLive = f?.live === "live" || f?.live === "upcoming";
      const row = { ...r, ...(f ? { start: f.start, duration: f.duration, privacy: f.privacy, embeddable: f.embeddable, blocked_in: f.blocked_in, facts_at: fLive ? null : at } : {}) };
      const rule = rules.get(String(r.channel_id));
      if (!rule) return null;
      const rec = records.get(vid);
      const redo = rec && rec.record === REVIEW ? "pending" as const : rec && rec.record === SET_ASIDE ? "ignored" as const : null;
      const v: WatchVideo = { videoId: vid, title: String(row.title), start: row.start ?? null, published: row.published ?? null, durationS: row.duration == null ? null : Number(row.duration), privacy: String(row.privacy ?? "public"), embeddable: Number(row.embeddable ?? 1) !== 0, blockedIn: Number(row.blocked_in ?? 0) };
      const title = notCompetition(v.title);
      const live = f?.live === "live" || f?.live === "upcoming";
      const m: WatchVerdict | null = rec && !redo ? null : title ? { kind: "ignore" as const, why: title }
        : live ? { kind: "review" as const, why: "live now or still to come: the watcher reads it once it's over" }
        : !row.facts_at ? { kind: "review" as const, why: "its facts weren't read yet (the audit's units ran out): read next run" }
        : v.privacy === "unavailable" ? { kind: "ignore" as const, why: "listed on the channel but private or deleted: YouTube gives nothing for it" }
        // Hidden since it was listed (a channel's spare copy, often): off its public list, which is all the watcher reads.
        : v.privacy === "unlisted" || v.privacy === "private" ? { kind: "ignore" as const, why: `${v.privacy} now: the channel took it off its public list, so it isn't for Scout` }
        : (() => { const w = videoWindow(v); return matchVideo(v, rule, w ? events(w[0], w[1]) : []); })();
      return { vid, f, row, rule, rec, redo, v, title, live, m };
    };
    // Two videos that each pass every check for one event's day and part in this run (a day's live broadcast and its
    // upload, an early stream beside the main one): neither is added, since which plays is a judgement.
    const looks = new Map<string, NonNullable<ReturnType<typeof firstLook>>>();
    const slots = new Map<string, string[]>();
    for (let i = 0; i < rows.length; i++) {
      if (i % 500 === 499) await new Promise((r) => setImmediate(r));
      const l = firstLook(rows[i]);
      if (!l) continue;
      looks.set(l.vid, l);
      if (l.m?.kind !== "add") continue;
      const key = `${l.m.event.season}/${l.m.event.code}/${l.m.day}/${l.m.part ?? ""}`;
      slots.set(key, [...(slots.get(key) ?? []), l.vid]);
    }
    const clash = (m: WatchVerdict & { kind: "add" }, vid: string) => (slots.get(`${m.event.season}/${m.event.code}/${m.day}/${m.part ?? ""}`) ?? []).filter((o) => o !== vid);
    for (let i = 0; i < rows.length; i++) {
      if (i % 500 === 499) await new Promise((r) => setImmediate(r));
      const r = rows[i];
      const l = looks.get(String(r.video_id));
      if (!l) continue;
      const { vid, f, row, rule, redo } = l;
      let rec = l.rec;
      const inWindow = !!row.published && String(row.published) >= rule.floor ? 1 : 0;
      let verdict: string | null = null, why: string | null = null, finding: string | null = r.finding ?? null, foundAt: string | null = r.found_at ?? null;
      let guess: { season: number | null; code: string | null; day: string | null; why: string | null } = { season: null, code: null, day: null, why: null };
      if (rec && !redo) {
        out.recorded++;
        foundAt = finding === "open" ? null : foundAt;
        // Recorded since: an open finding is settled (queued and dismissed ones keep their history).
        if (finding === "open") finding = null;
      } else {
        const { v, title, live } = l;
        let m: WatchVerdict = l.m!;
        const others = m.kind === "add" ? clash(m, vid) : [];
        if (m.kind === "add" && others.length) m = { kind: "review", why: `${others.length + 1} videos fit ${m.event.code}'s ${m.day}${m.part ? ` (${m.part})` : ""} at once (this and ${others.join(", ")}): which plays is for the owner`, event: m.event, day: m.day, part: m.part };
        // As the watcher would: against what the event already plays that day (a duplicate, or a second video of it).
        if (m.kind === "add") m = await settle(m);
        const anchor = (v.start ?? v.published ?? "").slice(0, 10);
        const g = m.kind !== "ignore" && "event" in m && m.event ? { event: m.event, day: m.day ?? null, why: null as string | null }
          : /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? bestGuess(v, rule, events(shift(anchor, -21), shift(anchor, 1))) : bestGuess(v, rule, []);
        guess = { season: g.event?.season ?? null, code: g.event?.code ?? null, day: g.day ?? null, why: g.why ?? null };
        verdict = m.kind;
        why = m.why;
        // Older than the watcher's window, a video that can't fill a day Scout has no video for isn't a missed
        // recording: set aside, with why (a broadcast on a day the region has no Scout event; an upload with no event to
        // put it on; one whose event already plays a video for each of its days). What's left may be one. Not an add:
        // the watcher's own check of its day and part (settle) passed, so a day playing only another part ("Afternoon"
        // beside its "Morning") doesn't set it aside.
        if (!inWindow && !live && row.facts_at && m.kind === "review") {
          // A broadcast fits only an event on its own day: the best guess's 3 weeks are for an upload.
          const ev = ("event" in m && m.event ? m.event : v.start ? undefined : g.event) as WatchEvent | undefined;
          const gap = v.start && !ev ? `${m.why}: nothing to put it on`
            : !ev ? `an upload with no Scout event to put it on (${g.why})`
            : await everyDayPlays(ev);
          if (gap) { m = { kind: "ignore", why: gap }; verdict = "ignore"; why = `set aside by the audit: ${gap}`; }
        }
        const startMs = v.start ? Date.parse(v.start) : NaN;
        const ended = f?.end ?? (Number.isFinite(startMs) && v.durationS != null ? new Date(startMs + v.durationS * 1000).toISOString() : null);
        const last = [v.published, ended].filter(Boolean).sort().pop() ?? null;
        const unread = inWindow && (!watchedAt || !last || last >= watchedAt);
        if (redo) {
          // In the review queue or set aside by the watcher: decided again, as the watcher would decide it today.
          out.recorded++;
          if (finding === "open") finding = null;
          // A title that says it isn't a competition decides it with no facts read (they never are for one).
          if (live || (!row.facts_at && !title)) { /* read again next run */ }
          else if (m.kind === "add") {
            const add = m;
            await locked(() => record(v, { channelId: String(r.channel_id), title: rule.title }, add, v.published ?? null, now(), "channel audit"));
            out.added++;
            rec = { record: "added by the channel audit", season: add.event.season, code: add.event.code, plays: true };
            records.set(vid, rec);
            why = `added by the channel audit: ${add.why}`;
          } else if (redo === "pending" && (m.kind === "ignore" || m.kind === "duplicate")) {
            // The rules decide it now: out of the owner's queue, set aside with why.
            out.setAside++;
            const setWhy = `set aside by the channel audit: ${m.why}`.slice(0, 500);
            writes.push({ sql: "UPDATE official_watch SET status = ?, decided_at = ?, decided_by = 'channel audit', why = ? WHERE video_id = ? AND status = 'pending'", args: [m.kind === "duplicate" ? "duplicate" : "ignored", at, setWhy, vid] });
            rec = { ...rec!, record: SET_ASIDE_BY_AUDIT };
            records.set(vid, rec);
          }
        }
        // Set aside by its title or facts, or a duplicate of what its event plays that day: the watcher would log it, not queue it.
        else if (m.kind === "ignore" || m.kind === "duplicate") { out.setAside++; if (finding === "open") finding = null; }
        else if (unread || live) {
          // In the watcher's window but newer than its last run, or live then: its next run reads it.
          why = `not read by the watcher yet (it went up or ended after the watcher's last run): ${why}`;
          if (finding === "open") finding = null;
        } else if (m.kind === "add" && row.facts_at && finding !== "dismissed" && finding !== "queued") {
          // Every check of the watcher's passes, and its event's day is free: added, as the watcher would (written at
          // once, so the next upload's verdict sees it), and checked again with the watcher's adds from the next run.
          // One in the watcher's window it didn't take is still a watcher miss.
          const add = m;
          await locked(() => record(v, { channelId: String(r.channel_id), title: rule.title }, add, v.published ?? null, now(), "channel audit"));
          out.added++;
          if (inWindow) out.missed++;
          rec = { record: "added by the channel audit", season: add.event.season, code: add.event.code, plays: true };
          records.set(vid, rec);
          why = `added by the channel audit: ${add.why}`;
          finding = null;
        } else if (row.facts_at && finding !== "dismissed" && finding !== "queued") {
          if (finding !== "open" || !foundAt) foundAt = at;
          finding = "open";
          if (inWindow) {
            // A watcher miss: in its window, older than its last run, and the watcher has no row for it. A watcher run
            // since it was found still didn't take it: into the review queue, with why.
            out.missed++;
            why = `a watcher miss, found by the channel audit: ${why}`;
            if (watchedAt && foundAt < watchedAt) {
              queue.push({ v, ch: String(r.channel_id), status: "pending", why, season: guess.season, code: guess.code, day: guess.day, part: "part" in m ? m.part ?? null : null, guessWhy: guess.why });
              finding = "queued";
            }
          }
        }
      }
      if (finding === "open") out.findings++;
      writes.push({
        sql: `UPDATE official_audit_videos SET start = ?, duration = ?, privacy = ?, embeddable = ?, blocked_in = ?, facts_at = ?, record = ?, season = ?, code = ?, verdict = ?, why = ?,
                guess_season = ?, guess_code = ?, guess_day = ?, guess_why = ?, in_window = ?, finding = ?, found_at = ?
              WHERE video_id = ? AND COALESCE(finding, '') = COALESCE(?, '')`,
        args: [row.start ?? null, row.duration ?? null, row.privacy ?? null, row.embeddable ?? null, row.blocked_in ?? null, row.facts_at ?? null, rec?.record ?? null, rec?.season ?? null, rec?.code ?? null,
          verdict, why, guess.season, guess.code, guess.day, guess.why, inWindow, finding, finding ? foundAt : null, vid, r.finding ?? null],
      });
    }
    out.uploads = rows.length;
    // The review rows first: a miss is marked queued only once its row in the review queue is written.
    if (queue.length) {
      await locked(() => db().batch(queue.map((q) => ({
        sql: `INSERT INTO official_watch (video_id, channel_id, title, start, published, duration, status, season, code, day, part, why, guess_why, seen_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING`,
        args: [q.v.videoId, q.ch, q.v.title, q.v.start, q.v.published ?? null, q.v.durationS, q.season, q.code, q.day, q.part, q.why.slice(0, 500), q.guessWhy, at],
      })), "write"));
      out.queued = queue.length;
    }
    for (let i = 0; i < writes.length; i += 300) { const part = writes.slice(i, i + 300); await locked(() => db().batch(part, "write")); }
    // 4. A best guess for every row in review or set aside whose verdict named no event (rows from before guesses).
    await backfillGuesses(rules, events, locked);
    // 5. Each channel's counts.
    const counts = await all<any>(`SELECT v.channel_id, COUNT(*) AS uploads, SUM(v.record IS NOT NULL) AS recorded, SUM(v.record IS NULL) AS unrecorded,
        SUM(v.finding = 'open') AS open FROM official_audit_videos v WHERE v.gone_at IS NULL GROUP BY v.channel_id`);
    const byCh = new Map(counts.map((c) => [String(c.channel_id), c]));
    const linked = new Map<string, { all: number; current: number }>();
    for (const r of rows) {
      const rec = records.get(String(r.video_id));
      if (!rec?.plays) continue;
      const l = linked.get(String(r.channel_id)) ?? { all: 0, current: 0 };
      l.all++;
      if (rec.season === CURRENT_SEASON) l.current++;
      linked.set(String(r.channel_id), l);
    }
    await locked(() => db().batch(channels.map((c) => {
      const id = String(c.channel_id), n = byCh.get(id), l = linked.get(id) ?? { all: 0, current: 0 };
      return {
        sql: `INSERT INTO official_audit_channels (channel_id, uploads, recorded, unrecorded, linked, linked_current, open_findings, full_at, checked_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(channel_id) DO UPDATE SET uploads = excluded.uploads, recorded = excluded.recorded, unrecorded = excluded.unrecorded, linked = excluded.linked,
                linked_current = excluded.linked_current, open_findings = excluded.open_findings, full_at = COALESCE(excluded.full_at, official_audit_channels.full_at),
                checked_at = COALESCE(excluded.checked_at, official_audit_channels.checked_at), last_error = excluded.last_error`,
        args: [id, Number(n?.uploads ?? 0), Number(n?.recorded ?? 0), Number(n?.unrecorded ?? 0), l.all, l.current, Number(n?.open ?? 0), fullRead.has(id) ? at : null,
          reached.has(id) ? at : null, reached.has(id) ? errors.get(id) ?? null : `not read this run: the audit stopped at its ${maxUnits} units`],
      };
    }), "write"));
    if (factsError && !out.error) out.error = factsError;
    if (errors.size && !out.error) out.error = `${errors.size} channel${errors.size === 1 ? "" : "s"} couldn't be read: ${[...errors.values()][0]}`;
  } catch (e) {
    out.error = String((e as Error).message ?? e).slice(0, 300);
  } finally {
    busy = false;
    if (runId) await locked(() => run(`UPDATE official_audit_runs SET finished_at = ?, units = ?, channels = ?, full_channels = ?, uploads = ?, recorded = ?, set_aside = ?, added = ?, findings = ?, missed = ?,
        queued = ?, adds_checked = ?, adds_wrong = ?, error = ? WHERE id = ?`,
      [new Date(now()).toISOString(), out.units, out.channels, out.fullChannels, out.uploads, out.recorded, out.setAside, out.added, out.findings, out.missed, out.queued, out.addsChecked, out.addsWrong, out.error, runId])).catch(() => {});
  }
  log(`official videos: audit of ${out.channels} channels (${out.units} units, ${out.fullChannels} read in full): ${out.uploads} uploads, ${out.recorded} with a Scout record, ${out.setAside} set aside, ${out.added} added, ${out.findings} open findings, ${out.missed} watcher misses (${out.queued} sent to review), ${out.addsWrong} of ${out.addsChecked} watcher adds wrong${out.error ? `; ${out.error}` : ""}`);
  return out;
}

/** One channel's uploads list: the newest pages until one holds nothing new, or (full) every page. True when the
 *  whole list was read (its end reached), so what wasn't on it is marked gone. */
async function readUploads(channelId: string, full: boolean, key: string, fetchImpl: Fetch, out: AuditRun, maxUnits: number, startedAt: string, locked: <T>(fn: () => Promise<T>) => Promise<T>): Promise<boolean> {
  let token = "";
  for (let page = 0; page < MAX_PAGES && out.units < maxUnits; page++) {
    out.units++;
    const body = await api("playlistItems", { part: "snippet,contentDetails", playlistId: `UU${channelId.slice(2)}`, maxResults: "50", ...(token ? { pageToken: token } : {}) }, key, fetchImpl);
    const items = (Array.isArray(body?.items) ? body.items : []).map((i: any) => ({
      id: String(i?.contentDetails?.videoId ?? ""), title: String(i?.snippet?.title ?? "").slice(0, 300), published: i?.contentDetails?.videoPublishedAt ? String(i.contentDetails.videoPublishedAt) : null,
    })).filter((i: { id: string }) => VIDEO_ID.test(i.id));
    let fresh = items.length;
    if (items.length) {
      const known = new Set((await all<{ video_id: string }>(`SELECT video_id FROM official_audit_videos WHERE gone_at IS NULL AND video_id IN (${items.map(() => "?").join(",")})`, items.map((i: { id: string }) => i.id))).map((r) => String(r.video_id)));
      fresh = items.filter((i: { id: string }) => !known.has(i.id)).length;
      await locked(() => db().batch(items.map((i: { id: string; title: string; published: string | null }) => ({
        sql: `INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(video_id) DO UPDATE SET channel_id = excluded.channel_id, title = excluded.title, published = COALESCE(excluded.published, official_audit_videos.published), last_seen = excluded.last_seen, gone_at = NULL`,
        args: [i.id, channelId, i.title, i.published, startedAt, startedAt],
      })), "write"));
    }
    token = String(body?.nextPageToken ?? "");
    if (!token) {
      // The whole list was read: what wasn't on it is gone from the channel.
      if (full) await locked(() => run("UPDATE official_audit_videos SET gone_at = ? WHERE channel_id = ? AND gone_at IS NULL AND last_seen < ?", [startedAt, channelId, startedAt]));
      return full;
    }
    if (!full && fresh < items.length) return false;
  }
  return false;
}

/** Why an event can't take another day's recording: each of its days already plays a video (a one-day event: any
 *  video, its day read or not). Null when a day has none, or the event plays nothing. */
export async function everyDayPlays(e: WatchEvent): Promise<string | null> {
  // One YouTube no longer plays holds no day: an upload replacing it may be the day's recording.
  const has = (await eventVideosByDay(e.season, e.code)).filter((h) => !h.gone);
  if (!has.length) return null;
  const days: string[] = [];
  for (let d = e.start; d <= (e.end ?? e.start) && days.length < 14; d = shift(d, 1)) days.push(d);
  const covered = new Set(has.map((h) => h.day).filter(Boolean));
  const all = days.every((d) => covered.has(d)) || (days.length === 1 && has.some((h) => !h.day));
  return all ? `its event ${e.season} ${e.code} (${e.name}) already plays a video for ${days.length === 1 ? "its one day" : `each of its ${days.length} days`} (${has.map((h) => h.videoId).join(", ")})` : null;
}

/** Each video the watcher added on its own, checked again: still on its event, playable, an FTC competition stream,
 *  broadcast on the day it's on, the only event the rules fit, and not a second video of that day unless both name
 *  their parts. An add the owner has since removed counts as wrong (it was). */
async function checkAdds(rows: any[], facts: Map<string, any>, rules: Map<string, ChannelRule & { floor: string }>, events: (lo: string, hi: string) => WatchEvent[], at: string): Promise<{ videoId: string; ok: boolean; why: string; setAside: string | null }[]> {
  const adds = await all<any>(`SELECT o.video_id, o.season, o.code, o.day, o.part, o.channel_id, o.title, o.removed_at, e.start AS e_start, e.end AS e_end, e.timezone, e.type, e.name
    FROM official_videos o LEFT JOIN events e ON e.season = o.season AND e.code = o.code WHERE o.source = 'watcher'`);
  const byId = new Map(rows.map((r) => [String(r.video_id), r]));
  const out: { videoId: string; ok: boolean; why: string; setAside: string | null }[] = [];
  for (const a of adds) {
    const vid = String(a.video_id), r = byId.get(vid);
    // Facts not read this run (a failed call): the last ones read stand, so an add found unplayable isn't cleared by a failure.
    const f = facts.get(vid) ?? (r?.privacy != null ? { privacy: String(r.privacy), embeddable: r.embeddable, blocked_in: Number(r.blocked_in ?? 0), start: r.start ?? null, duration: r.duration ?? null } : undefined);
    const wrong: string[] = [];
    if (a.removed_at) wrong.push("the owner removed it from its event");
    if (!a.e_start) wrong.push(`its event ${a.season} ${a.code} isn't in Scout`);
    else if (NOT_EVENTS.has(String(a.type))) wrong.push(`its event is a ${a.type}, not a competition`);
    const title = String(r?.title ?? a.title);
    const nc = notCompetition(title);
    if (nc) wrong.push(nc);
    if (f) {
      if (f.privacy !== "public") wrong.push(`it is ${f.privacy} now`);
      if (!f.embeddable) wrong.push("it can't be embedded");
      if (f.blocked_in >= 50) wrong.push(`blocked in ${f.blocked_in} countries`);
    }
    const start = f?.start ?? r?.start ?? null;
    if (a.e_start && a.day) {
      const s = String(a.e_start).slice(0, 10), e = String(a.e_end ?? a.e_start).slice(0, 10);
      if (a.day < s || a.day > e) wrong.push(`its day ${a.day} isn't one of the event's (${s} to ${e})`);
      if (start && localDate(start, a.timezone) !== a.day) wrong.push(`broadcast on ${localDate(start, a.timezone)} at the venue, but placed on ${a.day}`);
    }
    const rule = rules.get(String(a.channel_id));
    if (rule && start && a.e_start && !nc) {
      const v: WatchVideo = { videoId: vid, title, start, durationS: f?.duration ?? r?.duration ?? null, privacy: "public", embeddable: true, blockedIn: 0 };
      const d = String(start).slice(0, 10);
      // Playability is checked above from its facts: here, only which event the rules pick for it today.
      const m = matchVideo(v, rule, events(shift(d, -1), shift(d, 1)));
      if (m.kind !== "add") wrong.push(`the rules no longer pick it alone: ${m.why}`);
      else if (m.event.code !== String(a.code) || m.event.season !== Number(a.season)) wrong.push(`the rules now pick ${m.event.season} ${m.event.code}, not ${a.season} ${a.code}`);
    }
    if (!a.removed_at && a.e_start) {
      const others = (await eventVideosByDay(Number(a.season), String(a.code))).filter((h) => h.videoId !== vid && !h.gone && h.day === a.day && (h.part == null || a.part == null));
      if (others.length) wrong.push(`a second video of ${a.day} (${others[0].videoId} plays it too) and not both name their part`);
    }
    // Nothing known of its playability and no other fault: no verdict this run, its last check stands.
    if (!f && !wrong.length) continue;
    out.push({ videoId: vid, ok: !wrong.length, why: wrong.length ? wrong.join("; ") : `checked ${at.slice(0, 10)}: playable, on ${a.season} ${a.code} ${a.day}, the only event the rules fit`, setAside: !a.removed_at && !!nc ? nc : null });
  }
  return out;
}

/** A best guess for each row in the watcher's review or set-aside lists whose verdict named no event, 3,000 a run. */
async function backfillGuesses(rules: Map<string, ChannelRule & { floor: string }>, events: (lo: string, hi: string) => WatchEvent[], locked: <T>(fn: () => Promise<T>) => Promise<T>): Promise<void> {
  const rows = await all<any>("SELECT video_id, channel_id, title, start, published FROM official_watch WHERE status IN ('pending', 'ignored') AND code IS NULL AND guess_why IS NULL LIMIT 3000");
  const writes = rows.map((r) => {
    const rule = rules.get(String(r.channel_id));
    const anchor = String(r.start ?? r.published ?? "").slice(0, 10);
    const g = !rule ? { why: "no best guess: its channel isn't watched any more" }
      : bestGuess({ title: String(r.title), start: r.start ?? null, published: r.published ?? null }, rule, /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? events(shift(anchor, -21), shift(anchor, 1)) : []);
    return { sql: "UPDATE official_watch SET season = ?, code = ?, day = ?, guess_why = ? WHERE video_id = ? AND code IS NULL AND guess_why IS NULL", args: [g.event?.season ?? null, g.event?.code ?? null, g.day ?? null, g.why, String(r.video_id)] };
  });
  if (writes.length) await locked(() => db().batch(writes, "write"));
}

// ---- The owner's side (Owner › Official videos, server/videos/officialOwnerRoutes.ts) ----

export interface AuditFinding {
  videoId: string; channel: string; title: string; published: string | null; start: string | null; durationS: number | null;
  verdict: string | null; why: string | null; guessSeason: number | null; guessCode: string | null; guessDay: string | null; guessWhy: string | null; inWindow: boolean;
}
const findingOf = (r: any): AuditFinding => ({
  videoId: String(r.video_id), channel: String(r.channel ?? r.channel_id), title: String(r.title), published: r.published ?? null, start: r.start ?? null,
  durationS: r.duration == null ? null : Number(r.duration), verdict: r.verdict ?? null, why: r.why ?? null, guessSeason: r.guess_season == null ? null : Number(r.guess_season),
  guessCode: r.guess_code ?? null, guessDay: r.guess_day ?? null, guessWhy: r.guess_why ?? null, inWindow: !!Number(r.in_window),
});

/** The audit for the owner console: its last runs, each channel's counts, the open findings and the wrong adds, and
 *  the measure of the watcher's adds over its last 10 runs and its last 100 videos read. */
export async function ownerAudit() {
  // A channel the owner stopped watching isn't audited any more: its rows are left as they were, out of these lists and counts.
  const watched = "channel_id IN (SELECT channel_id FROM official_channels WHERE removed_at IS NULL)";
  const [runs, channels, findings, wrong, reasons, open] = await Promise.all([
    all<any>("SELECT id, started_at, finished_at, units, channels, full_channels, uploads, recorded, set_aside, added, findings, missed, queued, adds_checked, adds_wrong, error FROM official_audit_runs ORDER BY id DESC LIMIT 10"),
    all<any>(`SELECT c.channel_id, c.title, a.uploads, a.recorded, a.unrecorded, a.linked, a.linked_current, a.open_findings, a.full_at, a.checked_at, a.last_error
      FROM official_channels c LEFT JOIN official_audit_channels a ON a.channel_id = c.channel_id WHERE c.removed_at IS NULL ORDER BY COALESCE(a.open_findings, 0) DESC, c.title`),
    all<any>(`SELECT v.video_id, v.channel_id, v.title, v.published, v.start, v.duration, v.verdict, v.why, v.guess_season, v.guess_code, v.guess_day, v.guess_why, v.in_window, c.title AS channel FROM official_audit_videos v LEFT JOIN official_channels c ON c.channel_id = v.channel_id
      WHERE v.finding = 'open' AND v.gone_at IS NULL AND v.${watched} ORDER BY v.verdict = 'add' DESC, v.in_window DESC, v.published DESC LIMIT 200`),
    all<any>(`SELECT a.video_id, a.why, a.checked_at, o.season, o.code, o.day, o.title, o.removed_at FROM official_audit_adds a JOIN official_videos o ON o.video_id = a.video_id WHERE a.ok = 0 ORDER BY a.checked_at DESC`),
    all<any>(`SELECT why, COUNT(*) AS n FROM official_audit_videos WHERE gone_at IS NULL AND record IS NULL AND verdict = 'ignore' AND ${watched} GROUP BY why`),
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM official_audit_videos WHERE finding = 'open' AND gone_at IS NULL AND ${watched}`),
  ]);
  return {
    runs: runs.map((r) => ({ id: Number(r.id), startedAt: String(r.started_at), finishedAt: r.finished_at ?? null, units: Number(r.units), channels: Number(r.channels), fullChannels: Number(r.full_channels),
      uploads: Number(r.uploads), recorded: Number(r.recorded), setAside: Number(r.set_aside), added: Number(r.added ?? 0), findings: Number(r.findings), missed: Number(r.missed), queued: Number(r.queued),
      addsChecked: Number(r.adds_checked), addsWrong: Number(r.adds_wrong), error: r.error ?? null })),
    channels: channels.map((c) => ({ channelId: String(c.channel_id), title: String(c.title), uploads: c.uploads == null ? null : Number(c.uploads), recorded: Number(c.recorded ?? 0), unrecorded: Number(c.unrecorded ?? 0),
      linked: Number(c.linked ?? 0), linkedCurrent: Number(c.linked_current ?? 0), openFindings: Number(c.open_findings ?? 0), fullAt: c.full_at ?? null, checkedAt: c.checked_at ?? null, lastError: c.last_error ?? null })),
    openFindings: Number(open?.n ?? 0),
    findings: findings.map(findingOf),
    wrongAdds: wrong.map((w) => ({ videoId: String(w.video_id), title: String(w.title), season: Number(w.season), code: String(w.code), day: w.day ?? null, why: String(w.why), removed: !!w.removed_at, checkedAt: String(w.checked_at) })),
    setAside: setAsideReasons(reasons),
    adds: await measureAdds(),
  };
}

/** The set-aside reasons, like ones together ("a 3-minute upload" and "a 4-minute upload"; a title's word in any
 *  case), most first. */
function setAsideReasons(rows: { why: string; n: number }[]): { why: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.why).replace(/^a \d+-minute upload, not a broadcast/, "an upload under 45 minutes, not a broadcast")
      .replace(/^(not a competition stream: the title says )"(.*)"$/, (_m: string, a: string, w: string) => `${a}"${w.toLowerCase()}"`);
    m.set(k, (m.get(k) ?? 0) + Number(r.n));
  }
  return [...m].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n).slice(0, 15);
}

/** The watcher's own adds over its last 10 runs and its last 100 videos read, each with the audit's check: wrong is
 *  one the check found wrong (or the owner removed); unchecked, one the audit hasn't checked yet. */
export async function measureAdds() {
  const runs = await all<{ started_at: string; finished_at: string | null }>("SELECT started_at, finished_at FROM official_watch_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 10");
  const tally = async (where: string, args: (string | number)[]) => {
    const r = await get<any>(`SELECT COUNT(*) AS added, SUM(a.ok = 1 AND o.removed_at IS NULL) AS ok, SUM(a.ok = 0 OR o.removed_at IS NOT NULL) AS wrong, SUM(a.video_id IS NULL AND o.removed_at IS NULL) AS unchecked
      FROM official_videos o LEFT JOIN official_audit_adds a ON a.video_id = o.video_id WHERE o.source = 'watcher' AND ${where}`, args);
    return { added: Number(r?.added ?? 0), ok: Number(r?.ok ?? 0), wrong: Number(r?.wrong ?? 0), unchecked: Number(r?.unchecked ?? 0) };
  };
  const from = runs.length ? runs[runs.length - 1].started_at : null, to = runs.length ? (runs[0].finished_at ?? runs[0].started_at) : null;
  const lastRuns = from && to ? await tally("o.added_at >= ? AND o.added_at <= ?", [from, to]) : { added: 0, ok: 0, wrong: 0, unchecked: 0 };
  const read = await get<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT 1 FROM official_watch ORDER BY seen_at DESC LIMIT 100)");
  const last100 = await tally("o.video_id IN (SELECT video_id FROM official_watch ORDER BY seen_at DESC LIMIT 100)", []);
  return { runs: runs.length, from, to, lastRuns, read: Number(read?.n ?? 0), last100 };
}

type Result = { ok: true } | { ok: false; error: string };

/** The owner sends a finding to the review queue: from there it's approved or rejected like any other. */
export async function queueFinding(videoId: string, actor: string, now = Date.now()): Promise<Result> {
  const v = await get<any>("SELECT channel_id, title, start, published, duration, why, guess_season, guess_code, guess_day, guess_why FROM official_audit_videos WHERE video_id = ? AND finding = 'open'", [videoId]);
  if (!v) return { ok: false, error: "That isn't an open finding." };
  const at = new Date(now).toISOString();
  await db().batch([
    { sql: `INSERT INTO official_watch (video_id, channel_id, title, start, published, duration, status, season, code, day, part, why, guess_why, seen_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING`,
      args: [videoId, String(v.channel_id), String(v.title), v.start ?? null, v.published ?? null, v.duration ?? null, v.guess_season ?? null, v.guess_code ?? null, v.guess_day ?? null,
        `sent to review from the channel audit: ${v.why ?? ""}`.slice(0, 500), v.guess_why ?? null, at] },
    { sql: "UPDATE official_audit_videos SET finding = 'queued', finding_by = ? WHERE video_id = ? AND finding = 'open'", args: [actor, videoId] },
  ], "write");
  await recordAudit(actor, "officialVideo.auditQueue", { videoId });
  return { ok: true };
}

/** The owner says a finding isn't a recording Scout should have, and why: kept, with that reason, never opened again. */
export async function dismissFinding(videoId: string, reason: string, actor: string): Promise<Result> {
  if (!reason.trim()) return { ok: false, error: "Say why it isn't a recording Scout should have." };
  const changed = await run("UPDATE official_audit_videos SET finding = 'dismissed', finding_why = ?, finding_by = ? WHERE video_id = ? AND finding = 'open'", [reason.trim().slice(0, 300), actor, videoId]);
  if (!changed) return { ok: false, error: "That isn't an open finding." };
  await recordAudit(actor, "officialVideo.auditDismiss", { videoId, reason });
  return { ok: true };
}
