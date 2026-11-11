// "Continue with Control Scout" on Control Point (docs/shared-accounts.md), started while signed out
// here: the server sends the visitor to sign in (/settings?section=profile&for=control-point) and keeps
// Control Point's state in a cookie. Once they're signed in (email code, Google, a provider through
// Control Point), the app goes back to /api/auth/control-point/vouch, which vouches for them to
// Control Point. Google's sign-in returns to /my-team, so the pending continue is also remembered
// for this tab (sessionStorage), for as long as the server's cookie lives.

export const VOUCH_URL = "/api/auth/control-point/vouch";
const KEY = "cs-cp-vouch";
/** The server's state cookie lives 10 minutes; a pending continue never outlives it. */
const TTL_MS = 10 * 60_000;

/** The URL marks a sign-in that continues to Control Point: remember it for this tab. */
export function noteVouch(search: string, now = Date.now()): void {
  if (new URLSearchParams(search).get("for") !== "control-point") return;
  try { sessionStorage.setItem(KEY, String(now)); } catch { /* storage blocked: the URL still carries it */ }
}

/** A sign-in here should continue to Control Point (marked in the URL, or remembered and still fresh). */
export function vouchPending(search: string, now = Date.now()): boolean {
  if (new URLSearchParams(search).get("for") === "control-point") return true;
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && now - at < TTL_MS;
  } catch { return false; }
}

/** Forget the pending continue (it's being followed, or it was dropped). */
export function clearVouch(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
