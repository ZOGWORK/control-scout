// Which FTC teams an account is ON, for team-only videos (docs/contributors.md "On the team"). Two sources, both
// on the server and neither self-asserted:
//   Control Point  the account's Control Point workspaces with an FTC number (what /api/auth/me shows as My teams)
//   roster         the owner's grant in the console (team_members), for teams with no Control Point workspace
// The self-set My team (PersonalState.myTeam) is NEVER read here: anyone can type any number into Settings.
//
// Asked per request and kept for a minute (Control Point's answer is itself reused for a minute, ME_TTL), so a
// viewer who joins or leaves a team sees the change within a minute.
import { all } from "../db.js";
import { controlPointEnabled, controlPointInfo, linkedAccountId } from "../auth/controlPoint.js";
import { registerCache } from "../caches.js";
import type { MembershipTeam } from "../../src/shared/contributors.js";

export const MEMBERSHIP_TTL_MS = 60_000;
const cache = new Map<number, { at: number; v: Promise<MembershipTeam[]> }>();
registerCache("Video team membership", () => cache.clear());

/** Drop one account's (a roster change) or everyone's kept membership. */
export function forgetMembership(userId?: number): void { if (userId == null) cache.clear(); else cache.delete(userId); }

const ftc = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 999_999 ? n : null);

async function read(userId: number): Promise<MembershipTeam[]> {
  const out = new Map<number, MembershipTeam>();
  const add = (n: number, name: string | null, source: "controlPoint" | "roster") => {
    const t = out.get(n) ?? { number: n, name: null, sources: [] };
    if (!t.name && name) t.name = name;
    if (!t.sources.includes(source)) t.sources.push(source);
    out.set(n, t);
  };
  if (controlPointEnabled()) {
    const linked = await linkedAccountId(userId).catch(() => null);
    const info = linked != null ? await controlPointInfo(linked).catch(() => null) : null;
    for (const t of info?.teams ?? []) { const n = ftc(t.teamNumber); if (n) add(n, t.name || null, "controlPoint"); }
  }
  const roster = await all<{ team_number: number; name: string | null }>(
    "SELECT r.team_number, t.name FROM team_members r LEFT JOIN teams t ON t.number = r.team_number WHERE r.user_id = ? AND r.revoked_at IS NULL ORDER BY r.granted_at", [userId]);
  for (const r of roster) add(Number(r.team_number), r.name ?? null, "roster");
  // Team names the roster rows don't carry: from the teams table, once.
  const unnamed = [...out.values()].filter((t) => !t.name).map((t) => t.number);
  if (unnamed.length) {
    const names = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${unnamed.map(() => "?").join(", ")})`, unnamed);
    for (const n of names) { const t = out.get(Number(n.number)); if (t && n.name) t.name = n.name; }
  }
  return [...out.values()];
}

/** The account's teams with where each comes from. Null user: none. */
export function membershipOf(userId: number | null | undefined, now = Date.now()): Promise<MembershipTeam[]> {
  if (userId == null) return Promise.resolve([]);
  const hit = cache.get(userId);
  if (hit && now - hit.at < MEMBERSHIP_TTL_MS) return hit.v;
  const v = read(userId);
  cache.set(userId, { at: now, v });
  v.catch(() => { if (cache.get(userId)?.v === v) cache.delete(userId); });
  if (cache.size > 5000) for (const [k, e] of cache) if (now - e.at >= MEMBERSHIP_TTL_MS) cache.delete(k);
  return v;
}

/** Just the team numbers. */
export async function teamNumbersOf(userId: number | null | undefined): Promise<number[]> {
  return (await membershipOf(userId)).map((t) => t.number);
}
