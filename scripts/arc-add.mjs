// Vendor Arc UI (uiarc.dev) registry items into src/components/arc/, the way
// `shadcn add <url>` would: the source is copied into the repo (we own it and
// theme it), registry dependencies included. Usage: node scripts/arc-add.mjs otp-input animated-counter …
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = join(process.cwd(), "src", "components", "arc");
const seen = new Set();
const deps = new Set();
async function add(nameOrUrl) {
  const url = nameOrUrl.startsWith("http") ? nameOrUrl : `https://uiarc.dev/r/${nameOrUrl}.json`;
  if (seen.has(url)) return;
  seen.add(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const item = await res.json();
  for (const d of item.dependencies ?? []) deps.add(d);
  for (const d of item.registryDependencies ?? []) await add(d);
  for (const f of item.files ?? []) {
    const rel = f.path.replace(/^registry\//, "").replace(/^components\//, "");
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content.replace(/\r\n/g, "\n"));
    console.log(`  ${item.name}: ${rel}`);
  }
}
for (const n of process.argv.slice(2)) await add(n);
if (!existsSync(join(OUT, "README.md"))) writeFileSync(join(OUT, "README.md"), "# Arc UI components\n\nVendored from https://uiarc.dev (free tier) with `node scripts/arc-add.mjs <name>`, the way `shadcn add` copies source. Themed to Control Point's tokens in `arc-theme.css`.\n");
console.log("npm deps:", [...deps].join(", ") || "none");
