// IndexNow (https://www.indexnow.org): tells Bing, Yandex, Seznam and the
// other IndexNow engines which pages changed, so they recrawl them in hours
// rather than whenever the sitemap is next read. Off unless INDEXNOW=1.
//
// The key is public by design (each engine fetches /<key>.txt to check that
// whoever pings owns the site), so it has a built-in value; INDEXNOW_KEY
// replaces it. A ping sends the site's main pages after each deploy (a new
// RELEASE) plus the event and team pages whose results changed since the last
// ping: events whose matches were re-fetched (server/sync.ts planDetail only
// re-fetches ongoing and just-finished ones) and the teams at them, and power
// rankings weeks not sent before. At most one ping an hour and the protocol's
// 10,000 URLs; what doesn't fit goes in the next ping, from where this one
// stopped. A failure is one log line: never thrown, never retried in a loop.
import type { NextFunction, Request, Response } from "express";
import { all, kvGet, kvSet } from "./db.js";
import { env } from "./env.js";
import { RELEASE } from "./release.js";
import { canonicalOrigin, canonicalUrl } from "./seo.js";
import { publishedWeeks } from "./powerRankings/store.js";

export const DEFAULT_KEY = "8da88d7fa9ed782383e804ed035f755e";
export const ENDPOINT = "https://api.indexnow.org/indexnow";
/** The pages that say what the site is, sent after every deploy. */
export const MAIN_PAGES = ["/", "/faq", "/power-rankings", "/rankings", "/teams", "/events", "/methodology"];
export const MIN_GAP_MS = 3600_000;
export const MAX_URLS = 10_000;
const STATE_KEY = "indexnow";

/** The protocol's key: 8–128 of a-z, A-Z, 0-9 and "-". */
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
export const indexNowKey = () => (env.indexNowKey && KEY_RE.test(env.indexNowKey) ? env.indexNowKey : DEFAULT_KEY);

/** Where the event pages left off: the last event sent, in (re-fetched at, season, code) order. */
interface Cursor { t: string; season: number; code: string }
/** What the last pings did. `accepted`: an engine has taken a ping. `cursor`: events after it are still to send.
 *  `weeks`: the power rankings weeks already sent. `tried`: the last attempt (the hourly limit). */
interface State { accepted: boolean; cursor: Cursor; weeks: string[]; tried: string; release: string | null }

/** Events (in order, after `cursor`) and the teams at each, as many as fit in `budget` URLs. A batch that doesn't
 *  fit is left for the next ping, from where this one stops: nothing is skipped. */
export async function changedEvents(cursor: Cursor, budget: number): Promise<{ paths: string[]; cursor: Cursor; more: boolean }> {
  const BATCH = 2000;
  const events = await all<{ t: string; season: number; code: string }>(
    `SELECT detail_synced_at t, season, code FROM events WHERE detail_synced_at IS NOT NULL AND (detail_synced_at, season, code) > (?, ?, ?)
     ORDER BY detail_synced_at, season, code LIMIT ${BATCH + 1}`, [cursor.t, cursor.season, cursor.code]);
  const batch = events.slice(0, BATCH);
  const teams = new Map<string, number[]>();
  if (batch.length) {
    const last = batch[batch.length - 1];
    const rows = await all<{ season: number; code: string; team: number }>(
      `SELECT et.season, et.code, et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       WHERE e.detail_synced_at IS NOT NULL AND (e.detail_synced_at, e.season, e.code) > (?, ?, ?) AND (e.detail_synced_at, e.season, e.code) <= (?, ?, ?)`,
      [cursor.t, cursor.season, cursor.code, last.t, last.season, last.code]);
    for (const r of rows) { const k = `${r.season}:${r.code}`; teams.set(k, [...(teams.get(k) ?? []), r.team]); }
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  let at = cursor;
  let i = 0;
  for (; i < batch.length; i++) {
    const e = batch[i];
    const add = [`/events/${e.season}/${encodeURIComponent(e.code)}`, ...(teams.get(`${e.season}:${e.code}`) ?? []).map((t) => `/teams/${t}`)].filter((x) => !seen.has(x));
    // An event and its teams go together; one bigger than a whole ping on its own still goes (cut to fit).
    if (paths.length + add.length > budget && paths.length) break;
    for (const x of add) seen.add(x);
    paths.push(...add.slice(0, budget - paths.length));
    at = { t: e.t, season: e.season, code: e.code };
  }
  return { paths, cursor: at, more: i < batch.length || events.length > BATCH };
}

type Fetch = (url: string, init: RequestInit) => Promise<Pick<globalThis.Response, "status" | "ok">>;

/**
 * One IndexNow ping, if one is due. Resolves to what happened, in a few words (for the log); never rejects.
 * `now` and `fetchImpl` are for tests.
 */
let busy = false;
export async function pingIndexNow(opts: { now?: number; fetchImpl?: Fetch } = {}): Promise<string> {
  // One at a time in this process (a sync finishing and the hourly tick can ask together).
  if (busy) return "skipped: a ping is under way";
  busy = true;
  try {
    if (!env.indexNowEnabled) return "off";
    const origin = canonicalOrigin();
    const host = new URL(origin).hostname;
    // Only the real site: never a development or test origin.
    if (!origin.startsWith("https://") || host === "localhost" || /^[\d.]+$/.test(host)) return "skipped: not a public origin";
    const now = opts.now ?? Date.now();
    const nowIso = new Date(now).toISOString();
    const saved = await kvGet<Partial<State>>(STATE_KEY);
    if (saved?.tried && now - Date.parse(saved.tried) < MIN_GAP_MS) return "skipped: pinged within the hour";
    // Before any accepted ping, event pages count from now (the sitemap already lists the older ones).
    const state: State = {
      accepted: !!saved?.accepted, cursor: saved?.cursor ?? { t: nowIso, season: 0, code: "" }, weeks: saved?.weeks ?? [],
      tried: saved?.tried ?? "", release: saved?.release ?? null,
    };
    // The main pages: after a deploy, or until a first ping has been accepted.
    const deploy = !state.accepted || state.release !== RELEASE;
    const main = deploy ? MAIN_PAGES : [];
    // Weeks by their id, not their date: a week published later on the day of a ping is still new.
    const weeks = (await publishedWeeks().catch(() => [])).filter((w) => !w.sample && !state.weeks.includes(w.week)).map((w) => w.week);
    const fixed = [...main, ...weeks.map((w) => `/power-rankings/${w}`)].slice(0, MAX_URLS);
    const ev = await changedEvents(state.cursor, MAX_URLS - fixed.length);
    const urls = [...new Set([...fixed, ...ev.paths].map((p) => canonicalUrl(p)))];
    // Nothing to send: no state written, so the hour isn't used up (a sync finishing soon after still pings).
    if (!urls.length) return "nothing changed";
    const key = indexNowKey();
    // Recorded first: a crash or a hang mid-request still waits an hour before the next try.
    await kvSet(STATE_KEY, { ...state, tried: nowIso });
    const r = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(15_000),
    });
    // 200 and 202 are accepted (202: the key is still being checked). Anything else: try again in an hour,
    // from the same starting point, so no change is lost.
    if (!r.ok) return `HTTP ${r.status}, ${urls.length} URLs not sent`;
    await kvSet(STATE_KEY, {
      accepted: true, cursor: ev.cursor, tried: nowIso, release: deploy ? RELEASE : state.release,
      // Only weeks that went out are marked sent (one cut off by the 10,000 limit waits for the next ping).
      weeks: [...state.weeks, ...weeks.filter((w) => urls.includes(canonicalUrl(`/power-rankings/${w}`)))],
    } satisfies State);
    return `sent ${urls.length} URLs (HTTP ${r.status})${ev.more ? ", more next time" : ""}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  } finally {
    busy = false;
  }
}

/** GET /<key>.txt: the key itself, as IndexNow checks it. Any other .txt name falls through (to the 404). */
export function indexNowKeyRoute(req: Request, res: Response, next: NextFunction) {
  const key = indexNowKey();
  if (req.path !== `/${key}.txt`) { next(); return; }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type("text/plain").send(key);
}
