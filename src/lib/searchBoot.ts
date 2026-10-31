// /search's results from the server's first paint (server/seoMeta.ts searchMeta, a JSON block), read when the
// main bundle loads, before the app's first render replaces it: the page starts from the links already on screen
// instead of blanking them while it asks the API again.
import type { SearchHit } from "../shared/api";
import { SEARCH_HITS_ID } from "../shared/search";

export interface BootHits { q: string; hits: SearchHit[] }

/** The query and hits in `doc`'s first-paint block (null: none, or not readable). */
export function readBootHits(doc: Document): BootHits | null {
  const raw = doc.getElementById(SEARCH_HITS_ID)?.textContent;
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as BootHits;
    return typeof x?.q === "string" && Array.isArray(x.hits) ? x : null;
  } catch { return null; }
}

export const BOOT_HITS = typeof document === "undefined" ? null : readBootHits(document);
