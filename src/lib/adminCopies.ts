// The line a save shows when the scout is an admin of several workspaces: the server saves each of their own entries
// in every workspace they're an admin of (server/scout/adminCopies.ts), so the toast says where it goes.
import { usePersonal } from "./personal";
import { workspaceLabel } from "./scoutSpace";
import type { ScoutSpace } from "./scouting";

interface Space { id: string; name: string; role: "admin" | "member"; orphaned?: unknown }

const list = (names: string[]) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * "Saved to Hypnotic Robotics, First Street Kids and Bad Wolf" (offline: "Goes to … when it syncs"), when saving in
 * `space` is copied to other workspaces: the scout is an admin of it and of at least one other (neither read-only),
 * and the entry is their own (`author` the entry's author, absent for a new one; `me` this account). Else null.
 */
export function savedToLine(workspaces: readonly Space[], space: ScoutSpace, o: { me?: number | null; author?: number | null; online?: boolean } = {}): string | null {
  if (space == null) return null;
  if (o.author != null && o.author !== 0 && o.me != null && o.author !== o.me) return null;
  const usable = (w: Space) => w.role === "admin" && !w.orphaned;
  const here = workspaces.find((w) => w.id === space);
  if (!here || !usable(here)) return null;
  const others = workspaces.filter((w) => w.id !== space && usable(w));
  if (!others.length) return null;
  const names = list([here, ...others].map(workspaceLabel));
  return o.online === false ? `Goes to ${names} when it syncs` : `Saved to ${names}`;
}

/** savedToLine for the signed-in account. */
export function useSavedToLine(space: ScoutSpace, author?: number | null): string | null {
  const { user } = usePersonal();
  const cp = user?.controlPoint;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  return savedToLine(cp?.workspaces ?? [], space, { me: cp?.accountId ?? null, author, online });
}
