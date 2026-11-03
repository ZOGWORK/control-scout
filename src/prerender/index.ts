// The server-side render bundle (npm run build: vite build --ssr → build/ssr/index.js): How it works and How FTC One
// Search works, rendered once
// at build time (scripts/prerender.mjs), and team and event pages, rendered per request (server/firstPaint.ts).
export { renderMethodology } from "./methodology";
export { renderSearchDocs } from "./searchDocs";
export { renderAppPage } from "./page";
