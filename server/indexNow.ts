// IndexNow (https://www.indexnow.org): tells Bing, Yandex, Seznam and the
// other IndexNow engines which pages changed, so they recrawl them in hours
// rather than whenever the sitemap is next read. Off unless INDEXNOW=1.
//
// The key is public by design (each engine fetches /<key>.txt to check that
// whoever pings owns the site), so it has a built-in value; INDEXNOW_KEY
// replaces it. A ping sends the site's main pages after each deploy (a new
// RELEASE) plus the event and team pages whose results changed since the last
// ping: events whose matches were re-fetched (server/sync.ts planDetail only
// re-fetches ongoing and just-finished ones) and the teams at them, and newly
// published power rankings weeks. At most one ping an hour, never more than
// the protocol's 10,000 URLs, and a failure is one log line: never thrown,
// never retried in a loop.
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

/** What the last pings did: `at` the last accepted one (changes are counted from it), `tried` the last attempt. */
interface State { at: string | null; tried: string; release: string | null }

/** Pages changed since `since` (an ISO time): events re-fetched since then, their teams, newly published weeks. */
export async function changedPaths(since: string): Promise<string[]> {
  const events = await all<{ season: number; code: string }>(
    "SELECT season, code FROM events WHERE detail_synced_at > ? ORDER BY detail_synced_at DESC LIMIT 2000", [since]);
  const teams = events.length
    ? await all<{ team: number }>(
      `SELECT DISTINCT et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE e.detail_synced_at > ? ORDER BY et.team`, [since])
    : [];
  const weeks = (await publishedWeeks().catch(() => [])).filter((w) => !w.sample && w.published > since);
  return [
    ...weeks.map((w) => `/power-rankings/${w.week}`),
    ...events.map((e) => `/events/${e.season}/${encodeURIComponent(e.code)}`),
    ...teams.map((t) => `/teams/${t.team}`),
  ];
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
    const state = await kvGet<State>(STATE_KEY);
    if (state && now - Date.parse(state.tried) < MIN_GAP_MS) return "skipped: pinged within the hour";
    const nowIso = new Date(now).toISOString();
    // The main pages: after a deploy, or until a first ping has been accepted.
    const deploy = !state?.at || state.release !== RELEASE;
    const paths = [...(deploy ? MAIN_PAGES : []), ...(state?.at ? await changedPaths(state.at) : [])];
    const urls = [...new Set(paths.map((p) => canonicalUrl(p)))].slice(0, MAX_URLS);
    // Nothing to send: no state written, so the hour isn't used up (a sync finishing soon after still pings).
    if (!urls.length) return "nothing changed";
    const key = indexNowKey();
    // Recorded first: a crash or a hang mid-request still waits an hour before the next try.
    await kvSet(STATE_KEY, { at: state?.at ?? null, tried: nowIso, release: state?.release ?? null });
    const r = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(15_000),
    });
    // 200 and 202 are accepted (202: the key is still being checked). Anything else: try again in an hour,
    // from the same starting point, so no change is lost.
    if (!r.ok) return `HTTP ${r.status}, ${urls.length} URLs not sent`;
    await kvSet(STATE_KEY, { at: nowIso, tried: nowIso, release: deploy ? RELEASE : state!.release });
    return `sent ${urls.length} URLs (HTTP ${r.status})`;
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
