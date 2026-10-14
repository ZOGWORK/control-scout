// Which commit is running: the VM installer writes the deployed commit to
// RELEASE in the release directory. /api/health reports it, so a deploy can
// prove the new build is live. null in development.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASE: string | null = (() => {
  try { return readFileSync(join(process.cwd(), "RELEASE"), "utf8").trim() || null; } catch { return null; } // not a VM release
})();
