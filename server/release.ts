// Which commit is running. The VM installer writes the deployed commit to
// RELEASE in the release directory; Render sets RENDER_GIT_COMMIT. /api/health
// reports it, so a deploy can prove the new build is live on each host.
// null in development.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASE: string | null = (() => {
  try { return readFileSync(join(process.cwd(), "RELEASE"), "utf8").trim() || null; } catch { /* not a VM release */ }
  return process.env.RENDER_GIT_COMMIT?.trim() || null;
})();
