// The published power-rankings weeks (content/power-rankings/*.md, format: ./format.ts) and the
// views the API, the page head and the sitemap build from them: each entry with the team's numbers
// and its movement against the previous week. An automatic week shows the numbers frozen with its
// text (its packet: ./generated.ts shownOf), so an archived week never changes; a hand-written file
// has no frozen numbers and shows the live ones (the page says so: statsAsOf null).
//
// Files are read when they change (a deploy adds one): the directory is checked on use, and a
// file that doesn't validate is left out with its errors logged (CI's test refuses it first:
// powerRankings.content.test.ts). A week shows from its `published` date (UTC) on.
//
// Development only (POWER_RANKINGS_SAMPLE=1, never in production: server/env.ts), the sample
// weeks in content/power-rankings-sample are served instead, marked SAMPLE on the page.
//
// Weeks published automatically (./auto.ts, stored in power_rankings_generated: ./generated.ts) are
// merged in: a hand-written file for the same week, once published, takes its place. Movement is
// counted against the previous week in the merged list, whichever kind each is.
import { appPath } from "../appRoot.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { all } from "../db.js";
import { env } from "../env.js";
import { registerCache } from "../caches.js";
import { droppedOut, movements, parseRankings, type RankingDoc } from "./format.js";
import { markdownText, renderMarkdown } from "./markdown.js";
import { generatedDocs } from "./generated.js";
import { snapshotWeeks } from "../api/rankings.js";
import { RANKED_MIN_MATCHES } from "../../src/shared/rankings.js";
import { weekStart, type PowerRankingsEntry, PowerRankingsResponse, PowerRankingsStats, PowerRankingsSummary, PowerRankingsWeek } from "../../src/shared/powerRankings.js";

export const CONTENT_DIR = appPath("content", "power-rankings");
export const SAMPLE_DIR = appPath("content", "power-rankings-sample");

/** A week file's name: the week id and .md (another .md name is an error; other files, such as .gitkeep, are ignored). */
export const WEEK_FILE = /^\d{4}-w\d{2}\.md$/;

export interface LoadedWeeks { docs: RankingDoc[]; errors: { file: string; errors: string[] }[] }

/**
 * Every week file in `dir`, validated, oldest first. `sample`: the directory holds sample weeks
 * (each must say `sample: true`); the real directory may hold none.
 */
export function loadDir(dir: string, sample: boolean): LoadedWeeks {
  let all: string[] = [];
  try { all = readdirSync(dir).sort(); } catch { /* no directory: no weeks */ }
  const docs: RankingDoc[] = [];
  const errors: LoadedWeeks["errors"] = [];
  // A markdown file with any other name (2026-W43.md, week-43.md) would never show: say so, rather than skip it quietly.
  for (const f of all) {
    if (/\.md$/i.test(f) && !WEEK_FILE.test(f)) errors.push({ file: f, errors: [`the file name must be the week, like 2026-w43.md (lower-case w, two-digit week)`] });
  }
  for (const f of all.filter((x) => WEEK_FILE.test(x))) {
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
    return readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.size}:${s.mtimeMs}`; }).join("|");
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

/** Every valid hand-written week file (published or not), oldest first. */
export function fileWeeks(): RankingDoc[] {
  return loaded().docs;
}

/**
 * The weeks visitors can see (published on or before `on`), oldest first: the hand-written files and
 * the published generated weeks, a file replacing a generated week of the same id. Sample mode (and
 * tests on a sample directory) shows only the samples.
 */
export async function publishedWeeks(on = today()): Promise<RankingDoc[]> {
  const files = loaded().docs.filter((d) => d.published <= on);
  if (source().sample) return files;
  const taken = new Set(files.map((d) => d.week));
  const generated = (await generatedDocs()).filter((d) => d.published <= on && !taken.has(d.week));
  return [...files, ...generated].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.season - b.season));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A generated week's plain text as HTML: escaped, one paragraph (never markdown: Bruno's text is not trusted markup). */
const plainHtml = (s: string) => (s.trim() ? `<p>${esc(s.trim())}</p>` : "");

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
    // The world rank exactly as /rankings counts it (src/shared/rankings.ts rankTeams: rated from
    // RANKED_MIN_MATCHES matches, by rating, ties to the lower number); none for a team not ranked there.
    all<{ team: number; rating_np: number | null; world_rank: number | null; opr_np: number | null; wins: number; losses: number; ties: number; matches: number }>(
      `SELECT s.team, s.rating_np, s.opr_np, s.wins, s.losses, s.ties, s.matches,
         CASE WHEN s.rating_np IS NOT NULL AND s.rating_np >= 0 AND s.rating_matches >= ? THEN 1 + (
           SELECT COUNT(*) FROM team_season_stats o WHERE o.season = s.season AND o.rating_np IS NOT NULL AND o.rating_np >= 0 AND o.rating_matches >= ?
             AND (o.rating_np > s.rating_np OR (o.rating_np = s.rating_np AND o.team < s.team))) END AS world_rank
       FROM team_season_stats s WHERE s.season = ? AND s.team IN (${q})`, [RANKED_MIN_MATCHES, RANKED_MIN_MATCHES, season, ...teams]),
  ]);
  const byTeam = new Map(stats.map((s) => [Number(s.team), s]));
  for (const n of names) out.set(Number(n.number), { name: n.name?.trim() || null, place: placeOf(n), stats: null });
  for (const t of teams) {
    const s = byTeam.get(t);
    const info = out.get(t) ?? { name: null, place: null, stats: null };
    if (s && Number(s.matches) > 0) {
      info.stats = {
        rating: s.rating_np == null ? null : Number(s.rating_np), ratingRank: s.world_rank == null ? null : Number(s.world_rank),
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
  // Only a week ranked on the same season's numbers (week 2026-w42 is a 2026 week ranked on 2025–26).
  const compared = weeks.slice(0, i).reverse().find((w) => w.season === doc.season && dataSeasonOf(w) === dataSeasonOf(doc)) ?? null;
  // A generated week keeps the comparison it was written against (its blurbs say "up 4"): its frozen
  // movement, compared week and dropped teams, even if that earlier week is later hidden or replaced.
  const frozen = doc.generated;
  const moves = frozen ? doc.entries.map((e) => e.movement) : movements(doc, compared);
  const dropped = frozen ? frozen.droppedOut : droppedOut(doc, compared);
  const comparedWith = frozen ? frozen.comparedWith : compared?.week ?? null;
  const dataSeason = dataSeasonOf(doc);
  const [info, snapshots] = await Promise.all([teamInfo(dataSeason, [...doc.entries.map((e) => e.team), ...dropped.map((d) => d.team)]), snapshotWeeks(dataSeason)]);
  // The world rankings as they stood that week (its weekly snapshot, keyed by the Monday), else the season's live list.
  const monday = weekStart(doc.week);
  const worldRankings = snapshots.includes(monday) ? `/rankings?season=${dataSeason}&week=${monday}` : `/rankings?season=${dataSeason}`;
  const g = doc.generated;
  const entries: PowerRankingsEntry[] = doc.entries.map((e, k) => {
    const t = info.get(e.team);
    // An automatic week: the name and numbers its blurb was written from (frozen, even a missing name); a file: the live ones.
    const shown = g?.shown[k];
    return {
      rank: e.rank, team: e.team, name: shown ? shown.name : t?.name ?? null, place: t?.place ?? null, blurbHtml: g ? plainHtml(e.blurb) : renderMarkdown(e.blurb),
      movement: moves[k], stats: g ? shown?.stats ?? null : t?.stats ?? null, author: g ? g.sources[k] ?? "template" : null,
    };
  });
  const count = (a: string) => (g ? g.sources.filter((x) => x === a).length : 0);
  return {
    week: doc.week, season: doc.season, title: doc.title, published: doc.published,
    updated: g?.updated && g.updated !== doc.published ? g.updated : null,
    statsAsOf: g ? g.updated ?? doc.published : null,
    dataSeason: dataSeason !== doc.season ? dataSeason : null,
    introHtml: g ? plainHtml(doc.intro) : renderMarkdown(doc.intro), introText: g ? doc.intro.trim() : markdownText(doc.intro), sample: doc.sample,
    generated: g ? { bruno: count("bruno"), template: count("template"), owner: count("owner"), intro: g.introSource } : null,
    entries,
    comparedWith, previous: weeks[i - 1]?.week ?? null, next: weeks[i + 1]?.week ?? null,
    droppedOut: dropped.map((d) => ({ ...d, name: info.get(d.team)?.name ?? null })),
    worldRankings,
  };
}

/** The season a week's numbers come from: an automatic week's packet season, else the week's own. */
const dataSeasonOf = (d: RankingDoc) => d.generated?.dataSeason ?? d.season;

function weekView(doc: RankingDoc, weeks: RankingDoc[]): Promise<PowerRankingsWeek> {
  const key = `${weeks.map((w) => `${w.week}${w.generated ? `@${w.generated.rev}:${w.generated.updated ?? ""}` : ""}`).join(",")}|${doc.week}`;
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
  // Names only (one small query): the archive needs no stats.
  const teams = [...new Set(weeks.flatMap((w) => w.entries.slice(0, 3).map((e) => e.team)))];
  const names = new Map<number, string | null>();
  if (teams.length) {
    const rows = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${teams.map(() => "?").join(",")})`, teams);
    for (const r of rows) names.set(Number(r.number), r.name?.trim() || null);
  }
  return [...weeks].reverse().map((w) => ({
    week: w.week, season: w.season, title: w.title, published: w.published,
    top: w.entries.slice(0, 3).map((e, k) => ({ team: e.team, name: (w.generated?.shown[k] ? w.generated.shown[k].name : names.get(e.team)) ?? null })),
  }));
}

/** GET /api/power-rankings: the latest week and the archive. */
export async function latestRankings(on = today()): Promise<PowerRankingsResponse> {
  const weeks = await publishedWeeks(on);
  const last = weeks.at(-1);
  return { week: last ? await weekView(last, weeks) : null, archive: await archive(weeks) };
}

/** GET /api/power-rankings/:week: that week and the archive; null when no such week is published. */
export async function rankingsWeek(id: string, on = today()): Promise<PowerRankingsResponse | null> {
  const weeks = await publishedWeeks(on);
  const doc = weeks.find((w) => w.week === id.toLowerCase());
  if (!doc) return null;
  return { week: await weekView(doc, weeks), archive: await archive(weeks) };
}
