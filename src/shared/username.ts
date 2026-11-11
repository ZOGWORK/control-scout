// Usernames (docs/contributors.md): the account's handle, needed to add videos, like, report or get verified. It's a
// Scout handle only (Control Point's shared accounts have none), never shown on a video, a match or an event: the
// credit there is the account's actual name (display name). It shows in the owner console, beside the name and email.

/** 3–20 characters: letters, numbers and underscores, starting with a letter. */
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
export const USERNAME_MIN = 3, USERNAME_MAX = 20;
/** A username can change at most once in this many days. */
export const USERNAME_CHANGE_DAYS = 30;
/** The actual name's longest (Settings, PATCH /api/me). */
export const NAME_MAX = 60;

/** Names nobody can take: the app's own, staff-sounding ones, and an archive's name (not a personal handle). */
export const RESERVED_USERNAMES = new Set(["controlscout", "scout", "official", "admin", "support", "system", "moderator", "owner", "gardenstatearchive"]);

/** Uniqueness ignores case: "Partv08" and "partv08" are one username. */
export const usernameKey = (u: string) => u.trim().toLowerCase();

export type UsernameProblem = "format" | "reserved";

/** Why `raw` can't be a username (before checking it's free), or null when it can. */
export function usernameProblem(raw: string): UsernameProblem | null {
  const u = raw.trim();
  if (!USERNAME_RE.test(u)) return "format";
  if (RESERVED_USERNAMES.has(usernameKey(u))) return "reserved";
  return null;
}

export const USERNAME_PROBLEM_TEXT: Record<UsernameProblem | "taken" | "tooSoon", string> = {
  format: "Use 3–20 letters, numbers or underscores, starting with a letter.",
  reserved: "That username is reserved. Pick another.",
  taken: "That username is taken.",
  tooSoon: `You can change your username once every ${USERNAME_CHANGE_DAYS} days.`,
};

/**
 * Two or three free-to-try versions of a taken username, in the same format: with the team number, then with a
 * small number ("partv08" → "partv08_4215", "partv08_2", "partv08_3"). Every one passes usernameProblem; `taken`
 * says which are already used (checked by the caller). Offered, never assigned.
 */
export function usernameSuggestions(raw: string, team: number | null, taken: (u: string) => boolean, max = 3): string[] {
  const base = raw.trim().replace(/[^A-Za-z0-9_]/g, "").replace(/^[^A-Za-z]+/, "") || "scout";
  const out: string[] = [];
  const tryOne = (suffix: string) => {
    const stem = base.slice(0, USERNAME_MAX - suffix.length);
    const u = `${stem}${suffix}`;
    if (out.length < max && !usernameProblem(u) && !taken(u) && !out.some((x) => usernameKey(x) === usernameKey(u))) out.push(u);
  };
  if (team != null && Number.isInteger(team) && team > 0) tryOne(`_${team}`);
  for (let i = 2; out.length < max && i < 60; i++) tryOne(`_${i}`);
  return out;
}

/** The one credit line a contributor's video shows (the actual name, never the username or email). */
export const creditLine = (name: string) => `Video by ${name}`;
