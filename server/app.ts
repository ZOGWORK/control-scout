// HTTP API. Browsing, search and predictions need no account, ever; only
// /api/me/* (personal data) does.
import express, { type NextFunction, type Request, type Response } from "express";
import compression from "compression";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { RELEASE } from "./release.js";
import { all, get, kvGet } from "./db.js";
import { hasFirst } from "./env.js";
import { CURRENT_SEASON, SEASONS, SEASON_NUMBERS, isLegacy, seasonInfo } from "./data/seasons.js";
import { ensureSearchIndex, search } from "./api/search.js";
import { rebuildSearch } from "./stats/job.js";
import { teamProfile, compareTeams, teamSummaries, shortlistTeams, reliabilityMany } from "./api/teams.js";
import { cachedEventDetail, eventDetail, listEvents, toEventInput } from "./api/events.js";
import { perTeamOf, simulatedRankings } from "./projections/rankingSim.js";
import { eventRecording, recordingStream, seasonRecordings, seasonVideoKinds, withClips } from "./videos/recordings.js";

/** An event's detail with its recording (server/videos/recordings.ts: the owner's stream, else FIRST's YouTube link)
 *  and each played match's place in it, for every route that answers with one (the page and "Refresh results" alike,
 *  or a refresh would take the Watch section away). Both ride along outside the cached detail (they change without a
 *  data version); the shared objects are never changed. */
async function withStream<T extends { event: { season: number; code: string }; matches: MatchView[] }>(d: T): Promise<T> {
  const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
  return rec ? { ...d, event: { ...d.event, stream: recordingStream(rec) }, matches: withClips(d.matches, rec) } : d;
}
import { matchDetail, matchViews } from "./api/matches.js";
import { matchReport } from "./api/matchReport.js";
import { resultChanges } from "./api/resultChanges.js";
import { eventDisagreements } from "./api/disagreements.js";
import { MATCH_KEY as REPORT_KEY } from "../src/shared/matchReport.js";
import { trackRecord } from "./api/accuracy.js";
import { currentWeather } from "./weather.js";
import { MISSING_FILE, canonicalRedirects, renderPage } from "./seo.js";
import { sitemapChunkRoute, sitemapRoute } from "./sitemap.js";
import { indexNowKeyRoute } from "./indexNow.js";
import { latestRankings, rankingsWeek } from "./powerRankings/store.js";
import { isWeekId } from "../src/shared/powerRankings.js";
import { pairHistory } from "../src/shared/pairHistory.js";
import { liveForecaster, liveVersion, dataVersion, recentRecords } from "./predict/engine.js";
import { bonusView } from "../src/shared/bonusOdds.js";
import { authRouter, meRouter, authProviders } from "./auth/routes.js";
import { contactRouter } from "./contact.js";
import { scoutRouter } from "./scout/entries.js";
import { streamRouter } from "./scout/stream.js";
import { templateRouter } from "./scout/templates.js";
import { exportRouter } from "./scout/export.js";
import { settingsRouter } from "./scout/settings.js";
import { activityRouter } from "./scout/activity.js";
import { historyRouter } from "./scout/history.js";
import { membersRouter } from "./scout/members.js";
import { picklistRouter } from "./scout/picklist.js";
import { assignmentsRouter } from "./scout/assignments.js";
import { commentsRouter } from "./scout/comments.js";
import { consensusRouter } from "./scout/consensus.js";
import { matchReportRouter } from "./scout/matchReport.js";
import { inboxRouter } from "./inbox/routes.js";
import { pushRouter } from "./push/routes.js";
import { vapidReady } from "./push/push.js";
import { reportsRouter } from "./errorReports.js";
import { packsRouter } from "./packs/routes.js";
import { cachedPublicUsage, collectRouter, statsRouter } from "./analytics.js";
import { homeOverview } from "./api/home.js";
import { coinFlips, radarEtag } from "./api/coinFlips.js";
import { listRecords, recordRegions, recordsQuery, RecordsQueryError, streamRecordsCsv } from "./api/records.js";
import { directoryQuery, DirectoryQueryError, listDirectory } from "./api/directory.js";
import { FilterError } from "../src/shared/filterDsl.js";
import { RECORDS_EXPORT_MAX, RECORDS_MAX_PAGE_SIZE } from "../src/shared/statCatalog.js";
import { manualRefresh, type ManualOutcome } from "./data/live.js";
import { defaultRankingsSeason, rankingPlaces, rankingsPage, snapshotWeeks, type RankingsQuery } from "./api/rankings.js";
import { MAX_REGIONS, isWeek, parsePlaces } from "../src/shared/rankings.js";
import { registerCache } from "./caches.js";
import { requestMetrics } from "./metrics.js";
import { allFlags, isEnabled } from "./flags.js";
import { readProjections } from "./projections/store.js";
import { projectionStream } from "./projections/routes.js";
import { ownerRouter } from "./portal/routes.js";
import { photosRouter } from "./scout/photos.js";
import { MATCH_KEY, ShareError, cachedCard, cardKey, matchCard } from "./share/match.js";
import { env } from "./env.js";
import { r2 } from "./scout/r2.js";
import { fakeR2Router } from "./scout/fakeR2.js";
import type { EventRefreshResult, ForecastView, MatchExplanationView, Meta, SearchHit, MatchView } from "../src/shared/api.js";

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const bad = (msg: string) => new HttpError(400, msg);

/** Wrap an async handler: errors become JSON responses. */
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => { if (!res.headersSent && body !== undefined) res.json(body); }).catch(next);
};

const int = (x: unknown, name: string, { min = 0, max = 1e7 } = {}) => {
  const n = Number(x);
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
};
/** An optional count (a page size, a number of days): absent means `def`, a whole number from `min` up is
 *  capped at `max`, and anything else (negative, fractional, Infinity, repeated) is a 400. */
const boundedCount = (x: unknown, name: string, def: number, min: number, max: number) => {
  if (x == null || x === "") return def;
  // Any run of digits is a whole number (a very long one reads as a huge value or Infinity, which the cap brings down).
  if (typeof x !== "string" || !/^\d+$/.test(x.trim())) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  const n = Number(x.trim());
  if (n < min) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return Math.min(max, n);
};
const season = (x: unknown) => {
  if (x == null || x === "") return CURRENT_SEASON;
  const s = int(x, "season", { min: 2000, max: 2100 });
  if (!SEASON_NUMBERS.includes(s)) throw new HttpError(404, `Season ${s} isn't covered (we hold ${SEASON_NUMBERS.join(", ")})`);
  return s;
};
/** While a season's statistics are behind its results (api/readiness.ts), answers built from them aren't kept
 *  by browser or shared caches: "Check again" must reach the server. Healthy answers keep the usual caching. */
const noStoreWhileBehind = (res: Response, state: string) => { if (state !== "ready") res.setHeader("Cache-Control", "no-store"); };
/** Predictions: 2019–2022 are stored for history but never rated. */
const predictSeason = (x: unknown) => {
  const s = season(x);
  if (isLegacy(s)) throw new HttpError(404, `Predictions cover ${SEASON_NUMBERS.filter((n) => !isLegacy(n)).join(", ")}; ${seasonInfo(s).label} is shown for history only`);
  return s;
};
const teamList = (x: unknown, name: string, max = 4) => {
  const list = String(x ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => int(t, name, { min: 1, max: 999999 }));
  if (!list.length || list.length > max) throw bad(`${name}: give 1–${max} team numbers`);
  if (new Set(list).size !== list.length) throw bad(`${name}: a team is listed twice`);
  return list;
};
const code = (x: unknown) => {
  const c = String(x ?? "").toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(c)) throw bad("invalid event code");
  return c;
};

/** Tiny per-IP token bucket (heavy endpoints only). */
function limiter(perMinute: number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "?";
    const now = Date.now();
    const b = buckets.get(ip) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) { res.status(429).json({ error: "Too many requests — try again in a minute." }); return; }
    b.tokens -= 1;
    buckets.set(ip, b);
    if (buckets.size > 10000) buckets.clear();
    next();
  };
}

/** Short-lived cache for expensive results, keyed by data version. */
function memo<T>(ttlMs: number) {
  const m = new Map<string, { at: number; v: Promise<T> }>();
  const lookup = async (key: string, fn: () => Promise<T>): Promise<T> => {
    const k = `${await dataVersion()}|${key}`;
    const hit = m.get(k);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    const v = fn();
    m.set(k, { at: Date.now(), v });
    v.catch(() => m.delete(k));
    if (m.size > 500) m.delete(m.keys().next().value!);
    return v;
  };
  return Object.assign(lookup, { clear: () => m.clear() });
}
const forecastMemo = memo<ForecastView | null>(120_000);
const partnersMemo = memo<unknown>(120_000);
registerCache("Event forecasts", () => { forecastMemo.clear(); partnersMemo.clear(); });

function refreshMessage(o: ManualOutcome): string {
  switch (o.status) {
    case "refreshed": return o.fetched ? "Updated from FIRST just now." : "Checked FIRST just now: nothing new yet.";
    case "recent": return "Someone refreshed this event seconds ago, so these are the latest results.";
    case "busy": return "A full data update is running and includes this event. New results will show in a minute or two.";
    case "failed": return "FIRST didn't answer just now. Showing the latest results we have.";
    default: return "";
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // Development and tests only (R2_FAKE=1, never in production): a local stand-in for the photo bucket (server/scout/fakeR2.ts).
  if (env.r2Fake) app.use("/__fake-r2", fakeR2Router());
  // Request counts and latency per route pattern, for the owner portal (server/metrics.ts).
  app.use(requestMetrics());
  // One host, one URL per page: www/alias hosts, trailing slashes and /team/… aliases 301 (server/seo.ts).
  app.use(canonicalRedirects);
  // CSV exports stream and gzip themselves, flushing as they go (server/api/records.ts streamedBody).
  // Live streams (text/event-stream, server/scout/stream.ts) are never compressed: gzip would hold events back.
  app.use(compression({ filter: (req, res) => !/^text\/(csv|event-stream)/.test(String(res.getHeader("Content-Type") ?? "")) && compression.filter(req, res) }));
  // /api/collect reads its own tiny body (1 KB cap), so the 2 MB JSON parser skips it.
  const json = express.json({ limit: "2mb" });
  // Same matching as Express routing (case-insensitive, optional trailing slash).
  app.use((req, res, next) => (/^\/api\/collect\/?$/i.test(req.path) ? next() : json(req, res, next)));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const api = express.Router();
  // Public FTC data (GET, not account or auth): cacheable for a minute, then
  // served stale while it revalidates (the ETag makes that a cheap 304).
  // Anything personal stays no-store (case-insensitive, like Express routing),
  // and so does every error response, so a retry never replays a cached 503.
  api.use((req, res, next) => {
    const personal = /^\/(me|auth|health|stats|reports|scout|owner|inbox)(\/|$)/i.test(req.path);
    res.setHeader("Cache-Control", req.method === "GET" && !personal ? "public, max-age=60, stale-while-revalidate=300" : "no-store");
    const writeHead = res.writeHead;
    res.writeHead = function (this: typeof res, ...a: Parameters<typeof writeHead>) {
      if (this.statusCode >= 400 || (typeof a[0] === "number" && a[0] >= 400)) this.setHeader("Cache-Control", "no-store");
      return writeHead.apply(this, a);
    } as typeof writeHead;
    next();
  });

  api.get("/health", h(async () => ({ ok: true, engine: ENGINE_VERSION, release: RELEASE })));

  // Feature flags the app reads to hide switched-off features (server/flags.ts). Short-lived, so a
  // switch flipped in the owner portal reaches open pages within a minute.
  api.get("/flags", h(async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=15");
    // Photos also need R2 configured on this server: without it the app hides them as if switched off.
    const flags = await allFlags();
    return { flags: { ...flags, photos: flags.photos && !!r2(), push: flags.push && vapidReady() } };
  }));

  api.get("/meta", h(async (): Promise<Meta> => {
    const rows = await all<any>("SELECT season, frozen, last_sync FROM seasons");
    const sync = await kvGet<{ at: string }>("sync:last");
    // Records are also rebuilt by the live fast lane (every few minutes during events): the newer time counts.
    const [full, live] = await Promise.all([kvGet<{ at: string }>("stats:last"), kvGet<{ at: string }>("records:last")]);
    const stats = !live ? full : !full || live.at > full.at ? live : full;
    // A fresh server (no database connected yet) has no teams: the app says so
    // instead of letting every search and page look broken.
    const loaded = await all<{ one: number }>("SELECT 1 one FROM teams LIMIT 1");
    return {
      seasons: SEASONS.map((s) => { const r = rows.find((x) => Number(x.season) === s.season); return { ...s, frozen: !!r?.frozen, lastSync: r?.last_sync ?? null, predictable: !isLegacy(s.season) }; }).reverse(),
      currentSeason: CURRENT_SEASON, engineVersion: ENGINE_VERSION, dataAsOf: sync?.at ?? null, statsAt: stats?.at ?? null,
      auth: authProviders(), firstConfigured: hasFirst(), dataLoaded: loaded.length > 0,
    };
  }));

  // The home page's season coverage and teams by country (server/api/home.ts).
  api.get("/home/overview", h(async (req, res) => {
    const o = await homeOverview(season(req.query.season));
    noStoreWhileBehind(res, o.readiness.state);
    return o;
  }));

  // Today's coin flips: the closest calls on today's schedules, every event at its own venue date (server/api/coinFlips.ts).
  // Revalidated every time, by browsers and shared caches alike: the open page polls it each minute and rows
  // drop at each venue's midnight, so a cached copy must never be served without asking. The ETag (the stored
  // radar and the venue dates still today) keeps that a cheap 304.
  api.get("/home/coin-flips", h(async (req, res) => {
    const r = await coinFlips();
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", radarEtag(r));
    if (req.fresh) { res.status(304).end(); return undefined; }
    return r;
  }));

  // Opt-in page views and sessions started, last 30 days: only when the owner publishes them (PUBLIC_USAGE_ENABLED).
  api.get("/public-usage", h(async (_req, res) => {
    const u = await cachedPublicUsage();
    // An unreadable feed answers 200 with its reason (the panel says so), but isn't kept by caches.
    if (u.reason === "error") res.setHeader("Cache-Control", "no-store");
    return u;
  }));

  api.get("/search", h(async (req) => {
    await ensureSearchIndex(rebuildSearch);
    const prefer = new Set(String(req.query.prefer ?? "").split(",").filter((k) => /^(team:\d{1,6}|event:\d{4}:[A-Z0-9_-]{2,24})$/i.test(k)).slice(0, 100));
    // ?kinds=event,place: only those kinds, picked before the limit (unknown names are ignored).
    const kinds = new Set(String(req.query.kinds ?? "").split(",").filter((k): k is SearchHit["kind"] => k === "team" || k === "event" || k === "match" || k === "place"));
    return { q: String(req.query.q ?? ""), hits: await search(String(req.query.q ?? "").slice(0, 80), boundedCount(req.query.limit, "limit", 12, 1, 25), prefer, kinds) };
  }));

  // Weather in a team's home town, for the top bar (shown only when you've set your team).
  api.get("/weather", h(async (req) => {
    const team = int(req.query.team, "team", { min: 1, max: 999999 });
    const t = await get<{ city: string | null; state: string | null; country: string | null }>("SELECT city, state, country FROM teams WHERE number = ?", [team]);
    const w = t ? await currentWeather(t).catch(() => null) : null;
    return w ? { available: true, ...w } : { available: false };
  }));

  // Power rankings (server/powerRankings/): the latest published week, or one week, each with the archive.
  api.get("/power-rankings", h(async () => latestRankings()));
  api.get("/power-rankings/:week", h(async (req) => {
    const id = String(req.params.week).toLowerCase();
    const r = isWeekId(id) ? await rankingsWeek(id) : null;
    if (!r) throw new HttpError(404, `No power rankings published for ${id.slice(0, 20)}`);
    return r;
  }));

  api.get("/teams/:number", h(async (req) => {
    const p = await teamProfile(int(req.params.number, "team", { min: 1, max: 999999 }), req.query.season ? season(req.query.season) : undefined);
    if (!p) throw new HttpError(404, `No FTC team ${req.params.number} in our data`);
    return p;
  }));

  api.get("/teams/:number/matches", h(async (req) => {
    const team = int(req.params.number, "team", { min: 1, max: 999999 });
    return { team, season: season(req.query.season), matches: await matchViews({ season: season(req.query.season), team }, { predictUnplayed: true }) };
  }));

  /**
   * Alerts feed: every match of the given teams (up to 200) that's unplayed
   * and within the next day, or played in the last 6 hours — one request,
   * so in-tab alerts cover every tracked team.
   */
  api.get("/alerts-feed", h(async (req) => {
    const s = season(req.query.season);
    const teams = teamList(req.query.teams, "teams", 200);
    const ph = teams.map(() => "?").join(",");
    const codes = await all<{ code: string }>(
      `SELECT DISTINCT mt.code FROM match_teams mt JOIN events e ON e.season = mt.season AND e.code = mt.code
       WHERE mt.season = ? AND mt.team IN (${ph}) AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`,
      [s, ...teams, new Date(Date.now() + 864e5).toISOString().slice(0, 10), new Date(Date.now() - 864e5).toISOString().slice(0, 10)],
    );
    const want = new Set(teams);
    const now = Date.now();
    const out = [];
    // Every active event is read (bounded by the 200-team cap: a team is at one
    // or two events in a ±1-day window), in parallel batches of 8.
    for (let i = 0; i < codes.length; i += 8) {
      const batch = await Promise.all(codes.slice(i, i + 8).map(({ code: c }) => matchViews({ season: s, code: c }, { predictUnplayed: true })));
      for (const m of batch.flat()) {
        if (![...m.red.teams, ...m.blue.teams].some((t) => want.has(t.number))) continue;
        const at = m.startsAt ? Date.parse(m.startsAt) : NaN;
        if (!Number.isFinite(at)) continue;
        if ((!m.played && at > now && at - now < 864e5) || (m.played && now - at < 6 * 3600_000)) out.push(m);
      }
    }
    return { season: s, matches: out };
  }));

  api.get("/events", h(async (req) => {
    // Events with a recording (the owner's stream or FIRST's YouTube link): stream: true, for the LIVE dot; and
    // what video there is to watch, for the list's video filter.
    const [streams, videos] = await Promise.all([seasonRecordings(season(req.query.season)).catch(() => new Map()), seasonVideoKinds(season(req.query.season)).catch(() => new Map())]);
    return {
    // The list view's fields only (detail pages use /events/:season/:code):
    // venue, division, region and remote aren't shown in lists.
    events: (await listEvents({
      season: season(req.query.season), from: req.query.from ? String(req.query.from) : undefined, to: req.query.to ? String(req.query.to) : undefined,
      q: req.query.q ? String(req.query.q).slice(0, 60) : undefined, type: req.query.type ? String(req.query.type) : undefined,
      region: req.query.region ? String(req.query.region) : undefined, hideNoMatch: req.query.all !== "1", limit: boundedCount(req.query.limit, "limit", 3000, 1, 3000),
    })).map(({ venue: _v, divisionCode: _d, region: _r, remote: _m, ...e }) => {
      const video = videos.get(e.code);
      return { ...e, ...(streams.has(e.code) ? { stream: true as const } : {}), ...(video ? { video } : {}) };
    }),
    };
  }));

  api.get("/events/:season/:code", h(async (req, res) => {
    const cached = await cachedEventDetail(season(req.params.season), code(req.params.code));
    if (!cached) throw new HttpError(404, `No event ${req.params.code} in ${req.params.season}`);
    const d = await withStream(cached);
    // On an event day results move every minute: revalidate every time (the ETag keeps that a cheap 304).
    if (d.live) res.setHeader("Cache-Control", "no-cache");
    return d;
  }));

  // "Refresh results" on an event that's on today: no login. One real check of FIRST per event
  // every 20 s (everyone else shares it), on top of the live fast lane's every-minute checks.
  api.post("/events/:season/:code/refresh", limiter(12), h(async (req): Promise<EventRefreshResult> => {
    const s = season(req.params.season), c = code(req.params.code);
    const out = await manualRefresh(s, c, { log: (m) => console.log(`[${new Date().toISOString()}] ${m}`) });
    if (out.status === "not-found") throw new HttpError(404, `No event ${c} in ${s}`);
    if (out.status === "not-live") throw new HttpError(409, "Only events that are on today (in their time zone) can be refreshed. Other events update with the regular sync.");
    const detail = await eventDetail(s, c);
    if (!detail) throw new HttpError(404, `No event ${c} in ${s}`);
    return { outcome: out.status, message: refreshMessage(out), detail: await withStream(detail) };
  }));

  api.get("/events/:season/:code/matches/:key", h(async (req) => {
    const key = String(req.params.key);
    if (!/^(qual|playoff):\d{1,3}:\d{1,4}$/.test(key)) throw new HttpError(400, "Match key looks like qual:0:12");
    const d = await matchDetail(season(req.params.season), code(req.params.code), key);
    if (!d) throw new HttpError(404, `No match ${key} at ${req.params.code}`);
    const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
    return rec ? { ...d, match: withClips([d.match], rec)[0] } : d;
  }));

  // Simulated rankings before quals start (projections/rankingSim.ts): run on a click, kept per data version.
  api.get("/events/:season/:code/simulated-rankings", h(async (req) => {
    const r = await simulatedRankings(season(req.params.season), code(req.params.code), perTeamOf(req.query.perTeam));
    if (!r) throw new HttpError(404, `No event ${req.params.code} in ${req.params.season}`);
    return r;
  }));

  // Model vs field: where the model's rating order and the official seeding disagree most (api/disagreements.ts).
  // Rebuilt with the event detail, so it moves with every ranking change; revalidated on event days.
  api.get("/events/:season/:code/disagreements", h(async (req, res) => {
    const r = await eventDisagreements(season(req.params.season), code(req.params.code));
    if (!r) throw new HttpError(404, `No event ${req.params.code} in ${req.params.season}`);
    res.setHeader("Cache-Control", "no-cache");
    return r;
  }));

  // Official result changes the sync saw (first postings, score revisions, schedule moves): public data only.
  // Revalidated every time (a result can be corrected any minute; the ETag keeps it a cheap 304).
  api.get("/events/:season/:code/result-changes", h(async (req, res) => {
    const r = await resultChanges(season(req.params.season), code(req.params.code));
    if (!r) throw new HttpError(404, `No event ${req.params.code} in ${req.params.season}`);
    res.setHeader("Cache-Control", "no-cache");
    return r;
  }));
  api.get("/events/:season/:code/matches/:key/result-changes", h(async (req, res) => {
    const key = String(req.params.key);
    if (!/^(qual|playoff):\d{1,3}:\d{1,4}$/.test(key)) throw new HttpError(400, "Match key looks like qual:0:12");
    const r = await resultChanges(season(req.params.season), code(req.params.code), key);
    if (!r) throw new HttpError(404, `No match ${key} at ${req.params.code}`);
    res.setHeader("Cache-Control", "no-cache");
    return r;
  }));

  // "Know your match" (v1.6 Task 2): the lineup's OPR, trend and data flags in one request (the
  // workspace's consensus comes from /api/scout/workspaces/:id/match-report, members only).
  api.get("/events/:season/:code/matches/:key/report", h(async (req, res) => {
    const key = String(req.params.key);
    if (!REPORT_KEY.test(key)) throw new HttpError(400, "Match key looks like qual:0:12");
    const r = await matchReport(season(req.params.season), code(req.params.code), key);
    if (!r) throw new HttpError(404, `No match ${key} at ${req.params.code}`);
    // On an event day the lineup's numbers move with every result: revalidate (the ETag keeps it a 304).
    if (r.live) res.setHeader("Cache-Control", "no-cache");
    return r;
  }));

  api.get("/compare", h(async (req) => {
    const numbers = teamList(req.query.teams, "teams", 4);
    // No season asked for: the latest season where any of them has results
    // (like the team page), not an empty current season.
    let s = season(req.query.season);
    if (!req.query.season && numbers.length) {
      const ph = numbers.map(() => "?").join(",");
      const r = await get<{ season: number | null }>(`SELECT MAX(season) season FROM team_season_stats WHERE team IN (${ph}) AND matches > 0`, numbers);
      if (r?.season) s = r.season;
    }
    return compareTeams(numbers, s);
  }));

  /** Many teams at once (shortlist, tracked teams): name, place, season stats, latest event. */
  api.get("/teams-summary", h(async (req) => ({ season: season(req.query.season), teams: await teamSummaries(teamList(req.query.teams, "teams", 100), season(req.query.season)) })));

  /** The shortlist page in one request: summaries plus each team's OPR split and event-by-event trend. */
  // Reliability index (src/shared/reliability.ts): public match data only, also read by Control Point.
  api.get("/reliability", h(async (req) => reliabilityMany(season(req.query.season), teamList(req.query.teams, "teams", 100))));
  api.get("/shortlist", h(async (req) => ({ season: season(req.query.season), teams: await shortlistTeams(teamList(req.query.teams, "teams", 100), season(req.query.season)) })));

  // --- Records: season stat tables with filters (src/shared/filterDsl.ts) --

  const recordsLimit = limiter(120), recordsCsvLimit = limiter(10);
  const records = (kind: "teams" | "matches") => [
    (req: Request, res: Response, next: NextFunction) => (req.query.format === "csv" ? recordsCsvLimit : recordsLimit)(req, res, next),
    h(async (req, res) => {
      const s = season(req.params.season);
      const scopeRaw = req.query.scope;
      if (kind === "matches" && scopeRaw != null) throw bad("scope applies to team records");
      if (scopeRaw != null && scopeRaw !== "event" && scopeRaw !== "season") throw bad("scope must be event (one row per team per event) or season (one row per team)");
      const scope = kind === "matches" ? "match" : scopeRaw === "season" ? "teamSeason" : "teamEvent";
      const format = req.query.format ?? "json";
      if (format !== "json" && format !== "csv") throw bad("format must be json or csv");
      try {
        const q = recordsQuery(scope, req.query as Record<string, unknown>, format === "csv" ? RECORDS_EXPORT_MAX : RECORDS_MAX_PAGE_SIZE);
        if (format === "csv") { await streamRecordsCsv(s, q, res, `control-scout-${s}-${kind}${scope === "teamSeason" ? "-season" : ""}.csv`); return undefined; }
        return await listRecords(s, q);
      } catch (e) {
        if (e instanceof FilterError || e instanceof RecordsQueryError) throw bad(e.message);
        // A CSV stream that fails part-way has already sent its headers: it's been cut off, nothing more to say.
        if (res.headersSent) { console.error("[api] records export", e); return undefined; }
        throw e;
      }
    }),
  ];
  /** Team records: ?scope=event (default, one row per team per event) or season. */
  api.get("/records/:season/teams", ...records("teams"));
  api.get("/records/:season/matches", ...records("matches"));
  /** The team directory: every team registered for a season, results or not (?country=, sort, dir, page). */
  api.get("/directory/:season", recordsLimit, h(async (req, res) => {
    const s = season(req.params.season);
    try {
      const page = await listDirectory(s, directoryQuery(req.query as Record<string, unknown>));
      noStoreWhileBehind(res, page.readiness.state);
      return page;
    }
    catch (e) { if (e instanceof DirectoryQueryError) throw bad(e.message); throw e; }
  }));
  /** The region codes a season's records use, named by their main place (for the Region dropdown). */
  api.get("/records/:season/regions", recordsLimit, h(async (req) => ({ regions: await recordRegions(season(req.params.season)) })));

  // --- World rankings (/rankings): every rated team, movement since last week -----

  const rankingsLimit = limiter(120);
  const rankingsQuery = async (req: Request): Promise<RankingsQuery> => {
    // No season asked for: the current one once anyone is rated in it, else the latest with ratings.
    const s = req.query.season == null || req.query.season === "" ? await defaultRankingsSeason() : predictSeason(req.query.season);
    const week = req.query.week == null || req.query.week === "" ? null : String(req.query.week);
    if (week != null) {
      if (!isWeek(week)) throw bad("week: a Monday, as YYYY-MM-DD");
      if (!(await snapshotWeeks(s)).includes(week)) throw new HttpError(404, `No rankings snapshot for the week of ${week} in ${seasonInfo(s).label}`);
    }
    // ?region=USA:TX,Canada (or repeated ?region=…: Express gives an array, joined the same way).
    const places = parsePlaces(req.query.region == null ? null : String(req.query.region));
    if (!places) throw bad(`region: up to ${MAX_REGIONS} places, comma-separated: a country as FIRST names it (USA) or a country and state code (USA:TX)`);
    const page = req.query.page == null || req.query.page === "" ? 1 : int(req.query.page, "page", { min: 1, max: 10_000 });
    return { season: s, week, places, page };
  };
  /** One page of the world ranking (src/shared/rankings.ts). Cached per data version with an ETag: a repeat is a 304. */
  api.get("/rankings", rankingsLimit, h(async (req, res) => {
    const { body, etag } = await rankingsPage(await rankingsQuery(req));
    res.setHeader("ETag", etag);
    if (req.fresh) { res.status(304).end(); return undefined; }
    res.type("application/json").send(body);
    return undefined;
  }));
  /** The places with ranked teams (for the region filter), the snapshot weeks, and ?team='s place ("My region"). */
  api.get("/rankings/places", rankingsLimit, h(async (req) => {
    const s = req.query.season == null || req.query.season === "" ? await defaultRankingsSeason() : predictSeason(req.query.season);
    const team = req.query.team == null || req.query.team === "" ? null : int(req.query.team, "team", { min: 1, max: 999999 });
    return rankingPlaces(s, team);
  }));

  // --- Predictions ---------------------------------------------------------

  api.get("/predict/match", h(async (req): Promise<MatchExplanationView> => {
    const s = predictSeason(req.query.season);
    const red = teamList(req.query.red, "red", 3), blue = teamList(req.query.blue, "blue", 3);
    if (red.some((t) => blue.includes(t))) throw bad("a team can't be on both alliances");
    // Qualification or playoff: feeds the contextual win probability. A
    // what-if with no level is treated as a qualification match.
    const lv = req.query.level;
    if (lv != null && lv !== "qual" && lv !== "playoff") throw bad("level must be qual or playoff");
    const level = lv === "playoff" ? "playoff" : "qual";
    const f = await liveForecaster(s);
    const x = f.explain(s, red, blue, level, undefined, await recentRecords(s, [...red, ...blue]));
    if (!x) throw new HttpError(503, "Ratings for this season aren't ready yet.");
    const names = new Map((await all<any>(`SELECT number, name FROM teams WHERE number IN (${[...red, ...blue].map(() => "?").join(",")})`, [...red, ...blue])).map((r) => [Number(r.number), r.name]));
    return {
      season: s, red, blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
      rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, rangeLevel: x.scoreBandA.level, factors: x.factors, history: x.partnership ? pairHistory(x.partnership) : null, confidence: x.confidence, reasons: x.reasons,
      teamsRed: x.teamsA.map((t) => ({ ...t, name: names.get(t.team) ?? null })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: names.get(t.team) ?? null })),
      level, probabilityModel: x.probabilityModel, bonus: bonusView(s, x) ?? null, engineVersion: ENGINE_VERSION,
    };
  }));

  // --- Share cards (server/share) ------------------------------------------

  /** A matchup's prediction as a PNG: 1200×630 (link previews) or ?format=square 1080×1080. */
  const shareLimit = limiter(30);
  api.get("/share/match.png", h(async (req, res) => {
    const s = predictSeason(req.query.season);
    const red = teamList(req.query.red, "red", 3), blue = teamList(req.query.blue, "blue", 3);
    if (red.some((t) => blue.includes(t))) throw bad("a team can't be on both alliances");
    const event = req.query.event != null && req.query.event !== "" ? code(req.query.event) : undefined;
    const match = req.query.match != null && req.query.match !== "" ? String(req.query.match) : undefined;
    if (match && !event) throw bad("match needs its event");
    if (match && !MATCH_KEY.test(match)) throw bad("match must be a match key like qual:1:12");
    const format = req.query.format ?? "landscape";
    if (format !== "landscape" && format !== "square") throw bad("format must be landscape or square");
    const q = { season: s, red, blue, event, match, format } as const;
    const key = await cardKey(q);
    // Only drawing a new card counts against the rate limit: a cached one costs nothing to send.
    if (!cachedCard(key)) {
      const allowed = await new Promise<boolean>((resolve) => { shareLimit(req, res, () => resolve(true)); if (res.headersSent) resolve(false); });
      if (!allowed) return undefined;
    }
    let card;
    try { card = await matchCard(key, q); } catch (e) {
      if (e instanceof ShareError) throw new HttpError(e.status, e.message);
      throw e;
    }
    // Same address, same data → same bytes: cache for a day, then revalidate by ETag (it moves on with the data).
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("ETag", card.etag);
    if (req.fresh) { res.status(304).end(); return undefined; }
    res.type("png").send(card.png);
    return undefined;
  }));

  api.get("/predict/upcoming", h(async (req) => {
    const s = predictSeason(req.query.season);
    const days = boundedCount(req.query.days, "days", 7, 1, 14);
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const evs = await all<{ code: string }>("SELECT DISTINCT m.code FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.played = 0 AND e.start <= ? AND COALESCE(e.end, e.start) >= ?", [s, until, today]);
    const out = [];
    for (const e of evs.slice(0, 40)) out.push(...(await matchViews({ season: s, code: e.code }, { predictUnplayed: true })).filter((m) => !m.played));
    return { season: s, matches: out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")).slice(0, 200) };
  }));

  const forecastFor = async (s: number, c: string, team: number | null, mode: ForecastView["mode"]): Promise<ForecastView> => {
    // Keyed by the ratings in use too: while new ones build, results from the previous ones aren't cached as the new data's.
    const v = await forecastMemo(`${await liveVersion(s)}|${s}|${c}|${team ?? ""}|${mode}`, async () => {
      const d = await eventDetail(s, c);
      if (!d) throw new HttpError(404, `No event ${c} in ${s}`);
      if (d.forecastUnsupported) throw new HttpError(422, d.forecastUnsupported);
      const f = await liveForecaster(s);
      const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
      const fc = mode === "pre-event" ? f.preEventForecast(ev, team, 2000) : f.forecast(ev, team, 2000);
      if (!fc) throw new HttpError(503, "Ratings for this season aren't ready yet.");
      const finished = d.event.status === "finished";
      // 2025+ games award bonus ranking points. The forecast says how its simulation drew them
      // (fc.bonusDraws: the bonus model it actually used, this event's recorded results, or none),
      // and the flag and any warning follow that one value, so they can't contradict the numbers
      // (a learned season model counts; a frozen "before the event" view with too little earlier
      // data doesn't). Official ranks (after quals) already include them.
      const bonusModelled = fc.bonusDraws !== "none";
      const explained = fc.assumptions.some((a) => /bonus ranking point/i.test(a));
      const assumptions = bonusModelled || explained ? fc.assumptions
        : [...fc.assumptions, `Bonus ranking points for ${seasonInfo(s).game} aren't modelled for this forecast (no bonus model from results so far), so simulated ranks count win/tie points only — real ranks and the odds that depend on them may differ.`];
      return {
        ...fc, assumptions, bonusModelled, eventName: d.event.name, eventStart: d.event.start, eventEnd: d.event.end, myTeam: team, engineVersion: ENGINE_VERSION, mode,
        hindsightNote: mode === "current" && finished ? "This event is over: these odds use ratings that already include its results. Switch to “Before the event” for the forecast made without hindsight." : null,
      };
    });
    return v!;
  };

  api.get("/predict/event", limiter(30), h(async (req) => {
    const s = predictSeason(req.query.season), c = code(req.query.code);
    const team = req.query.team ? int(req.query.team, "team", { min: 1, max: 999999 }) : null;
    return forecastFor(s, c, team, req.query.mode === "pre-event" ? "pre-event" : "current");
  }));

  api.get("/predict/partners", limiter(10), h(async (req) => {
    const s = predictSeason(req.query.season), c = code(req.query.code), team = int(req.query.team, "team", { min: 1, max: 999999 });
    // mode=pre-event: the scenarios from the ratings and event as they stood the day before (no hindsight).
    const pre = req.query.mode === "pre-event";
    return partnersMemo(`${await liveVersion(s)}|${s}|${c}|${team}|${pre ? "pre-event" : "current"}`, async () => {
      const d = await eventDetail(s, c);
      if (!d) throw new HttpError(404, `No event ${c} in ${s}`);
      if (d.forecastUnsupported) throw new HttpError(422, d.forecastUnsupported);
      if (!d.field.some((x) => x.team === team)) throw new HttpError(422, `Team ${team} isn't registered for ${c}`);
      const f = await liveForecaster(s);
      const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
      if (pre && !ev.start) throw new HttpError(422, `${c} has no start date, so there's no before-the-event view of it.`);
      const p = pre ? await f.preEventPartners(ev, team) : await f.partners(ev, team);
      if (!p) throw new HttpError(503, "Ratings for this season aren't ready yet.");
      return p;
    });
  }));

  api.get("/predict/accuracy", h(async () => trackRecord()));

  // Monte Carlo projections (server/projections): stored by the background job, only read here.
  api.get("/projections/:season/:code", h(async (req, res) => {
    const v = await readProjections(predictSeason(req.params.season), code(req.params.code));
    // A new run can land any minute while the event is on: revalidate every time (the ETag keeps it a 304).
    res.setHeader("Cache-Control", "no-cache");
    return v;
  }));
  api.get("/projections/:season/:code/stream", h(async (req, res) => {
    const s = predictSeason(req.params.season), c = code(req.params.code);
    if (!(await isEnabled("realtime"))) { res.setHeader("Cache-Control", "no-store"); throw new HttpError(503, "Live updates are switched off; the page refreshes on its own instead."); }
    projectionStream(s, c, req, res);
    return undefined;
  }));

  api.use("/auth", authRouter());
  api.use("/me", meRouter());
  // Entry photos (docs/r2-photos.md): 404 throughout unless R2 is configured and the photos switch is on.
  api.use("/scout/photos", photosRouter());
  api.use("/scout", scoutRouter());
  api.use("/scout", templateRouter());
  // Workspace entries as CSV (Task 18): streamed, members only. Per IP, and a team at an event often shares one.
  api.use("/scout", exportRouter(limiter(30)));
  api.use("/scout", settingsRouter());
  api.use("/scout", activityRouter());
  // Entry version history (Task 16): members only.
  api.use("/scout", historyRouter());
  api.use("/scout", membersRouter());
  api.use("/scout", picklistRouter());
  api.use("/scout", assignmentsRouter());
  api.use("/scout", commentsRouter());
  // Scout consensus (v1.6 Task 1): a workspace's entries on a team rolled up; members only.
  api.use("/scout", consensusRouter());
  // The pre-match report's workspace half (v1.6 Task 2): consensus, pick list and assignments; members only.
  api.use("/scout", matchReportRouter());
  // The owner portal's switches: with realtime off the stream answers 503 and the app polls instead; with
  // workspace scouting off it answers 503 too, since a stream's catch-up reads shared entries like a pull.
  api.use("/scout", streamRouter({ enabled: async () => (await isEnabled("realtime")) && (await isEnabled("workspaceScouting")) }));
  // The notification inbox (docs/inbox.md): per account, across workspaces. Its stream follows the realtime switch only
  // (owner alerts aren't workspace scouting); while it's off the app polls the unread count.
  api.use("/inbox", inboxRouter({ streamEnabled: () => isEnabled("realtime") }));
  // Web push (docs/push.md): this device's subscription for the signed-in account. Per IP, so a loop can't churn rows.
  api.use("/push", limiter(30), pushRouter());
  api.use("/collect", collectRouter());
  api.use("/stats", statsRouter());
  api.use("/contact", contactRouter());
  api.use("/reports", reportsRouter());
  api.use("/owner", ownerRouter());

  api.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  app.use("/api", api);
  app.use("/packs", packsRouter());
  // The sitemap, from the database (server/sitemap.ts).
  app.get("/sitemap.xml", h(sitemapRoute));
  app.get("/sitemap-:n.xml", h(sitemapChunkRoute));
  // IndexNow's key file, /<key>.txt (server/indexNow.ts): any other name goes on to the 404.
  app.get(/^\/[A-Za-z0-9-]{8,128}\.txt$/, indexNowKeyRoute);

  // Built web app (production): static files with long cache for hashed assets.
  const dist = join(process.cwd(), "dist");
  if (existsSync(join(dist, "index.html"))) {
    app.use("/assets", express.static(join(dist, "assets"), { immutable: true, maxAge: "1y" }));
    // The service worker and its file list must never be served stale.
    for (const f of ["sw.js"]) app.get(`/${f}`, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(join(dist, f)); });
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    // The app's HTML, with the page's canonical link in the first response (crawlers don't run JS).
    // A missing file (anything with an extension) is an honest 404, never the app's HTML with a 200.
    app.get(MISSING_FILE, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.status(404).type("text/plain").send("Not found"); });
    // A path that isn't an app page (unknown route, team or event) is a 404 that still carries the
    // app's HTML, so the visitor sees the app's own not-found page (and search engines drop the URL).
    app.get(/^(?!\/api\/|\/packs\/).*/, h(async (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      // The query names the page's view: rankings filters, a shared matchup (its card is the link preview).
      const page = await renderPage(join(dist, "index.html"), req.path, req.query as Record<string, unknown>);
      res.status(page.status).type("html").send(page.html);
    }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? "Something went wrong on our side." : (err as Error).message });
  });
  return app;
}

