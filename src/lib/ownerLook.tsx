// The look is the owner's choice alone (2026-11-22): visitors always get the new look (v8), and the classic one
// (/legacy) is reached only from the owner console. A device that picked the classic look before, or opened a ?v8=0
// link, goes back to the new look once the server has said who's here and it isn't the owner. Never on a guess: not
// before /api/auth/me answers, and not while the account shown is the offline copy (the owner, offline, keeps theirs).
import { useEffect } from "react";
import { usePersonal } from "./personal";
import { isV8, setV8 } from "./v8";

/** Who may pick the look: the owner, as the server answered. Undefined until it has. */
export function useMayPickLook(): boolean | undefined {
  const { user, providers, offlineAccount } = usePersonal();
  if (providers === null || offlineAccount) return undefined;
  return !!user?.isOwner;
}

/** In the shell: the classic look, on a device that isn't the owner's, turns back into the new one (a reload). */
export function OwnerOnlyClassicLook() {
  const may = useMayPickLook();
  useEffect(() => { if (may === false && !isV8()) setV8(true); }, [may]);
  return null;
}
