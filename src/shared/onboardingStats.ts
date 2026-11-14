// The first-visit onboarding's anonymous counts (server/onboardingStats.ts), sent only by visitors who allowed usage
// statistics, like page views. One beacon per moment: it opened, a step was reached, it was skipped on a step, or
// it was finished (with or without a team picked). No IDs: the server adds 1 to a daily total.
import { SCREENS, type Screen } from "./analytics.js";

export const ONBOARDING_EVENTS = ["shown", "reached", "skipped", "finished"] as const;
export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[number];

export interface OnboardingBeacon {
  e: OnboardingEvent;
  /** The step (1–4) reached or skipped on; finished is step 4, shown step 1. */
  step: number;
  /** Finished only: a team was picked in step 2. */
  team: boolean;
  screen: Screen;
}

/** A beacon as the server accepts it, or null. */
export function parseOnboardingBeacon(body: unknown): OnboardingBeacon | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!ONBOARDING_EVENTS.includes(b.e as OnboardingEvent)) return null;
  const step = Number(b.step);
  if (!Number.isInteger(step) || step < 1 || step > 4) return null;
  if (!SCREENS.includes(b.screen as Screen)) return null;
  const e = b.e as OnboardingEvent;
  if (e === "shown" && step !== 1) return null;
  if (e === "finished" && step !== 4) return null;
  if (e === "reached" && step === 1) return null; // step 1 is "shown"
  return { e, step, team: e === "finished" && b.team === true, screen: b.screen as Screen };
}

/** The owner console's funnel over a span of days. */
export interface OnboardingSummary {
  days: number;
  /** Opened for a new visitor. */
  shown: number;
  /** Reached each step: [step 1 (= shown), step 2, step 3, step 4]. */
  reached: [number, number, number, number];
  /** Skipped on each step. */
  skipped: [number, number, number, number];
  finished: number;
  /** Finished with a team picked. */
  withTeam: number;
}
