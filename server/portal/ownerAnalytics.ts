// The owner console's Analytics tab: page views and sessions (opt-in usage statistics, analytics_daily),
// prediction calls (requests to /api/predict/*, from the request metrics) and the prediction ledger's
// counts, per UTC day. Aggregates only: no paths beyond route patterns, no accounts, no addresses.
import { all, get } from "../db.js";
import { statsSummary } from "../analytics.js";
import { publishUsageSetting } from "../ownerSettings.js";
import type { OwnerAnalytics } from "../../src/shared/owner.js";

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Prediction routes in request_metrics_daily ("GET /api/predict/match" …). */
export const PREDICT_ROUTE_LIKE = "% /api/predict/%";

export async function ownerAnalytics(days = 14, now = Date.now()): Promise<OwnerAnalytics> {
  const to = dayOf(now), from = dayOf(now - (days - 1) * 86_400_000);
  const [views, predictRows, ledger, publishUsage] = await Promise.all([
    statsSummary(days, new Date(now)),
    all<{ day: string; route: string; count: number }>(
      "SELECT day, route, count FROM request_metrics_daily WHERE day BETWEEN ? AND ? AND route LIKE ?", [from, to, PREDICT_ROUTE_LIKE]),
    get<{ live: number; liveScored: number; liveIn: number; scoredIn: number; backtestScored: number }>(
      `SELECT
         SUM(kind = 'live') live,
         SUM(kind = 'live' AND outcome IS NOT NULL) liveScored,
         SUM(kind = 'live' AND substr(predicted_at, 1, 10) BETWEEN ? AND ?) liveIn,
         SUM(kind = 'live' AND outcome IS NOT NULL AND substr(scored_at, 1, 10) BETWEEN ? AND ?) scoredIn,
         SUM(kind = 'backtest' AND outcome IS NOT NULL) backtestScored
       FROM predictions`, [from, to, from, to]),
    publishUsageSetting(),
  ]);
  const byDay = new Map<string, { pageViews: number; sessions: number; predictionCalls: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(dayOf(now - i * 86_400_000), { pageViews: 0, sessions: 0, predictionCalls: 0 });
  for (const d of views.daily) {
    const b = byDay.get(String(d.day));
    if (b) { b.pageViews = Number(d.views ?? 0); b.sessions = Number(d.sessions ?? 0); }
  }
  const routes = new Map<string, number>();
  for (const r of predictRows) {
    const n = Number(r.count);
    const b = byDay.get(String(r.day));
    if (b) b.predictionCalls += n;
    routes.set(r.route, (routes.get(r.route) ?? 0) + n);
  }
  const daily = [...byDay].map(([day, v]) => ({ day, ...v }));
  const n = (x: unknown) => Number(x ?? 0);
  return {
    days, from, to,
    totals: { pageViews: views.totals.views, sessions: views.totals.sessions, predictionCalls: daily.reduce((s, d) => s + d.predictionCalls, 0) },
    daily,
    predictionRoutes: [...routes].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)),
    ledger: { liveLogged: n(ledger?.live), liveScored: n(ledger?.liveScored), liveLoggedInPeriod: n(ledger?.liveIn), liveScoredInPeriod: n(ledger?.scoredIn), backtestScored: n(ledger?.backtestScored) },
    publishUsage,
  };
}
