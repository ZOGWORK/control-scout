// The owner console's Analytics tab: page views and sessions per Eastern-time day, the most viewed pages and the sites
// visits came from (opt-in usage statistics, analytics_daily). Only page views: the owner reads this tab for traffic, so prediction calls and the
// prediction ledger's counts are no longer worked out here. Aggregates only: route patterns (/teams/:number), never a real path, account or address.
import { addDays, dayOf, statsSummary } from "../analytics.js";
import { publishUsageSetting } from "../ownerSettings.js";
import type { OwnerAnalytics } from "../../src/shared/owner.js";


export async function ownerAnalytics(days = 14, now = Date.now()): Promise<OwnerAnalytics> {
  const to = dayOf(new Date(now)), from = addDays(to, -(days - 1));
  const [views, publishUsage] = await Promise.all([statsSummary(days, new Date(now)), publishUsageSetting()]);
  const byDay = new Map<string, { pageViews: number; sessions: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(addDays(to, -i), { pageViews: 0, sessions: 0 });
  for (const d of views.daily) {
    const b = byDay.get(String(d.day));
    if (b) { b.pageViews = Number(d.views ?? 0); b.sessions = Number(d.sessions ?? 0); }
  }
  return {
    days, from, to,
    totals: { pageViews: views.totals.views, sessions: views.totals.sessions },
    daily: [...byDay].map(([day, v]) => ({ day, ...v })),
    topPages: views.topPaths.slice(0, 10).map((r) => ({ path: String(r.path), views: Number(r.views) })),
    referrers: views.topReferrers.slice(0, 10).map((r) => ({ host: String(r.host), sessions: Number(r.sessions) })),
    publishUsage,
  };
}
