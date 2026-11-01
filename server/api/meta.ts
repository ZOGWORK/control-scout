// The site's metadata (/api/meta): seasons, the current season, data freshness, sign-in options. Also carried in a
// server-drawn page's first paint (server/firstPaint.ts), so the app starts with it.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, kvGet } from "../db.js";
import { hasFirst } from "../env.js";
import { authProviders } from "../auth/routes.js";
import { CURRENT_SEASON, SEASONS, isLegacy } from "../data/seasons.js";
import type { Meta } from "../../src/shared/api.js";

export async function siteMeta(): Promise<Meta> {
  const rows = await all<any>("SELECT season, frozen, last_sync FROM seasons");
  const sync = await kvGet<{ at: string }>("sync:last");
  // Records are also rebuilt by the live fast lane (every few minutes during events): the newer time counts.
  const [full, live] = await Promise.all([kvGet<{ at: string }>("stats:last"), kvGet<{ at: string }>("records:last")]);
  const stats = !live ? full : !full || live.at > full.at ? live : full;
  // A fresh server (no database connected yet) has no teams: the app says so
  // instead of letting every search and page look broken.
  const loaded = await all<{ one: number }>("SELECT 1 one FROM teams LIMIT 1");
  return {
    seasons: SEASONS.map((s) => { const r = rows.find((x) => Number(x.season) === s.season); return { ...s, frozen: !!r?.frozen, lastSync: r?.last_sync ?? null, predictable: !isLegacy(s.season) }; }).reverse(),
    currentSeason: CURRENT_SEASON, engineVersion: ENGINE_VERSION, dataAsOf: sync?.at ?? null, statsAt: stats?.at ?? null,
    auth: authProviders(), firstConfigured: hasFirst(), dataLoaded: loaded.length > 0,
  };
}
