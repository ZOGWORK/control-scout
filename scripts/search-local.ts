// Search against the shipped snapshot, in this process (audit M1/M4): the eval scripts' local default, never
// production. bootSearch() restores the snapshot into an empty database (a temp one unless DATABASE_URL is set),
// migrates, builds the search index and warms the season and forecasters, as scripts/search-heldout.ts always did.
// localServer() then serves the real app on a free port, so scripts that ask over HTTP (the sign-off runner, the team
// page number check in crosscheck.ts) hit this snapshot.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

export async function bootSearch(): Promise<{ season: number; data: string }> {
  if (!process.env.DATABASE_URL) {
    const dir = join(tmpdir(), "control-scout-search-eval");
    mkdirSync(dir, { recursive: true });
    process.env.DATABASE_URL = `file:${join(dir, "scout.db").replace(/\\/g, "/")}`;
  }
  process.env.CS_NO_SCHEDULER ??= "1";
  const { restoreSnapshotIfEmpty } = await import("../server/data/snapshot.js");
  const data = String(await restoreSnapshotIfEmpty());
  const { migrate } = await import("../server/db.js");
  await migrate();
  const { ensureSearchIndex } = await import("../server/api/search.js");
  const { rebuildSearch } = await import("../server/stats/job.js");
  await ensureSearchIndex(rebuildSearch);
  const { forecasterFor } = await import("../server/predict/engine.js");
  const { CURRENT_SEASON } = await import("../server/data/seasons.js");
  const { refreshSearchSeason } = await import("../server/api/answers/season.js");
  const season = await refreshSearchSeason();
  await forecasterFor(CURRENT_SEASON);
  await forecasterFor(season);
  return { season, data };
}

/** The app on 127.0.0.1 at a free port, over the booted snapshot (call bootSearch first). No search limit. */
export async function localServer(): Promise<{ base: string; close: () => void }> {
  const { createApp } = await import("../server/app.js");
  const server = createApp({ searchesPerMinute: 1_000_000 }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
