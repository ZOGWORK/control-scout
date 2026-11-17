// The clip autopilot's open data PRs (scripts/clip-autopilot.ts), as GitHub lists them: which events it has read and
// is shipping, so Owner › Clip coverage says "read, in PR #N" for them instead of "queued". Read off the repository's
// public pull request list (labelled clip-autopilot), at most once every 10 minutes; GitHub down or slow only leaves
// the last list (or none) in place, never an error on the console.
import { env } from "../env.js";
import { GITHUB_REPO } from "../errorReports.js";

/** The mark an autopilot PR's description carries (scripts/lib/autopilotRows.ts prMarker): its season and rows. */
const MARK = /<!-- clip-autopilot (\{.*?\}) -->/;
const TTL_MS = 10 * 60_000;

/** The events ("season/code") a PR description's mark names, or none. */
export function markedEvents(body: string | null | undefined): string[] {
  const m = MARK.exec(body ?? "");
  if (!m) return [];
  try {
    const v = JSON.parse(m[1]);
    if (!Number.isInteger(v?.season) || !Array.isArray(v.rows)) return [];
    return [...new Set(v.rows.map((k: unknown) => `${v.season}/${String(k).split("|")[1] ?? ""}`).filter((k: string) => !k.endsWith("/")))] as string[];
  } catch { return []; }
}

let cache: { at: number; prs: Map<string, number> } | null = null;
let pending: Promise<Map<string, number>> | null = null;

/** Open autopilot PRs by the events they ship ("season/code" → PR number). */
export function autopilotPrs(now = Date.now(), fetchImpl?: typeof fetch): Promise<Map<string, number>> {
  // The test suite never reaches GitHub unless a test hands in its own fetch.
  const get = fetchImpl ?? (process.env.VITEST ? null : fetch);
  if (!get) return Promise.resolve(new Map());
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache.prs);
  pending ??= (async () => {
    try {
      const token = env.githubReportToken;
      const res = await get(`https://api.github.com/repos/${GITHUB_REPO}/issues?state=open&labels=clip-autopilot&per_page=100`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "control-scout-clip-coverage", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const prs = new Map<string, number>();
      for (const i of (await res.json()) as { number: number; body: string | null; pull_request?: unknown }[]) {
        if (i.pull_request) for (const k of markedEvents(i.body)) prs.set(k, i.number);
      }
      cache = { at: now, prs };
    } catch {
      // Kept as it was; tried again in a minute rather than on every request.
      cache = { at: now - TTL_MS + 60_000, prs: cache?.prs ?? new Map() };
    }
    return cache.prs;
  })().finally(() => { pending = null; });
  return pending;
}

/** Tests only: forget the list. */
export const forgetAutopilotPrs = () => { cache = null; pending = null; };
