// v8, the new look (docs/design/v8-revamp-brief.md). Off by default while it's built page by page.
// index.html sets <html data-v8> before first paint when this device has it on: `?v8=1` on any URL turns it on
// (remembered in localStorage cs-v8), `?v8=0` turns it off. CSS opts in with the `v8:` variant (src/index.css).

export const V8_KEY = "cs-v8";

/** Whether this page load is drawn in v8 (fixed for the load: index.html decides before anything paints). */
export const isV8 = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-v8");

/** Turns v8 on or off on this device, then reloads so the whole page is drawn in the chosen look. */
export function setV8(on: boolean) {
  try {
    if (on) localStorage.setItem(V8_KEY, "1");
    else localStorage.removeItem(V8_KEY);
  } catch { /* storage blocked: the ?v8= link still works for this load */ }
  location.reload();
}
