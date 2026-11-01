// The first paint's page data (src/shared/boot.ts PAGE_DATA_ID): the answers a server-rendered page was drawn from,
// put in the API cache before the app's first render (main.tsx imports this first), so the app draws the same page
// from the first frame: no loading state, no second request for data the HTML already carried.
import { prime } from "./api";
import { PAGE_DATA_ID } from "../shared/boot";

const firstPaint = new Set<string>();

/** Prime the API cache from `doc`'s page-data block (the paths it held). */
export function readPageData(doc: Document): string[] {
  const raw = doc.getElementById(PAGE_DATA_ID)?.textContent;
  if (!raw) return [];
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return []; }
  if (!x || typeof x !== "object") return [];
  const paths: string[] = [];
  for (const [path, data] of Object.entries(x as Record<string, unknown>)) {
    if (!path.startsWith("/api/") || !data || typeof data !== "object") continue;
    prime(path, data);
    firstPaint.add(path);
    paths.push(path);
  }
  return paths;
}

/** Whether `path`'s data came with the page (or, on the server, the page is being rendered from it): the page's
 *  content is already on screen, so it draws in full at once rather than its top first (useAfterFirstPaint). */
export const fromFirstPaint = (path: string | null) => !!path && firstPaint.has(path);

/** The server's render of a page from its data (src/prerender/page.tsx): counted as first-paint data while it renders. */
export function withFirstPaint<T>(paths: string[], render: () => T): T {
  paths.forEach((p) => firstPaint.add(p));
  try { return render(); } finally { paths.forEach((p) => firstPaint.delete(p)); }
}

if (typeof document !== "undefined") readPageData(document);
