// Real-user speed (web vitals): the beacon's payload, thresholds and histogram
// buckets, shared by the web app (src/lib/vitals.ts sends it) and the server
// (server/vitals.ts re-checks and aggregates it). Like page views (./analytics),
// a beacon carries a route pattern and a screen-size bucket only: never a full
// URL, page content, search text or anything that tells visitors apart.
import { isRoutePattern, SCREENS, type Screen } from "./analytics";

export type VitalName = "LCP" | "INP" | "CLS" | "FID" | "TTFB";
export const VITALS: readonly VitalName[] = ["LCP", "INP", "CLS", "FID", "TTFB"];

/** Good up to [0], poor above [1] (web.dev's thresholds). CLS has no unit; the rest are ms. */
export const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FID: [100, 300], TTFB: [800, 1800],
};

/**
 * Upper bounds of each metric's histogram buckets (the last open-ended): columns b0..b11 of web_vitals_daily.
 * Both thresholds are bucket bounds, so the good and poor shares read straight off the buckets.
 */
export const VITAL_BUCKETS: Record<VitalName, readonly number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 12_000, Infinity],
  INP: [25, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 2000, Infinity],
  CLS: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.4, 0.6, 1, Infinity],
  FID: [10, 25, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, Infinity],
  TTFB: [100, 200, 300, 400, 600, 800, 1000, 1400, 1800, 2500, 4000, Infinity],
};
export const VITAL_BUCKET_COUNT = 12;

/** Larger values are measurement glitches (a tab left in the background, a clock jump), not page speed. */
export const VITAL_MAX: Record<VitalName, number> = { LCP: 120_000, INP: 60_000, CLS: 50, FID: 60_000, TTFB: 120_000 };

/** What the browser sends to POST /api/collect/vitals: one page load's metrics, as many as are known when the tab hides. */
export type VitalsBeacon = {
  /** Route pattern of the page the visit started on, e.g. "/teams/:number". */
  path: string;
  screen: Screen;
  m: Partial<Record<VitalName, number>>;
};

export type VitalRating = "good" | "ni" | "poor";
export function rateVital(name: VitalName, v: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  return v <= good ? "good" : v <= poor ? "ni" : "poor";
}

/** The histogram bucket a value falls in. */
export function vitalBucket(name: VitalName, v: number): number {
  const b = VITAL_BUCKETS[name];
  let i = 0;
  while (v > b[i]) i++;
  return i;
}

/** Server side: a validated beacon (unknown metrics and impossible values dropped), or null when there's nothing to count. */
export function parseVitals(body: unknown): VitalsBeacon | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!isRoutePattern(b.path)) return null;
  if (!SCREENS.includes(b.screen as Screen)) return null;
  if (!b.m || typeof b.m !== "object" || Array.isArray(b.m)) return null;
  const given = b.m as Record<string, unknown>;
  const m: VitalsBeacon["m"] = {};
  for (const name of VITALS) {
    const v = given[name];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= VITAL_MAX[name]) m[name] = v;
  }
  return Object.keys(m).length ? { path: b.path, screen: b.screen as Screen, m } : null;
}

/** One metric over many page loads, for the owner's Usage panel. Shares are 0–1; p75 is null without samples. */
export interface VitalStat { n: number; p75: number | null; good: number; poor: number }
export interface VitalsRow { path: string; metrics: Partial<Record<VitalName, VitalStat>> }
