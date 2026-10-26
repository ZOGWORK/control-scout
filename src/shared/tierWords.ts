// What each confidence tier is called wherever a person reads it. The tiers themselves ("provisional",
// "moderate", "confident") stay as stored and served; only these words are shown. Plain words a first-time
// visitor gets at once: how much this season's data is behind the call.
import type { ConfidenceTier } from "./api.js";

export const TIER_WORD: Record<ConfidenceTier, string> = {
  provisional: "Rough guess",
  moderate: "Fair",
  confident: "Solid",
};

/** "rough guess" / "fair" / "solid", for the middle of a sentence. */
export const tierWord = (t: ConfidenceTier | string): string => (TIER_WORD[t as ConfidenceTier] ?? t).toLowerCase();

/** "confidence: rough guess", for a sentence that names the tier (alerts, tooltips, share text). */
export const tierPhrase = (t: ConfidenceTier | string): string => `confidence: ${tierWord(t)}`;
