// A part of the app's code that didn't download (audit PUB3-F02): a dropped connection while a page's chunk was
// on its way, or a deploy that replaced the chunk this tab still asks for. React.lazy keeps the failed import, so
// re-rendering can only fail again; only a full reload fetches the code afresh. RouteErrorBoundary tells these apart
// from a page that threw while rendering, and offers that reload (never automatically).
//
// Before it reloads, it checks for shared work that exists only on this page (src/lib/pendingWork.ts, items marked
// `volatile`): everything else unsent (scout entries, personal edits, pick list note drafts, comment attempts) is
// already kept in this device's storage and picked up again after the reload.
import { allPending, type PendingItem } from "./pendingWork";

/** Errors Vite reported through its vite:preloadError event (a page chunk's CSS or JS that didn't preload). */
const preloadErrors = new WeakSet<object>();

/** The message each browser gives a dynamic import that failed, and the ones bundlers use. */
const CHUNK_MESSAGES = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's preload helper
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack-style ChunkLoadError
];

/** Did this error come from code that didn't download (rather than code that ran and threw)? */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (preloadErrors.has(error)) return true;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_MESSAGES.some((re) => re.test(message));
}

// Vite announces a failed preload before the import rejects with it: remember the error so it's recognised whatever
// its message says. The event is left alone (not prevented): the import still fails, and the boundary shows it.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    const payload = (e as Event & { payload?: unknown }).payload;
    if (payload && typeof payload === "object") preloadErrors.add(payload);
  });
}

/** Shared work a reload would lose: only on this page, not kept in this device's storage. */
export const workOnlyOnThisPage = (): PendingItem[] => allPending().filter((x) => x.volatile);

/** The full reload (replaceable in tests: jsdom can't reload). */
export const appReload = { run: () => { window.location.reload(); } };
