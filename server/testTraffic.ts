// Our own traffic, told apart from visitors' (docs/failed-search-reporting.md, "Test traffic"). The failure log was
// mostly our own questions: eval sets, load tests, agents checking a fix, and the issues' own Reproduce links. None of
// that is a person searching, so the failed-search log leaves it out (and counts it).
//
// Marked by:
//   - the header `X-CS-Test: 1`, sent by every eval script, k6 run and agent request (scripts/search-signoff/*,
//     scripts/search-*.ts, scripts/check-suggestions.ts; AGENTS.md says agents send it too);
//   - a Reproduce link opened from an issue: its page URL carries `from=issue` (reproduceUrl), and the page's own
//     search request names that page in its Referer (same origin, Referrer-Policy strict-origin-when-cross-origin).
//     Only the query the link opened is test traffic: what the visitor types next on that page is theirs.
import type { Request } from "express";

export const TEST_HEADER = "x-cs-test";
/** The query parameter a Reproduce link carries (server/searchFailures.ts reproduceUrl). */
export const REPRODUCE_PARAM = "from";
export const REPRODUCE_VALUE = "issue";

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Whether this search request is our own: the test header, or the query a Reproduce link opened. */
export function isTestTraffic(req: Pick<Request, "get">, q: string): boolean {
  const h = req.get(TEST_HEADER)?.trim();
  if (h && h !== "0") return true;
  const ref = req.get("referer");
  if (!ref) return false;
  try {
    const u = new URL(ref);
    // Only the search page a Reproduce link opens (reproduceUrl): the same words on any other page are a visitor's.
    return u.pathname.replace(/\/+$/, "") === "/search" && u.searchParams.get(REPRODUCE_PARAM) === REPRODUCE_VALUE && fold(u.searchParams.get("q") ?? "") === fold(q);
  } catch {
    return false;
  }
}
