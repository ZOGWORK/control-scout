// Build step (npm run build): render How it works (/methodology) and How FTC One Search works (/how-it-works/search) to static HTML with the real page component
// (src/prerender/methodology.tsx, built for SSR into build/ssr), so the server can put the full text in the
// first response (server/seoMeta.ts → bootShell). Charts and slider inputs are left out: a crawler reads the
// words and captions, and the page stays a light text document. The app replaces it once it loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// build/, not dist/: the server serves dist/ as public files, and these are build-only (a second public copy
// of the page, without its canonical link, would be indexable).
const build = join(process.cwd(), "build");
const { renderMethodology, renderSearchDocs } = await import(pathToFileURL(join(build, "ssr", "index.js")).href);
/** A page as its first paint: the real component's HTML, without charts and inputs, entrances at their end state, folds open. */
const firstPaint = (html) => html
  .replace(/<svg[\s\S]*?<\/svg>/g, "")
  .replace(/<input\b[^>]*>/g, "")
  // Entrance animations start from opacity 0 until the app runs them: the first paint shows the words as they end up.
  .replace(/ style="[^"]*opacity:0[^"]*"/g, "")
  // Folded details (lab notes) are open in the first paint: plain visible text, not hidden from anyone.
  .replace(/(<div[^>]*class="hiw-expand"[^>]*?) aria-hidden="true"/g, "$1")
  .replace(/(<div[^>]*class="hiw-expand"[^>]*?) inert=""/g, "$1");
mkdirSync(join(build, "prerender"), { recursive: true });
for (const [path, file, render, min] of [["/methodology", "methodology.html", renderMethodology, 20000], ["/how-it-works/search", "search-docs.html", renderSearchDocs, 8000]]) {
  const html = firstPaint(render());
  if (!/<h1[\s>]/.test(html) || html.length < min) throw new Error(`prerendered ${path} looks wrong (${html.length} bytes)`);
  writeFileSync(join(build, "prerender", file), html);
  console.log(`prerendered ${path}: ${(html.length / 1024).toFixed(0)} KB`);
}
