// The owner's wash in the app (src/shared/wash.ts). The server's HTML carries it as an inline <style> in the head
// (server/seo.ts washStyle), which React never touches, so the app needs no request for it. Without that first paint
// (a development server) it is asked for once from /api/wash. The owner console replaces the tag after a save, so the
// open page shows the new wash at once.
import { apiFetch } from "./api";
import { hadBootShell } from "./heroLines";
import { WASH_STYLE_ID, parseWash, washCss, type WashResponse } from "../shared/wash";

/** Put `r` on the page: the owner's wash as the <style> tag, or no tag (index.css's defaults). */
export function applyWash(r: WashResponse, doc: Document = document): void {
  let el = doc.getElementById(WASH_STYLE_ID);
  if (!r.custom) { el?.remove(); return; }
  if (!el) {
    el = doc.createElement("style");
    el.id = WASH_STYLE_ID;
    doc.head.appendChild(el);
  }
  el.textContent = washCss(r.wash);
}

/** Whether the server's first paint was on this page, read before React replaces it. */
const BOOT_SHELL = typeof document !== "undefined" && hadBootShell(document);
let asked = false;

/** Once per page load: with no first paint (so no server answer in the head), ask the API for the owner's wash. */
export function loadWashOnce(doc: Document = document, boot = BOOT_SHELL): void {
  if (asked) return;
  asked = true;
  if (boot || doc.getElementById(WASH_STYLE_ID)) return;
  apiFetch<WashResponse>("/api/wash").then((r) => {
    const p = parseWash(r?.wash);
    if ("wash" in p) applyWash({ wash: p.wash, custom: r.custom === true }, doc);
  }).catch(() => { /* the defaults stay */ });
}

/** Tests: forget that the wash was asked for. */
export function resetWashLoad(): void { asked = false; }
