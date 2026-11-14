// Sends the first-visit onboarding's anonymous counts (src/shared/onboardingStats.ts) to our own server, and only
// when the visitor allowed usage statistics (src/lib/consent.ts). Best effort: a lost beacon is a lost count.
import { hasAnalyticsConsent } from "./consent";
import { screenBucket } from "../shared/analytics";
import type { OnboardingEvent } from "../shared/onboardingStats";

/** Count one moment of the onboarding. Returns whether it was sent. */
export function sendOnboarding(e: OnboardingEvent, step: number, team = false): boolean {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return false;
  const body = JSON.stringify({ e, step, team, screen: screenBucket(window.innerWidth) });
  try {
    if (navigator.sendBeacon?.("/api/collect/onboarding", new Blob([body], { type: "application/json" }))) return true;
  } catch { /* fall through to fetch */ }
  fetch("/api/collect/onboarding", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => { /* best effort */ });
  return true;
}
