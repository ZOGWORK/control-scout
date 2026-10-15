// Which season My team opens on when the URL doesn't name one.
import type { TeamProfile } from "../shared/api";

/** The team has a decided match (win, loss or tie) in this profile's season. */
export const hasResults = (p: Pick<TeamProfile, "stats">) => !!p.stats && p.stats.record.wins + p.stats.record.losses + p.stats.record.ties > 0;

/**
 * Given the team's current-season profile: the current season once the team has played in it,
 * otherwise the newest earlier season it played that the season toggle offers (`offered`),
 * otherwise the current season anyway. `seasons` lists only played seasons (plus the current one).
 */
export function defaultSeason(p: Pick<TeamProfile, "season" | "seasons" | "stats">, offered: (s: number) => boolean): number {
  if (hasResults(p)) return p.season;
  return p.seasons.find((s) => s < p.season && offered(s)) ?? p.season;
}
