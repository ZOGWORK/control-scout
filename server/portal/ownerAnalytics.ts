// The owner console's Analytics tab: page views, sessions and unique visitors per Eastern-time day, the most viewed pages
// and the sites visits came from (opt-in usage statistics, analytics_daily). Only page views: the owner reads this tab for
// traffic, so prediction calls and the prediction ledger's counts are no longer worked out here. Aggregates only: route
// patterns (/teams/:number), never a real path, account or address. The owner's own devices send nothing
// (src/lib/analytics.tsx markOwnerDevice).
import { db } from "../db.js";
import { addDays, dayOf, statsSummary } from "../analytics.js";
import { publishUsageSetting } from "../ownerSettings.js";
import { VISITORS_SINCE } from "../../src/shared/analytics.js";
import type { OwnerAnalytics } from "../../src/shared/owner.js";

/** Every new visitor since unique visitors were first counted (the console's all-time line). */
async function newVisitorsEver(): Promise<number> {
  const r = await db().execute("SELECT SUM(new_visitors) AS n FROM analytics_daily");
  return Number(r.rows[0]?.n ?? 0);
}

export async function ownerAnalytics(days = 14, now = Date.now()): Promise<OwnerAnalytics> {
  const to = dayOf(new Date(now)), from = addDays(to, -(days - 1));
  const [views, publishUsage, ever] = await Promise.all([statsSummary(days, new Date(now)), publishUsageSetting(), newVisitorsEver()]);
  const byDay = new Map<string, { pageViews: number; sessions: number; visitors: number; newVisitors: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(addDays(to, -i), { pageViews: 0, sessions: 0, visitors: 0, newVisitors: 0 });
  for (const d of views.daily) {
    const b = byDay.get(String(d.day));
    if (b) Object.assign(b, { pageViews: Number(d.views ?? 0), sessions: Number(d.sessions ?? 0), visitors: Number(d.visitors ?? 0), newVisitors: Number(d.newVisitors ?? 0) });
  }
  return {
    days, from, to,
    totals: { pageViews: views.totals.views, sessions: views.totals.sessions, visitors: views.totals.visitors, newVisitors: views.totals.newVisitors },
    visitors: { since: VISITORS_SINCE, newEver: ever },
    daily: [...byDay].map(([day, v]) => ({ day, ...v })),
    topPages: views.topPaths.slice(0, 10).map((r) => ({ path: String(r.path), views: Number(r.views) })),
    referrers: views.topReferrers.slice(0, 10).map((r) => ({ host: String(r.host), sessions: Number(r.sessions) })),
    publishUsage,
  };
}
