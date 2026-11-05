// The video an answer can play (SearchAnswer.video): the one match or event it's about, and each listed match's clip.
// Read from the links the answer already holds (matchHref, eventHref: /events/<season>/<code>?match=<level>:<series>:<number>),
// so no family or parser says anything about video. The same sources as the event page: FIRST's own video of a match
// (matches.video), else its second in the event's recording (server/videos/recordings.ts withClips), else the event's
// recording or live stream from its start. One read of the events' played matches for the whole answer, whatever
// its number of rows; the recordings are the cached season maps.
import { all } from "../../db.js";
import { seasonRecordings, withClips, type Recording } from "../../videos/recordings.js";
import { linkStart } from "../../../src/shared/recording.js";
import { youtubeId } from "../../../src/shared/personal.js";
import { localToUtcMs } from "../../../src/shared/time.js";
import type { MatchView, SearchAnswer, SearchVideo, SearchVideoItem } from "../../../src/shared/api.js";

/** A match or an event an answer links to. */
export interface VideoRef { season: number; code: string; key?: string }

/** Most rows an answer's play buttons are read for, and most events in one read. */
const MAX_ROWS = 60;
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

/** Every match a stat answer lists (its match rows, a table's rows that link to a match), first seen first. */
export function rowRefs(a: SearchAnswer): (VideoRef & { href: string })[] {
  const out = new Map<string, VideoRef & { href: string }>();
  const add = (href: string | undefined) => {
    const r = href && !out.has(href) ? refOfHref(href) : null;
    if (r?.key && out.size < MAX_ROWS) out.set(href!, { ...r, href: href! });
  };
  for (const b of a.stat?.blocks ?? []) {
    if (b.kind === "matches") for (const r of b.rows) add(r.href);
    else if (b.kind === "table") for (const r of b.rows) add(r.href);
  }
  return [...out.values()];
}

interface PlayedRow { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; video: string | null; timezone: string | null }

/** The answer's video, or undefined when the site has none for it. */
export async function answerVideo(a: SearchAnswer, now = Date.now()): Promise<SearchVideo | undefined> {
  const main = mainRef(a);
  const rows = rowRefs(a);
  const events = new Map<string, VideoRef>();
  for (const r of [...(main ? [main] : []), ...rows]) if (events.size < MAX_EVENTS || events.has(evKey(r))) events.set(evKey(r), r);
  if (!events.size) return undefined;
  const seasons = [...new Set([...events.values()].map((e) => e.season))];
  const recs = new Map<string, Recording>();
  await Promise.all(seasons.map(async (s) => {
    const m = await seasonRecordings(s).catch(() => new Map<string, Recording>());
    for (const e of events.values()) if (e.season === s && m.has(e.code)) recs.set(evKey(e), m.get(e.code)!);
  }));
  // The events' played matches, all in one read: a match's clip needs its event's whole span (timingTrusted).
  const asked = [...events.values()].filter((e) => rows.some((r) => evKey(r) === evKey(e)) || (main?.key && evKey(main) === evKey(e)));
  const played = asked.length ? await all<PlayedRow>(
    `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, m.video, e.timezone FROM matches m
     JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE m.played = 1 AND (${asked.map(() => "(m.season = ? AND m.code = ?)").join(" OR ")})`, asked.flatMap((e) => [e.season, e.code])) : [];
  const byEvent = new Map<string, PlayedRow[]>();
  for (const r of played) { const k = `${r.season}:${r.code}`; (byEvent.get(k) ?? byEvent.set(k, []).get(k)!).push(r); }
  const items = new Map<string, SearchVideoItem>();
  for (const [k, ms] of byEvent) {
    const rec = recs.get(k) ?? null;
    const views = ms.map((r): Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip"> & { key: string; video: string | null } => {
      const at = localToUtcMs(r.time, r.timezone);
      return { label: String(r.label), time: r.time, startsAt: at == null ? null : new Date(at).toISOString(), played: true, key: `${r.level}:${r.series}:${r.number}`, video: r.video };
    });
    for (const v of withClips(views, rec, now)) {
      const own = v.video ? youtubeId(v.video) : null;
      const item: SearchVideoItem | null = own ? { videoId: own, t: linkStart(v.video!), kind: "match", match: v.label }
        : v.clip ? { videoId: v.clip.videoId, t: v.clip.t, kind: "recording", match: v.label, ...(rec?.meta?.live ? { live: true } : {}) } : null;
      if (item) items.set(`${k}:${v.key}`, item);
    }
  }
  const out: SearchVideo = {};
  if (main) {
    const rec = recs.get(evKey(main));
    out.main = (main.key ? items.get(`${evKey(main)}:${main.key}`) : undefined)
      ?? (rec ? { videoId: rec.videoId, t: 0, kind: "stream", ...(rec.meta?.live ? { live: true } : {}) } : undefined);
  }
  const mainHref = main?.key ? `${evKey(main)}:${main.key}` : null;
  for (const r of rows) {
    const k = `${evKey(r)}:${r.key}`;
    // The match the card already plays gets no button of its own.
    const item = k === mainHref ? undefined : items.get(k);
    if (item) (out.rows ??= {})[r.href] = item;
  }
  if (!out.main) delete out.main;
  return out.main || out.rows ? out : undefined;
}
