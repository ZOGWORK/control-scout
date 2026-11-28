// A team's videos for Control Point's team dashboard (GET /internal/teams/:n/videos, docs/shared-accounts.md): the
// creator episodes it's featured in (Behind the Bot, server/videos/creatorVideos.ts featuredFor) and its latest match
// clips. A clip is what every Scout surface plays for the match: FIRST's own video of it (matches.video) first, else its
// place in the event's recording (recordings.ts withClips), each event judged on its whole span (eventMatchSpan), as
// the event page does. Public data only: nothing about any account or workspace.
import { all } from "../db.js";
import { linkStart } from "../../src/shared/recording.js";
import { youtubeId } from "../../src/shared/personal.js";
import { localToUtcMs } from "../../src/shared/time.js";
import { eventMatchSpan, seasonRecordings, withClips, type Recording } from "./recordings.js";
import { withUploads } from "./uploadClips.js";
import type { MatchClip, SearchVideoItem } from "../../src/shared/api.js";
import { withStills } from "./storyboards.js";
import { featuredFor } from "./creatorVideos.js";

export interface FeaturedVideo { series: string; videoId: string; season: number | null; title: string }
/** `still`: a clip cut from a recording, its own frame (one tile of a YouTube storyboard sheet, storyboards.ts); none for
 *  FIRST's own match video, whose thumbnail already is that match. */
export interface TeamClip { videoId: string; start: number; end: number | null; event: string; match: string; title: string; still?: SearchVideoItem["still"] }
export interface TeamVideos { featured: FeaturedVideo[]; clips: TeamClip[] }

/** Most clips sent, and most of the team's latest events read for them (each is one read of its span). */
export const MAX_CLIPS = 6;
const MAX_EVENTS = 4;

/** Most featured videos sent (a team is rarely in more than a few). */
export const MAX_FEATURED = 10;

/** The creator videos whose title names the team (featuredFor), newest first: those in a series (Behind the Bot, Pits
 *  and Parts, …), the one thing the dashboard's badge says. None (never an error) when they can't be read. */
export async function featured(team: number): Promise<FeaturedVideo[]> {
  const rows = await featuredFor(team).catch(() => []);
  return rows.flatMap((r) => (r.series ? [{ series: r.series, videoId: r.videoId, season: r.season, title: r.title }] : [])).slice(0, MAX_FEATURED);
}

interface Row { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; video: string | null; timezone: string | null; name: string; start: string; mine: number }

const levelRank = (l: string) => (l === "playoff" ? 1 : 0);

/** The team's latest match clips (newest first, up to MAX_CLIPS), from its latest events with a played match. */
export async function latestClips(team: number, now = Date.now()): Promise<TeamClip[]> {
  // Its latest events (this season and last), newest first.
  const events = await all<{ season: number; code: string }>(
    `SELECT t.season, t.code FROM match_teams t JOIN events e ON e.season = t.season AND e.code = t.code
     JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
     WHERE t.team = ? AND t.on_field = 1 AND m.played = 1
     GROUP BY t.season, t.code ORDER BY MAX(e.start) DESC, t.season DESC LIMIT ?`, [team, MAX_EVENTS]);
  if (!events.length) return [];
  const recs = new Map<string, Recording>();
  await Promise.all([...new Set(events.map((e) => e.season))].map(async (s) => {
    const m = await seasonRecordings(s).catch(() => new Map<string, Recording>());
    for (const e of events) if (e.season === s && m.has(e.code)) recs.set(`${s}:${e.code}`, m.get(e.code)!);
  }));
  const out: (TeamClip & { order: number[]; cut: boolean })[] = [];
  for (const [i, ev] of events.entries()) {
    // The event's played matches, marked where the team was on the field: a clip's place needs the whole event's span.
    const rows = await all<Row>(
      `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, m.video, e.timezone, e.name, e.start,
              EXISTS (SELECT 1 FROM match_teams t WHERE t.season = m.season AND t.code = m.code AND t.level = m.level AND t.series = m.series AND t.number = m.number AND t.team = ? AND t.on_field = 1) mine
       FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
       WHERE m.season = ? AND m.code = ? AND m.played = 1`, [team, ev.season, ev.code]);
    const rec = recs.get(`${ev.season}:${ev.code}`) ?? null;
    const views = rows.map((r) => {
      const at = localToUtcMs(r.time, r.timezone);
      return { row: r, label: String(r.label), time: r.time, startsAt: at == null ? null : new Date(at).toISOString(), played: true as const, clip: undefined as MatchClip | undefined };
    });
    const placed = withUploads(rec ? withClips(views, rec, now, await eventMatchSpan(ev.season, ev.code)) : views, ev.season, ev.code);
    for (const v of placed) {
      const r = v.row;
      if (!r.mine) continue;
      const own = r.video ? youtubeId(r.video) : null;
      const clip = own ? { videoId: own, start: linkStart(r.video!), end: null, cut: false } : v.clip ? { videoId: v.clip.videoId, start: v.clip.t, end: v.clip.end ?? null, cut: true } : null;
      if (!clip) continue;
      out.push({ ...clip, event: r.name, match: r.label, title: `${r.label} · ${r.name}`, order: [-i, levelRank(r.level), r.series, r.number] });
    }
  }
  // Newest first: the latest event, then its playoffs before its qualification, the latest match first.
  out.sort((a, b) => { for (let k = 0; k < a.order.length; k++) if (a.order[k] !== b.order[k]) return b.order[k] - a.order[k]; return 0; });
  const top = out.slice(0, MAX_CLIPS);
  // A recording's clips would all show the recording's one thumbnail: each gets its own frame instead.
  const items: SearchVideoItem[] = top.map((c) => ({ kind: c.cut ? "recording" : "match", videoId: c.videoId, t: c.start }));
  await withStills(items, now).catch(() => {});
  return top.map(({ order: _o, cut: _c, ...c }, i) => (items[i].still ? { ...c, still: items[i].still } : c));
}

export async function teamVideos(team: number, now = Date.now()): Promise<TeamVideos> {
  const [f, clips] = await Promise.all([featured(team), latestClips(team, now)]);
  return { featured: f, clips };
}
