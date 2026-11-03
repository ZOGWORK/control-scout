// The plain content pages prerendered at build time (src/prerender/staticPages.tsx, scripts/prerender.mjs) and the file
// each is written to (build/prerender/<file>), which the server puts in the page's first HTML (server/seoMeta.ts).
export const PRERENDERED_PAGES: Readonly<Record<string, string>> = {
  "/privacy": "privacy.html",
  "/terms": "terms.html",
  "/contact": "contact.html",
  "/donate": "donate.html",
  "/download": "download.html",
  "/rules": "rules.html",
};
