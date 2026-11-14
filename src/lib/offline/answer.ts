// Answer an API GET from the seasons saved on this device, when the server
// can't be reached. api.ts loads this lazily, and only once a request has
// failed for want of a network and some season is saved.
//
// Unplayed matches get win odds from the lite pack (same engine, ratings as of
// its build), like the what-if lab offline; played ones show none.
import { FITTED_MODEL, RatingBook, explainMatch } from "@control-scout/predict-engine";
import type { EventDetail, MatchView, SearchHit, TeamProfile, TeamScheduleAnswer } from "../../shared/api";
import type { ProjectionsView } from "../../shared/projections";
import { loadLite, type LitePack } from "../packs";
import { partnershipFor } from "./partnerships";
import { pairHistory } from "../../shared/pairHistory";
import { rangesOf } from "../../shared/scoreRange";
import { compactSheet } from "../../shared/factorSheet";
import { markOffline, savedSeasons, type OfflineSource } from "./saved";
import { readSaved } from "./seasons";
import { bundleFor, bundlesWith, savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";
import { bundleTime, packLookup, type EventBundle, type SavedBundle } from "../../shared/eventBundle";
import { compareFromPacks } from "../../shared/compare";
import type { CompareView } from "../../shared/api";
import { readEventDetail, readMatchViews, readProjections, readSearch, readTeamProfile, readTeamSchedule, type ReadOpts } from "./readers";
import { packSearchAnswer, packTeamSummaries } from "./search";

let books: { pack: LitePack | null; bySeason: Map<number, RatingBook | null> } | null = null;

/** Ratings from the lite pack, one book per season (rebuilt when the pack changes). */
async function liteOpts(): Promise<ReadOpts> {
  const pack = await loadLite().catch(() => null);
  if (books?.pack !== pack) books = { pack, bySeason: new Map() };
  const cache = books.bySeason;
  const book = (season: number) => {
    if (!cache.has(season)) {
      const data = pack?.books[String(season)];
      const b = data ? RatingBook.fromData(data) : null;
      b?.setTime(Date.now());
      cache.set(season, b);
    }
    return cache.get(season)!;
  };
  return {
    rating: (season, team) => {
      const b = book(season);
      if (!b?.ratings.has(team)) return null;
      const rt = b.get(team);
      return { np: Math.round((rt.auto + rt.teleop + rt.endgame) * 10) / 10, sd: Math.round(Math.sqrt(rt.uncertainty) * 10) / 10, matches: rt.n };
    },
    predict: (season, red, blue, level, event, region) => {
      const b = book(season);
      if (!b) return null;
      const x = explainMatch(b, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level, event, ...(region ? { region } : {}) }, band: FITTED_MODEL.band, partnership: partnershipFor(pack, season) });
      return {
        pRed: x.winProbA, redMean: x.predictedScoreA, blueMean: x.predictedScoreB, tier: x.confidence.tier, kind: "now", predictedAt: new Date().toISOString(), factors: x.factors, ...(x.partnership ? { history: pairHistory(x.partnership) } : {}),
        // The full why breakdown, as the match page shows it online (the lite pack runs the same engine).
        sheet: compactSheet(x.factorSheet),
        // No rated match this season yet (the server's noScoreBasis): win odds stand, the predicted score doesn't.
        ...(b.baseline() ? rangesOf(x) : { noScoreBasis: true as const }),
      };
    },
  };
}

function source(season: number): OfflineSource | null {
  const s = savedSeasons().find((x) => x.season === season);
  return s ? { season, savedAt: s.savedAt, dataAsOf: s.dataAsOf } : null;
}

// Pages for one season open only that season's file; profiles and search read every saved season.
export async function offlineTeamProfile(number: number, season?: number): Promise<TeamProfile | null> {
  const p = await readSaved(undefined, (dbs) => readTeamProfile(dbs, number, season));
  const src = p && source(p.season);
  return p && src ? markOffline(p, src) : null;
}

export async function offlineTeamMatches(number: number, season?: number): Promise<{ team: number; season: number; matches: MatchView[] } | null> {
  const s = season ?? savedSeasons()[0]?.season;
  const src = s != null ? source(s) : null;
  if (s == null || !src) return null;
  const opts = await liteOpts();
  return readSaved(s, ([sdb]) => (sdb ? markOffline({ team: number, season: s, matches: readMatchViews(sdb, { team: number }, opts) }, src) : null));
}

/** A team's schedule difficulty from its saved season pack (the team page's collapsed section). */
export async function offlineTeamSchedule(number: number, season?: number): Promise<TeamScheduleAnswer | null> {
  const s = season ?? savedSeasons()[0]?.season;
  const src = s != null ? source(s) : null;
  if (s == null || !src) return null;
  return readSaved(s, ([sdb]) => (sdb ? markOffline({ team: number, season: s, schedule: readTeamSchedule(sdb, number) }, src) : null));
}

export async function offlineEventDetail(season: number, code: string): Promise<EventDetail | null> {
  // An event-day bundle for this event is usually newer than the saved season (it's made the morning of the
  // event): the newer of the two answers.
  const b = bundleFor(season, code);
  const src = source(season);
  if (b && (!src || bundleTime(b) >= (src.dataAsOf ?? new Date(src.savedAt).toISOString()))) {
    const fromBundle = await bundleEventDetail(season, code);
    if (fromBundle) return fromBundle;
  }
  if (!src) return null;
  const opts = await liteOpts();
  const d = await readSaved(season, ([sdb]) => (sdb ? readEventDetail(sdb, code.toUpperCase(), opts) : null));
  return d ? markOffline(d, src) : null;
}

/** The event page from its event-day bundle: the server's own answer as of the bundle, marked with its time. */
async function bundleEventDetail(season: number, code: string): Promise<EventDetail | null> {
  const meta = bundleFor(season, code);
  const bundle = meta && await loadBundle(season, code);
  if (!meta || !bundle) return null;
  // A copy: the mark goes on the answer, never on the decoded bundle other reads share.
  return markOffline({ ...bundle.event }, { season, savedAt: meta.savedAt, dataAsOf: meta.dataAsOf, bundle: { builtAt: meta.builtAt, name: meta.name } });
}

/** An event's stored projections from its saved season pack (they're as of the pack's build). */
export async function offlineProjections(season: number, code: string): Promise<ProjectionsView | null> {
  const src = source(season);
  if (!src) return null;
  const v = await readSaved(season, ([sdb]) => (sdb ? readProjections(sdb, code.toUpperCase()) : null));
  return v ? markOffline(v, src) : null;
}

export async function offlineSearch(q: string, limit = 15, prefer: ReadonlySet<string> = new Set(), kinds?: ReadonlySet<SearchHit["kind"]>): Promise<{ q: string; hits: SearchHit[] } | null> {
  return readSaved(undefined, (dbs) => {
    const src = dbs[0] && source(dbs[0].season);
    return src ? markOffline({ q, hits: readSearch(dbs, q.slice(0, 80), limit, prefer, kinds) }, src) : null;
  });
}

const int = (s: string | null) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

/** What the saved data says instead of an answer: the server's own error the pack recorded (404 for a team with no
 *  page), or a plain "not in your pack" (status 0) for a read it can't make. lib/api.ts shows it as the error. */
export class OfflineAnswerError extends Error {
  readonly offlineAnswer = true;
  constructor(readonly status: number, message: string) { super(message); }
}

const bundleSource = (b: SavedBundle): OfflineSource => ({ season: b.season, savedAt: b.savedAt, dataAsOf: b.dataAsOf, bundle: { builtAt: b.builtAt, name: b.name } });

/** A saved season's data is newer than this bundle's (it answers first then). */
function seasonNewer(b: SavedBundle): boolean {
  const src = source(b.season);
  return !!src && (src.dataAsOf ?? new Date(src.savedAt).toISOString()) > bundleTime(b);
}

/** The server's own answer for this path from a saved event pack (newest first), or null when none holds it.
 *  `skipOlder`: leave out packs older than the saved season (that answers first; they're its fallback). */
export async function packAnswer(path: string, skipOlder = false): Promise<unknown | null> {
  for (const meta of bundlesWith(path)) {
    // Newest first: once one pack is older than the saved season, every later one is too, so the season answers
    // first (an older pack never wins over it).
    if (skipOlder && seasonNewer(meta)) return null;
    const bundle = await loadBundle(meta.season, meta.code);
    const got = packLookup(bundle?.api, path);
    if (!got) continue;
    if ("body" in got) {
      // A copy (structuredClone keeps the shape exactly): the offline mark goes on the answer, never on the decoded
      // bundle other reads share.
      const body = got.body;
      return body && typeof body === "object" ? markOffline(structuredClone(body) as object, bundleSource(meta)) : body;
    }
    throw new OfflineAnswerError(got.status, got.error);
  }
  return null;
}

/**
 * /api/compare from the saved event packs: each team's Compare column and season matches as the server gave them,
 * assembled by the same function the server uses (src/shared/compare.ts compareFromParts), so the numbers match.
 * A team in no saved pack: says so (OfflineAnswerError), never a partial comparison.
 */
export async function offlineCompare(numbers: number[], season?: number): Promise<CompareView | null> {
  const metas = savedBundles().filter((b) => b.apiPaths?.length);
  if (!metas.length) return null;
  const loaded = (await Promise.all(metas.map(async (meta) => ({ meta, bundle: await loadBundle(meta.season, meta.code) }))))
    .filter((x): x is { meta: SavedBundle; bundle: EventBundle } => !!x.bundle?.compare && !!x.bundle.api)
    .sort((a, b) => bundleTime(b.meta).localeCompare(bundleTime(a.meta)));
  const packs = loaded.map((x) => ({ season: x.meta.season, bundle: x.bundle }));
  const got = compareFromPacks(numbers, season, packs);
  if ("missing" in got) throw new OfflineAnswerError(0, got.missing);
  // Marked with the pack the comparison's first team came from: its name and data time.
  return markOffline(got.view, bundleSource(loaded[packs.findIndex((p) => p === got.from)].meta));
}

/** The offline answer for an API path, or null when the saved data can't answer it. Throws OfflineAnswerError
 *  when the saved data says the answer is an error (the server's 404, or a team not in the pack). */
export async function offlineAnswer(path: string): Promise<unknown | null> {
  const url = new URL(path, "http://offline.invalid");
  const season = int(url.searchParams.get("season"));
  if (url.pathname === "/api/compare") {
    const teams = (url.searchParams.get("teams") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!teams.length || teams.length > 4 || teams.some((t) => !/^\d{1,6}$/.test(t)) || new Set(teams).size !== teams.length) return null;
    return offlineCompare(teams.map(Number), season);
  }
  // A whole search answer: the packs' own (or a versus of their teams) first; else a saved season's plain hits, as
  // before; else what it needs that the packs don't hold (lib/offline/search.ts). The team cards' season numbers too.
  if (url.pathname === "/api/teams-summary") return packTeamSummaries(path);
  if (url.pathname === "/api/search" && url.searchParams.get("answer") === "1" && !url.searchParams.get("kinds")) {
    const fromPacks = await packSearchAnswer(path);
    if (fromPacks && !fromPacks.notInPack) return fromPacks;
    const hits = savedSeasons().length ? await seasonAnswer(path, url, season) as { hits?: unknown[] } | null : null;
    if (hits?.hits?.length) return hits;
    return fromPacks ?? hits;
  }
  // An event pack holds the server's own answer: it answers first, unless a saved season's data is newer (then it's
  // the fallback when the season can't answer).
  const fromPack = await packAnswer(path, true);
  if (fromPack != null) return fromPack;
  const fromSeason = await seasonAnswer(path, url, season);
  return fromSeason ?? packAnswer(path);
}

async function seasonAnswer(path: string, url: URL, season: number | undefined): Promise<unknown | null> {
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/teams\/(\d{1,6})$/.exec(url.pathname))) return offlineTeamProfile(Number(m[1]), season);
  if ((m = /^\/api\/teams\/(\d{1,6})\/matches$/.exec(url.pathname))) return offlineTeamMatches(Number(m[1]), season);
  if ((m = /^\/api\/teams\/(\d{1,6})\/schedule$/.exec(url.pathname))) return offlineTeamSchedule(Number(m[1]), season);
  if ((m = /^\/api\/events\/(\d{4})\/([^/]+)$/.exec(url.pathname))) return offlineEventDetail(Number(m[1]), decodeURIComponent(m[2]));
  if ((m = /^\/api\/projections\/(\d{4})\/([^/]+)$/.exec(url.pathname))) return offlineProjections(Number(m[1]), decodeURIComponent(m[2]));
  if (url.pathname === "/api/search") {
    const prefer = new Set((url.searchParams.get("prefer") ?? "").split(",").filter(Boolean));
    const kinds = new Set((url.searchParams.get("kinds") ?? "").split(",").filter((k): k is SearchHit["kind"] => k === "team" || k === "event" || k === "match" || k === "place"));
    return offlineSearch(url.searchParams.get("q") ?? "", Math.min(25, int(url.searchParams.get("limit")) || 12), prefer, kinds);
  }
  return null;
}
