// The look is the owner's choice alone (2026-11-22): visitors always get the new look (v8), and the classic one
// (/legacy) is reached only from the owner console. A device that picked the classic look before, or opened a ?v8=0
// link, goes back to the new look once the server has said who's here and it isn't the owner. Never on a guess: not
// before /api/auth/me answers, not when it failed (a 5xx, a timeout, no signal), and not while the account shown is the
// offline copy (the owner, offline, keeps theirs).
import { useEffect } from "react";
import { usePersonal } from "./personal";
import { isV8, setV8 } from "./v8";

/** Who may pick the look: the owner, as the server answered. Undefined until it has. */
export function useMayPickLook(): boolean | undefined {
  const { user, accountAnswered, offlineAccount } = usePersonal();
  if (!accountAnswered || offlineAccount) return undefined;
  return !!user?.isOwner;
}

/** This address without its ?v8= (index.html obeys one on every load: reloading with ?v8=0 still on it drew the classic
 *  look again, and turned it back again, forever). */
export function withoutLookParam(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("v8");
  return u.pathname + u.search + u.hash;
}

/** Once per tab: should anything still bring the classic look back on the next load, it's left as it is, never a loop. */
const TRIED = "cs-look-reset";

/** In the shell: the classic look, on a device that isn't the owner's, turns back into the new one (a reload, to the
 *  same page without ?v8=). */
export function OwnerOnlyClassicLook() {
  const may = useMayPickLook();
  useEffect(() => {
    if (may !== false || isV8()) return;
    try {
      if (sessionStorage.getItem(TRIED)) return;
      sessionStorage.setItem(TRIED, "1");
    } catch { /* storage blocked: setV8 goes by ?v8=1, which index.html obeys, so the next load is the new look */ }
    setV8(true, withoutLookParam(location.href));
  }, [may]);
  return null;
}
