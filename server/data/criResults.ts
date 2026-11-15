// The Chicago Robotics Invitational's results (sources/cri.ts), written under FIRST's code for the event (FPECRI)
// as an ordinary event bundle with source "cri", so the event page, rankings, bracket, predictions and clip
// placement read them like any other event's.
//
// - Which events: every CRI edition the site lists whose season Scout covers and has a matching event for
//   (FIRST's event named "Chicago Robotics Invitational…" in that season). Editions without one are reported.
// - Never over FIRST: an event whose stored results came from anywhere else (FIRST posted it) is left alone, and
//   sync.ts keeps these results when FIRST's own read of the event comes back empty.
// - Politely: read at most weekly (CRI_EVERY_MS; an unfinished read again after CRI_RETRY_MS), one request at a time with a pause; the lists are cached and
//   each match's page is read only when its result is new or changed, so an unchanged site costs the lists alone.
import { all, kvGet, kvSet } from "../db.js";
import type { EventRow } from "./bundle.js";
import { writeEventBundle } from "./resultChanges.js";
import { SEASON_NUMBERS } from "./seasons.js";
import {
  CRI_SITE, CRI_SOURCE, bundleFromCri, criEventUrl, criGet, criSeasonNumber, fetchCriDetails, fetchCriLists,
  type CriEvent, type CriRaw, type CriSeason,
} from "../sources/cri.js";

/** The site's results are final weeks after the event: once a week is plenty. */
export const CRI_EVERY_MS = 7 * 24 * 3600_000;
/** A read that didn't finish (a failed request, or the cycle stopped by a deploy midway) is tried again after this. */
export const CRI_RETRY_MS = 6 * 3600_000;
/** When a read last finished with nothing failed (the week counts from it), and when one last started. */
const LAST_KEY = `sync:${CRI_SOURCE}`;
const TRY_KEY = `sync:${CRI_SOURCE}:try`;
const rawKey = (season: number, code: string) => `cri:raw:${season}:${code}`;
/** The event's results page on the site, for the page's source line (api/events.ts). */
export const criLinkKey = (season: number, code: string) => `cri:link:${season}:${code}`;

export interface CriLink { site: string; url: string }
export interface CriReport { written: { season: number; code: string; matches: number }[]; unchanged: string[]; skipped: string[]; failed: string[]; note?: string }

/** Is this Scout event CRI's? (FIRST's name for it: "Chicago Robotics Invitational Premier Event".) */
export const isCriName = (name: string | null | undefined) => /^chicago robotics invitational\b/i.test((name ?? "").trim());

/** Scout's event for a CRI edition: the season's one CRI-named event, else null. */
async function scoutEvent(season: number): Promise<(EventRow & { hasOther: boolean }) | null> {
  const rows = await all<any>(
    `SELECT e.season, e.code, e.name, e.type, e.division_code, e.region, e.league, e.venue, e.address, e.city, e.state, e.country, e.start, e.end, e.timezone,
            e.remote, e.hybrid, e.website, e.livestream, e.source, e.upstream_updated,
            (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code) n
       FROM events e WHERE e.season = ? AND e.name LIKE 'Chicago Robotics Invitational%'`, [season]);
  const cri = rows.filter((r) => isCriName(r.name) && !r.division_code);
  if (cri.length !== 1) return null;
  const r = cri[0];
  return {
    season: r.season, code: r.code, name: r.name, type: r.type, divisionCode: r.division_code, region: r.region, league: r.league, venue: r.venue, address: r.address ?? null,
    city: r.city, state: r.state, country: r.country, start: r.start, end: r.end, timezone: r.timezone, remote: !!r.remote, hybrid: !!r.hybrid,
    website: r.website, livestream: r.livestream, source: r.source, upstreamUpdated: r.upstream_updated,
    // Results from any other source (FIRST posted them): never written over.
    hasOther: r.source !== CRI_SOURCE && Number(r.n) > 0,
  };
}

export interface CriIo {
  seasons: () => Promise<CriSeason[]>;
  events: (criSeason: string) => Promise<CriEvent[]>;
  lists: (criSeason: string, slug: string) => Promise<Omit<CriRaw, "details">>;
  details: (criSeason: string, slug: string, matches: any[], known: Record<string, any>) => Promise<Record<string, any>>;
}
const liveIo: CriIo = {
  seasons: () => criGet<CriSeason[]>("/seasons", { pauseMs: 0 }),
  events: (s) => criGet<CriEvent[]>(`/${encodeURIComponent(s)}/events`),
  lists: fetchCriLists,
  details: fetchCriDetails,
};

/** Read the site and write each CRI edition Scout has an event for. `io` stands in for the site (tests). */
export async function syncCriResults(o: { force?: boolean; now?: Date; io?: CriIo; log?: (m: string) => void } = {}): Promise<CriReport> {
  const report: CriReport = { written: [], unchanged: [], skipped: [], failed: [] };
  const now = o.now ?? new Date();
  const [last, tried] = await Promise.all([kvGet<string>(LAST_KEY), kvGet<string>(TRY_KEY)]);
  const within = (at: string | null, ms: number) => !!at && now.getTime() - Date.parse(at) < ms;
  if (!o.force && (within(last, CRI_EVERY_MS) || within(tried, CRI_RETRY_MS))) return { ...report, note: "read recently" };
  // The attempt is marked before the read, so a site that keeps failing is asked again only every few hours; the week
  // starts once a read finishes with nothing failed (a read the cycle never finished is tried again, not a week later).
  await kvSet(TRY_KEY, now.toISOString());
  const io = o.io ?? liveIo;
  const covered = new Set(SEASON_NUMBERS);
  for (const s of await io.seasons()) {
    const season = criSeasonNumber(s);
    if (season == null) continue;
    if (!covered.has(season)) { report.skipped.push(`${s.year}: season ${season} isn't covered`); continue; }
    const ev = await scoutEvent(season);
    if (!ev) { report.skipped.push(`${s.year}: no CRI event in ${season}`); continue; }
    if (ev.hasOther) { report.skipped.push(`${season} ${ev.code}: has results from ${ev.source}`); continue; }
    try {
      const events = (await io.events(s.year)).filter((e) => isCriName(e.name));
      if (events.length !== 1) { report.skipped.push(`${s.year}: ${events.length} CRI events listed`); continue; }
      const e = events[0];
      const lists = await io.lists(s.year, e.slug);
      const cached = await kvGet<CriRaw>(rawKey(season, ev.code));
      const same = cached && JSON.stringify({ ...cached, details: undefined, event: undefined }) === JSON.stringify({ ...lists, event: undefined });
      if (same && ev.source === CRI_SOURCE) { report.unchanged.push(`${season} ${ev.code}`); continue; }
      const details = await io.details(s.year, e.slug, lists.matches ?? [], cached?.details ?? {});
      const raw: CriRaw = { ...lists, details };
      const bundle = bundleFromCri(raw, ev);
      if (!bundle.detail!.matches.length && !bundle.detail!.entries.length) { report.skipped.push(`${season} ${ev.code}: nothing posted`); continue; }
      // Checked again just before writing: FIRST may have posted the event while the site was being read.
      const again = await scoutEvent(season);
      if (!again || again.code !== ev.code || again.hasOther) { report.skipped.push(`${season} ${ev.code}: FIRST posted it meanwhile`); continue; }
      await writeEventBundle(bundle);
      await kvSet(rawKey(season, ev.code), raw);
      await kvSet(criLinkKey(season, ev.code), { site: CRI_SITE, url: criEventUrl(s.year, e.slug) } satisfies CriLink);
      report.written.push({ season, code: ev.code, matches: bundle.detail!.matches.length });
    } catch (err) {
      report.failed.push(`${s.year}: ${(err as Error).message.slice(0, 160)}`);
    }
  }
  if (!report.failed.length) await kvSet(LAST_KEY, now.toISOString());
  o.log?.(`CRI results: ${report.written.map((w) => `${w.season} ${w.code} (${w.matches} matches)`).join(", ") || "nothing new"}`
    + `${report.unchanged.length ? `; unchanged ${report.unchanged.join(", ")}` : ""}${report.skipped.length ? `; skipped ${report.skipped.join("; ")}` : ""}${report.failed.length ? `; failed ${report.failed.join("; ")}` : ""}`);
  return report;
}

/** Where an event's results came from, when it's CRI's site (the event page's source line). */
export async function criLinkFor(season: number, code: string): Promise<CriLink | null> {
  return kvGet<CriLink>(criLinkKey(season, code));
}
