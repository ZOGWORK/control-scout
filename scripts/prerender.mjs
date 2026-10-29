// Build step (npm run build): render How it works (/methodology) to static HTML with the real page component
// (src/prerender/methodology.tsx, built for SSR into build/ssr), so the server can put the full text in the
// first response (server/seoMeta.ts → bootShell). Charts and slider inputs are left out: a crawler reads the
// words and captions, and the page stays a light text document. The app replaces it once it loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// build/, not dist/: the server serves dist/ as public files, and these are build-only (a second public copy
// of the page, without its canonical link, would be indexable).
const build = join(process.cwd(), "build");
const { renderMethodology } = await import(pathToFileURL(join(build, "ssr", "methodology.js")).href);
const html = renderMethodology()
  .replace(/<svg[\s\S]*?<\/svg>/g, "")
  .replace(/<input\b[^>]*>/g, "")
  // Entrance animations start from opacity 0 until the app runs them: the first paint shows the words as they end up.
  .replace(/ style="[^"]*opacity:0[^"]*"/g, "")
  // Folded details (lab notes) are open in the first paint: plain visible text, not hidden from anyone.
  .replace(/(<div[^>]*class="hiw-expand"[^>]*?) aria-hidden="true"/g, "$1")
  .replace(/(<div[^>]*class="hiw-expand"[^>]*?) inert=""/g, "$1");
if (!/<h1[\s>]/.test(html) || html.length < 20000) throw new Error(`prerendered /methodology looks wrong (${html.length} bytes)`);
mkdirSync(join(build, "prerender"), { recursive: true });
writeFileSync(join(build, "prerender", "methodology.html"), html);
console.log(`prerendered /methodology: ${(html.length / 1024).toFixed(0)} KB`);
