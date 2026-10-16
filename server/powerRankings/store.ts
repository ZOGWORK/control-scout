// The published power-rankings weeks (content/power-rankings/*.md, format: ./format.ts) and the
// views the API, the page head and the sitemap build from them: each entry with the team's live
// numbers and its movement against the previous week.
//
// Files are read when they change (a deploy adds one): the directory is checked on use, and a
// file that doesn't validate is left out with its errors logged (CI's test refuses it first:
// powerRankings.content.test.ts). A week shows from its `published` date (UTC) on.
//
// Development only (POWER_RANKINGS_SAMPLE=1, never in production: server/env.ts), the sample
// weeks in content/power-rankings-sample are served instead, marked SAMPLE on the page.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { all } from "../db.js";
import { env } from "../env.js";
import { registerCache } from "../caches.js";
import { droppedOut, movements, parseRankings, type RankingDoc } from "./format.js";
import { markdownText, renderMarkdown } from "./markdown.js";
import type { PowerRankingsEntry, PowerRankingsResponse, PowerRankingsStats, PowerRankingsSummary, PowerRankingsWeek } from "../../src/shared/powerRankings.js";

export const CONTENT_DIR = fileURLToPath(new URL("../../content/power-rankings", import.meta.url));
export const SAMPLE_DIR = fileURLToPath(new URL("../../content/power-rankings-sample", import.meta.url));

/** A week file's name: the week id and .md (anything else in the directory is ignored). */
export const WEEK_FILE = /^\d{4}-w\d{2}\.md$/;

export interface LoadedWeeks { docs: RankingDoc[]; errors: { file: string; errors: string[] }[] }

/**
 * Every week file in `dir`, validated, oldest first. `sample`: the directory holds sample weeks
 * (each must say `sample: true`); the real directory may hold none.
 */
export function loadDir(dir: string, sample: boolean): LoadedWeeks {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => WEEK_FILE.test(f)).sort(); } catch { /* no directory: no weeks */ }
  const docs: RankingDoc[] = [];
  const errors: LoadedWeeks["errors"] = [];
  for (const f of files) {
    const r = parseRankings(readFileSync(join(dir, f), "utf8"), f);
    if (!r.ok) { errors.push({ file: f, errors: r.errors }); continue; }
    if (r.doc.sample !== sample) {
      errors.push({ file: f, errors: [sample ? "a file in the sample directory must say `sample: true`" : "`sample: true` files belong in content/power-rankings-sample, never with the published weeks"] });
      continue;
    }
    docs.push(r.doc);
  }
  return { docs, errors };
}

// The parsed files, kept until one changes (names, sizes and times).
let cache: { key: string; loaded: LoadedWeeks } | null = null;
const signature = (dir: string) => {
  try {
    return readdirSync(dir).filter((f) => WEEK_FILE.test(f)).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.size}:${s.mtimeMs}`; }).join("|");
  } catch { return "-"; }
};
let override: { dir: string; sample: boolean } | null = null;
/** Tests: read weeks from this directory (null: back to the configured one). */
export function useContentDir(dir: string | null, sample = false) { override = dir ? { dir, sample } : null; cache = null; viewCache.clear(); }

function source() {
  if (override) return override;
  return env.powerRankingsSample ? { dir: SAMPLE_DIR, sample: true } : { dir: CONTENT_DIR, sample: false };
}

function loaded(): LoadedWeeks {
  const { dir, sample } = source();
  const key = `${dir}|${signature(dir)}`;
  if (cache?.key !== key) {
    const l = loadDir(dir, sample);
    for (const e of l.errors) console.warn(`[power-rankings] ${e.file} left out:\n  ${e.errors.join("\n  ")}`);
    cache = { key, loaded: l };
    viewCache.clear();
  }
  return cache.loaded;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The weeks visitors can see (published on or before `on`), oldest first. */
export function publishedWeeks(on = today()): RankingDoc[] {
  return loaded().docs.filter((d) => d.published <= on);
}

const placeOf = (t: { city: string | null; state: string | null; country: string | null }) =>
  [t.city, t.state, t.country === "USA" ? null : t.country].filter((x) => x && String(x).trim()).join(", ") || null;

interface TeamInfo { name: string | null; place: string | null; stats: PowerRankingsStats | null }

/** Names, places and the season's live numbers for these teams (one query each). */
async function teamInfo(season: number, teams: number[]): Promise<Map<number, TeamInfo>> {
  const out = new Map<number, TeamInfo>();
  if (!teams.length) return out;
  const q = teams.map(() => "?").join(",");
  const [names, stats] = await Promise.all([
    all<{ number: number; name: string | null; city: string | null; state: string | null; country: string | null }>(`SELECT number, name, city, state, country FROM teams WHERE number IN (${q})`, teams),
    all<{ team: number; rating_np: number | null; rating_rank: number | null; opr_np: number | null; wins: number; losses: number; ties: number; matches: number }>(
      `SELECT team, rating_np, rating_rank, opr_np, wins, losses, ties, matches FROM team_season_stats WHERE season = ? AND team IN (${q})`, [season, ...teams]),
  ]);
  const byTeam = new Map(stats.map((s) => [Number(s.team), s]));
  for (const n of names) out.set(Number(n.number), { name: n.name?.trim() || null, place: placeOf(n), stats: null });
  for (const t of teams) {
    const s = byTeam.get(t);
    const info = out.get(t) ?? { name: null, place: null, stats: null };
    if (s && Number(s.matches) > 0) {
      info.stats = {
        rating: s.rating_np == null ? null : Number(s.rating_np), ratingRank: s.rating_rank == null ? null : Number(s.rating_rank),
        opr: s.opr_np == null ? null : Number(s.opr_np), wins: Number(s.wins), losses: Number(s.losses), ties: Number(s.ties),
      };
    }
    out.set(t, info);
  }
  return out;
}

// Finished week views for a minute (the live numbers move with each stats run).
const viewCache = new Map<string, { at: number; v: Promise<PowerRankingsWeek> }>();
registerCache("Power rankings", () => { cache = null; viewCache.clear(); });

async function buildWeek(doc: RankingDoc, weeks: RankingDoc[]): Promise<PowerRankingsWeek> {
  const i = weeks.indexOf(doc);
  const compared = weeks.slice(0, i).reverse().find((w) => w.season === doc.season) ?? null;
  const moves = movements(doc, compared);
  const dropped = droppedOut(doc, compared);
  const info = await teamInfo(doc.season, [...doc.entries.map((e) => e.team), ...dropped.map((d) => d.team)]);
  const entries: PowerRankingsEntry[] = doc.entries.map((e, k) => {
    const t = info.get(e.team);
    return { rank: e.rank, team: e.team, name: t?.name ?? null, place: t?.place ?? null, blurbHtml: renderMarkdown(e.blurb), movement: moves[k], stats: t?.stats ?? null };
  });
  return {
    week: doc.week, season: doc.season, title: doc.title, published: doc.published,
    introHtml: renderMarkdown(doc.intro), introText: markdownText(doc.intro), sample: doc.sample, entries,
    comparedWith: compared?.week ?? null, previous: weeks[i - 1]?.week ?? null, next: weeks[i + 1]?.week ?? null,
    droppedOut: dropped.map((d) => ({ ...d, name: info.get(d.team)?.name ?? null })),
  };
}

function weekView(doc: RankingDoc, weeks: RankingDoc[]): Promise<PowerRankingsWeek> {
  const key = `${weeks.map((w) => w.week).join(",")}|${doc.week}`;
  const hit = viewCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = buildWeek(doc, weeks);
  viewCache.set(key, { at: Date.now(), v });
  v.catch(() => { if (viewCache.get(key)?.v === v) viewCache.delete(key); });
  if (viewCache.size > 200) viewCache.delete(viewCache.keys().next().value!);
  return v;
}

/** The archive (newest first), with each week's top three named. */
async function archive(weeks: RankingDoc[]): Promise<PowerRankingsSummary[]> {
  const bySeason = new Map<number, Set<number>>();
  for (const w of weeks) for (const e of w.entries.slice(0, 3)) {
    let s = bySeason.get(w.season);
    if (!s) bySeason.set(w.season, (s = new Set()));
    s.add(e.team);
  }
  const names = new Map<number, string | null>();
  for (const [season, teams] of bySeason) for (const [t, i] of await teamInfo(season, [...teams])) names.set(t, i.name);
  return [...weeks].reverse().map((w) => ({
    week: w.week, season: w.season, title: w.title, published: w.published,
    top: w.entries.slice(0, 3).map((e) => ({ team: e.team, name: names.get(e.team) ?? null })),
  }));
}

/** GET /api/power-rankings: the latest week and the archive. */
export async function latestRankings(on = today()): Promise<PowerRankingsResponse> {
  const weeks = publishedWeeks(on);
  const last = weeks.at(-1);
  return { week: last ? await weekView(last, weeks) : null, archive: await archive(weeks) };
}

/** GET /api/power-rankings/:week: that week and the archive; null when no such week is published. */
export async function rankingsWeek(id: string, on = today()): Promise<PowerRankingsResponse | null> {
  const weeks = publishedWeeks(on);
  const doc = weeks.find((w) => w.week === id.toLowerCase());
  if (!doc) return null;
  return { week: await weekView(doc, weeks), archive: await archive(weeks) };
}
