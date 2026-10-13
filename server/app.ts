// HTTP API. Browsing, search and predictions need no account, ever; only
// /api/me/* (personal data) does.
import express, { type NextFunction, type Request, type Response } from "express";
import compression from "compression";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION, FITTED_MODEL } from "@control-scout/predict-engine";
import { all, kvGet } from "./db.js";
import { hasFirst } from "./env.js";
import { CURRENT_SEASON, SEASONS, SEASON_NUMBERS, seasonInfo } from "./data/seasons.js";
import { ensureSearchIndex, search } from "./api/search.js";
import { rebuildSearch } from "./stats/job.js";
import { teamProfile, compareTeams, teamSummaries } from "./api/teams.js";
import { eventDetail, listEvents, toEventInput } from "./api/events.js";
import { matchViews } from "./api/matches.js";
import { trackRecord } from "./api/accuracy.js";
import { forecasterFor, dataVersion } from "./predict/engine.js";
import { authRouter, meRouter, authProviders } from "./auth/routes.js";
import { packsRouter } from "./packs/routes.js";
import type { ForecastView, MatchExplanationView, Meta } from "../src/shared/api.js";

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
const season = (x: unknown) => {
  if (x == null || x === "") return CURRENT_SEASON;
  const s = int(x, "season", { min: 2000, max: 2100 });
  if (!SEASON_NUMBERS.includes(s)) throw new HttpError(404, `Season ${s} isn't covered (we hold ${SEASON_NUMBERS.join(", ")})`);
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
  return async (key: string, fn: () => Promise<T>): Promise<T> => {
    const k = `${await dataVersion()}|${key}`;
    const hit = m.get(k);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    const v = fn();
    m.set(k, { at: Date.now(), v });
    v.catch(() => m.delete(k));
    if (m.size > 500) m.delete(m.keys().next().value!);
    return v;
  };
}
const forecastMemo = memo<ForecastView | null>(120_000);
const partnersMemo = memo<unknown>(120_000);

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  api.get("/health", h(async () => ({ ok: true, engine: ENGINE_VERSION })));

  api.get("/meta", h(async (): Promise<Meta> => {
    const rows = await all<any>("SELECT season, frozen, last_sync FROM seasons");
    const sync = await kvGet<{ at: string }>("sync:last");
    const stats = await kvGet<{ at: string }>("stats:last");
    return {
      seasons: SEASONS.map((s) => { const r = rows.find((x) => Number(x.season) === s.season); return { ...s, frozen: !!r?.frozen, lastSync: r?.last_sync ?? null }; }).reverse(),
      currentSeason: CURRENT_SEASON, engineVersion: ENGINE_VERSION, dataAsOf: sync?.at ?? null, statsAt: stats?.at ?? null,
      auth: authProviders(), firstConfigured: hasFirst(),
    };
  }));

  api.get("/search", h(async (req) => {
    await ensureSearchIndex(rebuildSearch);
    return { q: String(req.query.q ?? ""), hits: await search(String(req.query.q ?? "").slice(0, 80), Math.min(25, Number(req.query.limit) || 12)) };
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
    for (const { code: c } of codes.slice(0, 50)) {
      for (const m of await matchViews({ season: s, code: c }, { predictUnplayed: true })) {
        if (![...m.red.teams, ...m.blue.teams].some((t) => want.has(t.number))) continue;
        const at = m.startsAt ? Date.parse(m.startsAt) : NaN;
        if (!Number.isFinite(at)) continue;
        if ((!m.played && at > now && at - now < 864e5) || (m.played && now - at < 6 * 3600_000)) out.push(m);
      }
    }
    return { season: s, matches: out };
  }));

  api.get("/events", h(async (req) => ({
    events: await listEvents({
      season: season(req.query.season), from: req.query.from ? String(req.query.from) : undefined, to: req.query.to ? String(req.query.to) : undefined,
      q: req.query.q ? String(req.query.q).slice(0, 60) : undefined, type: req.query.type ? String(req.query.type) : undefined,
      region: req.query.region ? String(req.query.region) : undefined, hideNoMatch: req.query.all !== "1", limit: Math.min(3000, Number(req.query.limit) || 3000),
    }),
  })));

  api.get("/events/:season/:code", h(async (req) => {
    const d = await eventDetail(season(req.params.season), code(req.params.code));
    if (!d) throw new HttpError(404, `No event ${req.params.code} in ${req.params.season}`);
    return d;
  }));

  api.get("/compare", h(async (req) => compareTeams(teamList(req.query.teams, "teams", 4), season(req.query.season))));

  /** Many teams at once (shortlist, tracked teams): name, place, season stats, latest event. */
  api.get("/teams-summary", h(async (req) => ({ season: season(req.query.season), teams: await teamSummaries(teamList(req.query.teams, "teams", 100), season(req.query.season)) })));

  // --- Predictions ---------------------------------------------------------

  api.get("/predict/match", h(async (req): Promise<MatchExplanationView> => {
    const s = season(req.query.season);
    const red = teamList(req.query.red, "red", 3), blue = teamList(req.query.blue, "blue", 3);
    if (red.some((t) => blue.includes(t))) throw bad("a team can't be on both alliances");
    const f = await forecasterFor(s);
    const x = f.explain(s, red, blue);
    if (!x) throw new HttpError(503, "Ratings for this season aren't ready yet.");
    const names = new Map((await all<any>(`SELECT number, name FROM teams WHERE number IN (${[...red, ...blue].map(() => "?").join(",")})`, [...red, ...blue])).map((r) => [Number(r.number), r.name]));
    return {
      season: s, red, blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
      rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, factors: x.factors, confidence: x.confidence,
      teamsRed: x.teamsA.map((t) => ({ ...t, name: names.get(t.team) ?? null })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: names.get(t.team) ?? null })),
      engineVersion: ENGINE_VERSION,
    };
  }));

  api.get("/predict/upcoming", h(async (req) => {
    const s = season(req.query.season);
    const days = Math.min(14, Number(req.query.days) || 7);
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const evs = await all<{ code: string }>("SELECT DISTINCT m.code FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.played = 0 AND e.start <= ? AND COALESCE(e.end, e.start) >= ?", [s, until, today]);
    const out = [];
    for (const e of evs.slice(0, 40)) out.push(...(await matchViews({ season: s, code: e.code }, { predictUnplayed: true })).filter((m) => !m.played));
    return { season: s, matches: out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")).slice(0, 200) };
  }));

  const forecastFor = async (s: number, c: string, team: number | null, mode: ForecastView["mode"]): Promise<ForecastView> => {
    const v = await forecastMemo(`${s}|${c}|${team ?? ""}|${mode}`, async () => {
      const d = await eventDetail(s, c);
      if (!d) throw new HttpError(404, `No event ${c} in ${s}`);
      if (d.forecastUnsupported) throw new HttpError(422, d.forecastUnsupported);
      const f = await forecasterFor(s);
      const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
      const fc = mode === "pre-event" ? f.preEventForecast(ev, team, 2000) : f.forecast(ev, team, 2000);
      if (!fc) throw new HttpError(503, "Ratings for this season aren't ready yet.");
      const finished = d.event.status === "finished";
      // 2025+ games award bonus ranking points; without a fitted model for this
      // season the simulator can't include them — say so instead of hiding it.
      const bonusModelled = s < 2025 || !!FITTED_MODEL.bonus[String(s)];
      const assumptions = bonusModelled ? fc.assumptions : [...fc.assumptions, `Bonus ranking points for ${seasonInfo(s).game} aren't modelled yet (no fitted model for this season), so simulated ranks count win/tie points only — real ranks and the odds that depend on them may differ.`];
      return {
        ...fc, assumptions, bonusModelled, eventName: d.event.name, eventStart: d.event.start, eventEnd: d.event.end, myTeam: team, engineVersion: ENGINE_VERSION, mode,
        hindsightNote: mode === "current" && finished ? "This event is over: these odds use ratings that already include its results. Switch to “Before the event” for the forecast made without hindsight." : null,
      };
    });
    return v!;
  };

  api.get("/predict/event", limiter(30), h(async (req) => {
    const s = season(req.query.season), c = code(req.query.code);
    const team = req.query.team ? int(req.query.team, "team", { min: 1, max: 999999 }) : null;
    return forecastFor(s, c, team, req.query.mode === "pre-event" ? "pre-event" : "current");
  }));

  api.get("/predict/partners", limiter(10), h(async (req) => {
    const s = season(req.query.season), c = code(req.query.code), team = int(req.query.team, "team", { min: 1, max: 999999 });
    return partnersMemo(`${s}|${c}|${team}`, async () => {
      const d = await eventDetail(s, c);
      if (!d) throw new HttpError(404, `No event ${c} in ${s}`);
      if (d.forecastUnsupported) throw new HttpError(422, d.forecastUnsupported);
      if (!d.field.some((x) => x.team === team)) throw new HttpError(422, `Team ${team} isn't registered for ${c}`);
      const f = await forecasterFor(s);
      const p = await f.partners(toEventInput(d.event, d.field, d.matches, d.alliances), team);
      if (!p) throw new HttpError(503, "Ratings for this season aren't ready yet.");
      return p;
    });
  }));

  api.get("/predict/accuracy", h(async () => trackRecord()));

  api.use("/auth", authRouter());
  api.use("/me", meRouter());

  api.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  app.use("/api", api);
  app.use("/packs", packsRouter());

  // Built web app (production): static files with long cache for hashed assets.
  const dist = join(process.cwd(), "dist");
  if (existsSync(join(dist, "index.html"))) {
    app.use("/assets", express.static(join(dist, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/|\/packs\/).*/, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(join(dist, "index.html")); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? "Something went wrong on our side." : (err as Error).message });
  });
  return app;
}

