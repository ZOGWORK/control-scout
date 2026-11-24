// The flags everyone gets (GET /api/flags without workspace overrides), also put in each page's HTML (server/seo.ts),
// so the app starts with the server's own switches instead of waiting a round trip for them (src/lib/flags.ts).
import type { FlagSet } from "../src/shared/flags.js";
import { allFlags, flagWrites, hasWorkspaceOverrides } from "./flags.js";
import { vapidReady } from "./push/push.js";
import { r2 } from "./scout/r2.js";

/** Every flag as this server serves it: photos also need R2 configured, push its VAPID keys. */
export async function servedFlags(): Promise<FlagSet> {
  const g = await allFlags();
  return { ...g, photos: g.photos && !!r2(), push: g.push && vapidReady() };
}

/** The flags as one answer for everyone, or null when some workspace has its own setting (the answer then depends on
 *  who asks, so it's never put in a shared page). */
export async function sharedFlags(): Promise<FlagSet | null> {
  // One snapshot: a write landing between the two reads (an override added after "none") gives none to share.
  const w = flagWrites();
  if (await hasWorkspaceOverrides()) return null;
  const flags = await servedFlags();
  return flagWrites() === w ? flags : null;
}
