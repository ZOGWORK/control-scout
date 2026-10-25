// The app's own folder (the one holding its package.json), for files the server reads from the release: scripts it
// runs, content, fonts. Found by walking up from this module, so it's right both from the source (server/appRoot.ts)
// and from the built bundle (build/server/index.mjs, scripts/build-server.mjs), whatever the working directory.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try { if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "control-scout") return dir; } catch { /* keep walking */ }
    }
    if (dirname(dir) === dir) return process.cwd();
  }
}

export const APP_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/** A path inside the app's folder. */
export const appPath = (...parts: string[]) => join(APP_ROOT, ...parts);
