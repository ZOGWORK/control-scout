// The server-side render bundle (npm run build: vite build --ssr → build/ssr/index.js): How it works, How FTC One
// Search works and the plain content pages, rendered once
// at build time (scripts/prerender.mjs), and team and event pages, rendered per request (server/firstPaint.ts).
export { renderMethodology } from "./methodology";
export { renderSearchDocs } from "./searchDocs";
export { renderAppPage } from "./page";
export { renderStaticPage, STATIC_PRERENDERS } from "./staticPages";
