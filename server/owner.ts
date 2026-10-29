// Who counts as an owner of this Control Scout install: a signed-in account whose
// email is in OWNER_EMAILS. Owner-only endpoints answer everyone else with 403
// (server/portal/routes.ts).
import type { Request } from "express";
import { env } from "./env.js";
import { currentUser, type User } from "./auth/session.js";

export const isOwnerEmail = (email: string | null | undefined): boolean =>
  !!email && env.ownerEmails.includes(email.trim().toLowerCase());

/** The signed-in owner making this request, or null (not signed in, not on the list, or no list set). */
export async function ownerOf(req: Request): Promise<User | null> {
  if (!env.ownerEmails.length) return null;
  const user = await currentUser(req);
  return user && isOwnerEmail(user.email) ? user : null;
}
