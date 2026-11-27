// Team logos (the owner's teamLogos switch, off by default): the small picture FIRST shows next to a team number.
//
// Source. FIRST's Events API has no avatar endpoint for FTC (checked 2026-11: /{season}/avatars answers 501). Its
// own event pages draw them from one stylesheet per season, event-portal.firstinspires.org/ftc/<season>/avatars/
// composed.css, which holds:
//   .team-avatar { background-image: url("data:image/png;base64,…") }   FIRST's generic mark, for a team with none
//   .team-4215  { background-image: url("/ftc/<season>/avatars/composed/4215_<uuid>") }   one 40×40 PNG per team
// A picture's path carries a fresh uuid whenever the team uploads a new one, so a path never changes what it shows:
// a refresh downloads only the paths it hasn't stored (a resumable, light job: one stylesheet per season, then just
// what changed). The generic mark is stored as team 0.
//
// Stored in team_logos (migration 116), served at /api/team-logos/<number>: the team's own picture, else the
// generic mark. Not in the shipped snapshot (binary, refetched by the data cycle once a day).
import { createHash } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { all, get, kvGet, kvSet, run } from "./db.js";
import { requireFeature } from "./flags.js";
import { sniffImage } from "./auth/avatars.js";

export const LOGO_ORIGIN = "https://event-portal.firstinspires.org";
export const sheetUrl = (season: number) => `${LOGO_ORIGIN}/ftc/${season}/avatars/composed.css`;
/** The generic FIRST mark's row. */
export const DEFAULT_TEAM = 0;
/** No team picture is anywhere near this (FIRST's are 40×40, a few KB); anything bigger isn't one. */
export const LOGO_MAX_BYTES = 64 * 1024;
/** How often the data cycle refreshes them. */
export const LOGO_REFRESH_MS = 23 * 3600_000;
const LAST_KEY = "teamLogos:last";

export interface LogoSheet { fallback: Uint8Array | null; teams: Map<number, string> }

/** Read one season's stylesheet: the generic mark (decoded) and each team's picture path. */
export function parseLogoSheet(css: string): LogoSheet {
  const d = /\.team-avatar\s*\{[^}]*?url\(\s*["']?data:image\/png;base64,([A-Za-z0-9+/=]+)["']?\s*\)/.exec(css);
  const teams = new Map<number, string>();
  for (const m of css.matchAll(/\.team-(\d{1,6})\s*\{[^}]*?background-image:\s*url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    const n = Number(m[1]);
    // Only FIRST's own picture paths: never a link to anywhere else, whatever the sheet says.
    if (n >= 1 && n <= 999_999 && /^\/ftc\/\d{4}\/avatars\/[\w/.-]+$/.test(m[2])) teams.set(n, m[2]);
  }
  return { fallback: d ? new Uint8Array(Buffer.from(d[1], "base64")) : null, teams };
}

type Fetch = typeof fetch;
const UA = "ControlScout/1.0 (+https://controlscout.org)";

async function fetchText(url: string, f: Fetch): Promise<string | null> {
  const res = await f(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchPng(url: string, f: Fetch): Promise<Uint8Array | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await f(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
      if (!res.ok) return null;
      const b = new Uint8Array(await res.arrayBuffer());
      return b.length <= LOGO_MAX_BYTES && sniffImage(b) === "image/png" ? b : null;
    } catch (e) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
      throw e;
    }
  }
}

const etagOf = (b: Uint8Array) => `"${createHash("sha1").update(b).digest("base64url").slice(0, 16)}"`;

async function store(team: number, season: number, src: string, png: Uint8Array): Promise<void> {
  await run(
    `INSERT INTO team_logos (team, season, src, png, etag, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (team) DO UPDATE SET season = excluded.season, src = excluded.src, png = excluded.png, etag = excluded.etag, fetched_at = excluded.fetched_at`,
    [team, season, src, png, etagOf(png), new Date().toISOString()],
  );
}

export interface LogoReport { seasons: number[]; listed: number; fetched: number; unchanged: number; failed: number; removed: number }

/** A prune never removes more than this share of the stored pictures at once: a sheet that comes back empty or
 *  reshaped (FIRST changed its format) reads as "every team took its picture down", which is never true. */
export const PRUNE_MAX_SHARE = 0.1;

/**
 * Bring team_logos up to date with FIRST's sheets. `seasons` newest first: a team's newest picture wins, and the
 * generic mark comes from the newest sheet that has one. `teams`: only these (a manual run).
 * `prune` (the data cycle's full refresh): also drop teams no sheet lists any more, but only when every season's
 * sheet was read and the drop is small (PRUNE_MAX_SHARE); otherwise nothing is removed and it says why.
 * Downloads at most `concurrency` pictures at a time, and only paths it hasn't stored.
 */
export async function refreshTeamLogos(opts: { seasons: number[]; teams?: number[]; prune?: boolean; log?: (m: string) => void; fetch?: Fetch; concurrency?: number }): Promise<LogoReport> {
  const f = opts.fetch ?? fetch, log = opts.log ?? (() => {});
  const want = new Map<number, { season: number; src: string }>();
  let fallback: { season: number; png: Uint8Array } | null = null;
  const read: number[] = [];
  for (const season of opts.seasons) {
    const css = await fetchText(sheetUrl(season), f);
    if (css == null) continue;
    read.push(season);
    const sheet = parseLogoSheet(css);
    if (!fallback && sheet.fallback && sniffImage(sheet.fallback) === "image/png") fallback = { season, png: sheet.fallback };
    for (const [n, src] of sheet.teams) if (!want.has(n)) want.set(n, { season, src });
  }
  const report: LogoReport = { seasons: read, listed: want.size, fetched: 0, unchanged: 0, failed: 0, removed: 0 };
  if (!read.length) { log("team logos: no sheet could be read"); return report; }
  const only = opts.teams ? new Set(opts.teams) : null;
  const have = new Map((await all<{ team: number; src: string }>("SELECT team, src FROM team_logos", [])).map((r) => [Number(r.team), String(r.src)]));
  if (fallback) {
    const src = `default:${etagOf(fallback.png)}`;
    if (have.get(DEFAULT_TEAM) !== src) await store(DEFAULT_TEAM, fallback.season, src, fallback.png);
  }
  const todo = [...want].filter(([n, w]) => (!only || only.has(n)) && have.get(n) !== w.src);
  report.unchanged = [...want.keys()].filter((n) => (!only || only.has(n))).length - todo.length;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [n, w] = todo[next++];
      try {
        const png = await fetchPng(LOGO_ORIGIN + w.src, f);
        if (png) { await store(n, w.season, w.src, png); report.fetched++; } else report.failed++;
      } catch (e) { report.failed++; log(`team logos: ${n}: ${(e as Error).message}`); }
      if ((report.fetched + report.failed) % 250 === 0) log(`team logos: ${report.fetched + report.failed}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  // A team that took its picture down: its old one goes. Only on a full refresh whose every sheet was read, and never
  // a mass removal (a missing, empty or reshaped sheet would otherwise look like every team removing theirs).
  if (opts.prune && !only) {
    const gone = [...have.keys()].filter((n) => n !== DEFAULT_TEAM && !want.has(n));
    const stored = [...have.keys()].filter((n) => n !== DEFAULT_TEAM).length;
    if (read.length < opts.seasons.length) log(`team logos: not removing anything, ${opts.seasons.length - read.length} sheet(s) could not be read`);
    else if (gone.length > Math.max(5, stored * PRUNE_MAX_SHARE)) log(`team logos: not removing ${gone.length} of ${stored} (too many at once to be teams taking pictures down)`);
    else {
      for (const n of gone) await run("DELETE FROM team_logos WHERE team = ?", [n]);
      report.removed = gone.length;
    }
  }
  log(`team logos: ${report.listed} listed (${read.join(", ")}), ${report.fetched} fetched, ${report.unchanged} unchanged, ${report.failed} failed, ${report.removed} removed`);
  return report;
}

/** The data cycle's daily refresh: when the last one is over LOGO_REFRESH_MS old. Never throws. */
export async function refreshTeamLogosIfDue(seasons: number[], log: (m: string) => void, now = Date.now()): Promise<void> {
  try {
    const last = await kvGet<string>(LAST_KEY);
    if (last && now - Date.parse(last) < LOGO_REFRESH_MS) return;
    const r = await refreshTeamLogos({ seasons, prune: true, log });
    if (r.seasons.length) await kvSet(LAST_KEY, new Date(now).toISOString());
  } catch (e) { log(`team logos: ${(e as Error).message}`); }
}

/** How long a browser keeps a logo before asking again (then a 304 when it's the same picture). */
export const LOGO_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

/** GET /api/team-logos/:number — the team's picture, else FIRST's generic mark; 404 before any refresh has run.
 *  Behind the teamLogos switch: while it's off the route answers like any switched-off feature. */
export function teamLogosRouter(): Router {
  const r = express.Router();
  r.get("/:number", requireFeature("teamLogos"), (req: Request, res: Response, next) => {
    const n = /^\d{1,6}$/.test(req.params.number) ? Number(req.params.number) : NaN;
    if (!(n >= 1)) { res.status(404).set("Cache-Control", "no-store").json({ error: "not_found" }); return; }
    get<{ png: ArrayBuffer | Uint8Array; etag: string }>(
      "SELECT png, etag FROM team_logos WHERE team IN (?, ?) ORDER BY team = ? DESC LIMIT 1", [n, DEFAULT_TEAM, n],
    ).then((row) => {
      if (!row) { res.status(404).set("Cache-Control", "public, max-age=300").json({ error: "not_found" }); return; }
      res.set({ "Cache-Control": LOGO_CACHE, ETag: row.etag, "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" });
      if (req.headers["if-none-match"] === row.etag) { res.status(304).end(); return; }
      res.send(Buffer.from(row.png instanceof Uint8Array ? row.png : new Uint8Array(row.png)));
    }, next);
  });
  return r;
}
