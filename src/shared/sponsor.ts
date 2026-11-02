// Where a donation goes: the owner's GitHub Sponsors profile, for /donate (src/pages/DonatePage.tsx).
// The one place this link lives. Payment happens on GitHub (with Stripe); Control Scout never sees it.
// Tiers and amounts, if any, are set on that profile in GitHub, never in Scout.

export const SPONSOR_URL = "https://github.com/sponsors/sushilm20";

/** GET /api/supporters: GitHub Sponsors as the sponsors chose there. Public ones by name; private ones only
 *  counted. Never an amount or tier. configured false: no token on the server yet, so nothing can be read. */
export interface Supporter { login: string; name: string | null; since: string }
export interface SupportersResponse { configured: boolean; supporters: Supporter[]; anonymous: number; updatedAt: string | null }
