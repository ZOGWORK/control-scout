// Answer an API GET from the seasons saved on this device, when the server
// can't be reached. api.ts loads this lazily, and only once a request has
// failed for want of a network and some season is saved.
//
// Unplayed matches get win odds from the lite pack (same engine, ratings as of
// its build), like the what-if lab offline; played ones show none.
import { FITTED_MODEL, RatingBook, explainMatch } from "@control-scout/predict-engine";
import type { EventDetail, MatchView, SearchHit, TeamProfile } from "../../shared/api";
import { loadLite, type LitePack } from "../packs";
import { markOffline, savedSeasons, type OfflineSource } from "./saved";
import { readSaved } from "./seasons";
import { readEventDetail, readMatchViews, readSearch, readTeamProfile, type ReadOpts } from "./readers";

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
    predict: (season, red, blue, level, event) => {
      const b = book(season);
      if (!b) return null;
      const x = explainMatch(b, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level, event } });
      return {
        pRed: x.winProbA, redMean: x.predictedScoreA, blueMean: x.predictedScoreB, tier: x.confidence.tier, kind: "now", predictedAt: new Date().toISOString(), factors: x.factors,
        // No rated match this season yet (the server's noScoreBasis): win odds stand, the predicted score doesn't.
        ...(b.baseline() ? {} : { noScoreBasis: true as const }),
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

export async function offlineEventDetail(season: number, code: string): Promise<EventDetail | null> {
  const src = source(season);
  if (!src) return null;
  const opts = await liteOpts();
  const d = await readSaved(season, ([sdb]) => (sdb ? readEventDetail(sdb, code.toUpperCase(), opts) : null));
  return d ? markOffline(d, src) : null;
}

export async function offlineSearch(q: string, limit = 15, prefer: ReadonlySet<string> = new Set()): Promise<{ q: string; hits: SearchHit[] } | null> {
  return readSaved(undefined, (dbs) => {
    const src = dbs[0] && source(dbs[0].season);
    return src ? markOffline({ q, hits: readSearch(dbs, q.slice(0, 80), limit, prefer) }, src) : null;
  });
}

const int = (s: string | null) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

/** The offline answer for an API path, or null when the saved seasons can't answer it. */
export async function offlineAnswer(path: string): Promise<unknown | null> {
  const url = new URL(path, "http://offline.invalid");
  const season = int(url.searchParams.get("season"));
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/teams\/(\d{1,6})$/.exec(url.pathname))) return offlineTeamProfile(Number(m[1]), season);
  if ((m = /^\/api\/teams\/(\d{1,6})\/matches$/.exec(url.pathname))) return offlineTeamMatches(Number(m[1]), season);
  if ((m = /^\/api\/events\/(\d{4})\/([^/]+)$/.exec(url.pathname))) return offlineEventDetail(Number(m[1]), decodeURIComponent(m[2]));
  if (url.pathname === "/api/search") {
    const prefer = new Set((url.searchParams.get("prefer") ?? "").split(",").filter(Boolean));
    return offlineSearch(url.searchParams.get("q") ?? "", Math.min(25, int(url.searchParams.get("limit")) || 12), prefer);
  }
  return null;
}
