// The video an answer can play (SearchAnswer.video): the one match or event it's about, and each listed match's clip.
// Read from the links the answer already holds (matchHref, eventHref: /events/<season>/<code>?match=<level>:<series>:<number>),
// so no family or parser says anything about video. The same sources as the event page: FIRST's own video of a match
// (matches.video), else its second in the event's recording (server/videos/recordings.ts withClips), else the event's
// recording or live stream from its start. One read of the events' played matches for the whole answer, whatever
// its number of rows; the recordings are the cached season maps. An answer about a team (or its highlights) plays one of
// the team's own listed matches before the event's recording: the recording from its start shows whatever was on
// then (another team's match, an award), so it's the fallback only when no listed match has a clip.
import { all } from "../../db.js";
import { dayLabel, recordingAt, seasonRecordings, withClips, type Recording } from "../../videos/recordings.js";
import { linkStart } from "../../../src/shared/recording.js";
import { youtubeId } from "../../../src/shared/personal.js";
import { localToUtcMs } from "../../../src/shared/time.js";
import type { MatchView, SearchAnswer, SearchVideo, SearchVideoItem } from "../../../src/shared/api.js";
import { matchVideos, type Viewer } from "../../videos/contributors.js";
import { contributorItem, pickMatchVideo } from "../../../src/shared/contributors.js";

/** A match or an event an answer links to. */
export interface VideoRef { season: number; code: string; key?: string }

/** Most rows an answer's play buttons are read for (a video page's tiles: more), and most events in one read. */
const MAX_ROWS = 60;
const MAX_TILES = 220;
const MAX_EVENTS = 30;

/** An answer's link to an event or one of its matches → which; anything else null. */
export function refOfHref(href: string | null | undefined): VideoRef | null {
  const m = href ? /^\/events\/(\d{4})\/([^/?#]+)(?:\?([^#]*))?$/.exec(href) : null;
  if (!m) return null;
  let code: string;
  try { code = decodeURIComponent(m[2]); } catch { return null; }
  const key = new URLSearchParams(m[3] ?? "").get("match");
  return { season: Number(m[1]), code, ...(key && /^(qual|playoff):\d+:\d+$/.test(key) ? { key } : {}) };
}

/** A match hit's ref ("2025:USMACMP:qual:0:12") or an event hit's ("2025:USMACMP"). */
function refOfHit(kind: string, ref: string): VideoRef | null {
  const p = ref.split(":");
  if (!/^\d{4}$/.test(p[0] ?? "") || !p[1]) return null;
  if (kind === "event" && p.length === 2) return { season: Number(p[0]), code: p[1] };
  if (kind === "match" && p.length === 5) return { season: Number(p[0]), code: p[1], key: p.slice(2).join(":") };
  return null;
}

const evKey = (r: VideoRef) => `${r.season}:${r.code}`;

/**
 * What the answer is about, when that's one match or one event: its headline's link; else a question card's event
 * (or its one match); else a stat answer whose matches are all at one event; else, for names, the top hit when it's
 * a match, or an event the words name exactly. A set of events ("events in New Jersey") is about none.
 */
export function mainRef(a: SearchAnswer): VideoRef | null {
  const head = refOfHref(a.stat?.headline?.href);
  if (head) return head;
  if (a.card?.event) return { season: a.card.event.season, code: a.card.event.code };
  if (a.card) {
    const ms = a.card.lines.map((l) => refOfHref(l.href)).filter((r): r is VideoRef => !!r?.key);
    return ms.length === 1 ? ms[0] : null;
  }
  if (a.stat) {
    const rs = rowRefs(a);
    return rs.length && rs.every((r) => evKey(r) === evKey(rs[0])) ? { season: rs[0].season, code: rs[0].code } : null;
  }
  const top = a.hits[0];
  if (!top || a.understood?.kind === "events") return null;
  if (top.kind === "match") return refOfHit("match", top.ref);
  if (top.kind === "event" && top.match === "exact") return refOfHit("event", top.ref);
  return null;
}

/** Every match an answer lists (a stat answer's match rows, a table's rows that link to a match, a video page's tiles;
 *  a records card's lines and its closest records), first seen first. */
export function rowRefs(a: SearchAnswer): (VideoRef & { href: string })[] {
  const out = new Map<string, VideoRef & { href: string }>();
  const add = (href: string | undefined, max = MAX_ROWS) => {
    const r = href && !out.has(href) ? refOfHref(href) : null;
    if (r?.key && out.size < max) out.set(href!, { ...r, href: href! });
  };
  for (const l of [...(a.card?.lines ?? []), ...(a.card?.closest ?? [])]) add(l.href);
  for (const b of a.stat?.blocks ?? []) {
    if (b.kind === "matches") for (const r of b.rows) add(r.href);
    else if (b.kind === "table") for (const r of b.rows) add(r.href);
    else if (b.kind === "videos") for (const t of b.tiles) add(t.href, MAX_TILES);
  }
  return [...out.values()];
}

/** The events whose own stream a video page offers (its links to them). */
function streamRefs(a: SearchAnswer): (VideoRef & { href: string })[] {
  return (a.stat?.blocks ?? []).flatMap((b) => (b.kind === "videos" ? b.streams ?? [] : []))
    .flatMap((l) => { const r = refOfHref(l.href); return r && !r.key ? [{ ...r, href: l.href }] : []; });
}

/** An answer about one team (its stat answer's team, or a link to an event for it), a list of highlights or a video page. */
function aboutTeam(a: SearchAnswer): boolean {
  if (a.stat?.team) return true;
  if (/[?&]team=\d+/.test(a.stat?.headline?.href ?? "")) return true;
  // A list of highlights, or a video page: its own matches stand in before the event's recording too.
  return !!a.stat?.blocks.some((b) => (b.kind === "matches" && b.rows.length > 0 && b.rows.every((r) => r.note)) || (b.kind === "videos" && b.tiles.length > 0));
}

/** The links of an answer's list of highlights (a matches block whose every row says why it stands out); null when it
 *  has none. */
function highlightHrefs(a: SearchAnswer): Set<string> | null {
  const hs = (a.stat?.blocks ?? []).flatMap((b) => (b.kind === "matches" && b.rows.length > 0 && b.rows.every((r) => r.note) ? b.rows.map((r) => r.href) : []));
  return hs.length ? new Set(hs.filter((h): h is string => !!h)) : null;
}

/** The team an answer is about: its stat answer's team, else the one its headline's event link is for. */
function teamOf(a: SearchAnswer): number | null {
  const n = a.stat?.team?.number ?? Number(/[?&]team=(\d+)/.exec(a.stat?.headline?.href ?? "")?.[1] ?? NaN);
  return Number.isFinite(n) ? n : null;
}

/** `own`: the team's alliance's points without penalties, when the answer is about a team at the event (else null). */
interface PlayedRow { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; video: string | null; timezone: string | null; own?: number | null }

/** The answer's video, or undefined when the site has none for it. `viewer`: who is asking, for the match videos people
 *  added (docs/contributors.md), which only a viewer entitled to each gets; without one, none are read (a shared
 *  answer, such as a page drawn for everyone, never carries one). */
export async function answerVideo(a: SearchAnswer, now = Date.now(), viewer?: Viewer): Promise<SearchVideo | undefined> {
  const main = mainRef(a);
  const rows = rowRefs(a);
  const streams = streamRefs(a);
  const events = new Map<string, VideoRef>();
  for (const r of [...(main ? [main] : []), ...rows, ...streams]) if (events.size < MAX_EVENTS || events.has(evKey(r))) events.set(evKey(r), r);
  if (!events.size) return undefined;
  const seasons = [...new Set([...events.values()].map((e) => e.season))];
  const recs = new Map<string, Recording>();
  await Promise.all(seasons.map(async (s) => {
    const m = await seasonRecordings(s).catch(() => new Map<string, Recording>());
    for (const e of events.values()) if (e.season === s && m.has(e.code)) recs.set(evKey(e), m.get(e.code)!);
  }));
  // An answer about a team at one event with no match of its own ("<team> opr at worlds"): the team's matches there,
  // its points on each, so the card plays its best one with a clip, never the recording from its start.
  const team = aboutTeam(a) ? teamOf(a) : null;
  const teamAt = team != null && main && !main.key ? main : null;
  // The events' played matches, all in one read: a match's clip needs its event's whole span (timingTrusted).
  const asked = [...events.values()].filter((e) => rows.some((r) => evKey(r) === evKey(e)) || (main && evKey(main) === evKey(e) && (main.key || teamAt)));
  const played = asked.length ? await all<PlayedRow>(
    `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, m.video, e.timezone${teamAt ? ", CASE t.alliance WHEN 'red' THEN m.red_np WHEN 'blue' THEN m.blue_np END own" : ""} FROM matches m
     JOIN events e ON e.season = m.season AND e.code = m.code${teamAt ? `
     LEFT JOIN match_teams t ON t.season = m.season AND t.code = m.code AND t.level = m.level AND t.series = m.series AND t.number = m.number AND t.team = ? AND t.on_field = 1` : ""}
     WHERE m.played = 1 AND (${asked.map(() => "(m.season = ? AND m.code = ?)").join(" OR ")})`, [...(teamAt ? [team!] : []), ...asked.flatMap((e) => [e.season, e.code])]) : [];
  const byEvent = new Map<string, PlayedRow[]>();
  for (const r of played) { const k = `${r.season}:${r.code}`; (byEvent.get(k) ?? byEvent.set(k, []).get(k)!).push(r); }
  const items = new Map<string, SearchVideoItem>();
  // The headline's own match, when it has one: its start places it in a recording broadcast a day at a time.
  let mainMatch = null as { label: string; startsAt: string | null; timezone: string | null } | null;
  for (const [k, ms] of byEvent) {
    const rec = recs.get(k) ?? null;
    const views = ms.map((r): Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip"> & { key: string; video: string | null } => {
      const at = localToUtcMs(r.time, r.timezone);
      const v = { label: String(r.label), time: r.time, startsAt: at == null ? null : new Date(at).toISOString(), played: true as const, key: `${r.level}:${r.series}:${r.number}`, video: r.video };
      if (main?.key && k === evKey(main) && v.key === main.key) mainMatch = { label: v.label, startsAt: v.startsAt, timezone: r.timezone };
      return v;
    });
    for (const v of withClips(views, rec, now)) {
      const own = v.video ? youtubeId(v.video) : null;
      const item: SearchVideoItem | null = own ? { videoId: own, t: linkStart(v.video!), kind: "match", match: v.label }
        : v.clip ? { videoId: v.clip.videoId, t: v.clip.t, kind: "recording", match: v.label, ...(rec?.meta?.live ? { live: true } : {}) } : null;
      if (item) items.set(`${k}:${v.key}`, item);
    }
  }
  // Match videos people added, for this viewer: the same order as every surface (src/shared/contributors.ts
  // pickMatchVideo): FIRST's own video first (unless the owner chose the added one), then the added one, then the
  // recording. A link this viewer may not see was never read.
  if (viewer && played.length) {
    const added = await matchVideos(played.map((r) => `${r.season}:${r.code}:${r.level}:${r.series}:${r.number}`), viewer).catch(() => new Map());
    for (const r of played) {
      const key = `${r.season}:${r.code}:${r.level}:${r.series}:${r.number}`;
      const c = added.get(key);
      if (!c) continue;
      const cur = items.get(key);
      const pick = pickMatchVideo(cur?.kind === "match" ? cur : null, c, cur && cur.kind !== "match" ? cur : null);
      if (pick?.kind === "contributor") items.set(key, contributorItem(c, String(r.label)));
    }
  }
  const out: SearchVideo = {};
  let mainHref = main?.key ? `${evKey(main)}:${main.key}` : null;
  if (main) {
    const rec = recs.get(evKey(main));
    out.main = mainHref ? items.get(mainHref) : undefined;
    if (!out.main && main.key) {
      // A headline about one match plays that match or nothing: another match's clip under it reads as this one
      // (23268's highlights: best score Q85 on the Sunday, whose video can't be placed, played Q18 from the Saturday),
      // and the recording from its start shows whatever was on then. The listed matches keep their own buttons, and
      // the card links to the recording the match is in, to watch it there.
      const m = mainMatch;
      if (rec) {
        const day = recordingAt(rec, m?.startsAt, now);
        out.watch = { videoId: day.videoId, t: 0, kind: "stream", ...(m ? { match: m.label } : {}),
          ...(rec.more?.length && day.meta?.start ? { day: dayLabel(day.meta.start, m?.timezone) } : {}), ...(day.meta?.live ? { live: true } : {}) };
      }
    } else if (!out.main) {
      if (aboutTeam(a)) {
        // An answer about a team with no one match as its headline: its first listed match with a clip (a list of
        // highlights: the first of those, never a video page's grid beside them).
        const lead = highlightHrefs(a);
        const first = rows.find((r) => (!lead || lead.has(r.href)) && items.has(`${evKey(r)}:${r.key}`));
        if (first) { mainHref = `${evKey(first)}:${first.key}`; out.main = items.get(mainHref); }
      }
      if (!out.main && teamAt) {
        const theirs = played.filter((r) => r.own != null && `${r.season}:${r.code}` === evKey(teamAt)).sort((x, y) => Number(y.own) - Number(x.own));
        const best = theirs.find((r) => items.has(`${evKey(teamAt)}:${r.level}:${r.series}:${r.number}`));
        if (best) out.main = items.get(`${evKey(teamAt)}:${best.level}:${best.series}:${best.number}`);
      }
      out.main ??= rec ? { videoId: rec.videoId, t: 0, kind: "stream", ...(rec.meta?.live ? { live: true } : {}) } : undefined;
    }
  }
  // The listed match the main video is (not the event's recording standing in for it).
  if (out.main && out.main.kind !== "stream" && mainHref) {
    const row = rows.find((r) => `${evKey(r)}:${r.key}` === mainHref);
    if (row) out.mainRow = row.href;
  }
  for (const r of rows) {
    const k = `${evKey(r)}:${r.key}`;
    // The match the card already plays gets no button of its own.
    const item = k === mainHref ? undefined : items.get(k);
    if (item) (out.rows ??= {})[r.href] = item;
  }
  // A video page's streams: each event's recording or live stream, from its start.
  for (const s of streams) {
    const rec = recs.get(evKey(s));
    if (rec) (out.rows ??= {})[s.href] = { videoId: rec.videoId, t: 0, kind: "stream", ...(rec.meta?.live ? { live: true } : {}) };
  }
  if (!out.main) delete out.main;
  return out.main || out.rows || out.watch ? out : undefined;
}
