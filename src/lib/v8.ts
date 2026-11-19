// v8, the new look (docs/design/v8-revamp-brief.md), the default since 7.7.0; /legacy picks the classic one.
// index.html sets <html data-v8> before first paint when this device has it on: `?v8=1` on any URL turns it on
// (remembered in localStorage cs-v8), `?v8=0` turns it off. CSS opts in with the `v8:` variant (src/index.css).

import { useSyncExternalStore } from "react";

export const V8_KEY = "cs-v8";
/** The look a device gets before it picks one (index.html's boot script must match: `=== '1'` while this is false,
 *  `!== '0'` once it's true). The choice itself is stored as "1" (v8) or "0" (the classic look, /legacy). */
export const V8_DEFAULT = true;

/** Whether this page load is drawn in v8 (fixed for the load: index.html decides before anything paints). */
export const isV8 = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-v8");

/** isV8() that follows the attribute while the page is open (the /preview/kit page switches it on for its own visit),
 *  so anything derived from it, the theme first (src/hooks/useTheme.ts), redraws when it changes. */
export function useIsV8(): boolean {
  return useSyncExternalStore(subscribe, isV8, () => false);
}
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-v8"] });
  return () => mo.disconnect();
}

/** Picks v8 or the classic look on this device (remembered, so it holds after v8 becomes the default), then loads
 *  `to` (this page when left out) so the whole page is drawn in the chosen look. */
export function setV8(on: boolean, to?: string) {
  try {
    localStorage.setItem(V8_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: load the page with ?v8=, which index.html obeys for that load without storage.
    const dest = to ?? location.pathname + location.search;
    location.assign(`${dest}${dest.includes("?") ? "&" : "?"}v8=${on ? 1 : 0}`);
    return;
  }
  if (to) location.assign(to);
  else location.reload();
}
