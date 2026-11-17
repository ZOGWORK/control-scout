// Who sees New Jersey's conference rankings (src/shared/conferences.ts). A conference belongs to a New Jersey league,
// so a league outside New Jersey never shows one; inside it, the button and section show unless My team (this
// device's, from onboarding) is a team based elsewhere. No My team yet: shown, so a new visitor can find it. Never a
// "set your team" nudge: shown or hidden, cleanly.
import { qs, useApi } from "./api";
import { useMyTeamNumber } from "./personal";
import { CONFERENCE_REGION, type TeamConferenceInfo } from "../shared/conferences";

/** My team's conference facts for a season (null: no My team, or not in yet). */
export function useMyConference(season: number | null, enabled = true): { team: number | null; info: TeamConferenceInfo | null; loading: boolean } {
  const team = useMyTeamNumber();
  const r = useApi<TeamConferenceInfo>(team && enabled ? `/api/teams/${team}/conference${qs({ season })}` : null);
  return { team, info: r.data ?? null, loading: !!team && r.loading };
}

/** Whether a visitor whose My team is `info` sees conference rankings for a league in `region` (pure). */
export function conferenceShown(region: string | null | undefined, my: { team: number | null; info: TeamConferenceInfo | null }): boolean {
  if (region?.toUpperCase() !== CONFERENCE_REGION) return false;
  if (!my.team) return true;
  // My team is set: shown once it's known to be a New Jersey team (hidden while that loads, so it never flashes).
  return my.info?.nj === true;
}

/** Whether this visitor sees conference rankings for a league in `region` ("USNJ") in `season`. */
export function useConferenceGate(region: string | null | undefined, season: number | null = null): boolean {
  return useConferenceGateState(region, season).shown;
}

/** The gate and whether it's still deciding (My team's region not read yet): a page that says "hidden" waits for it. */
export function useConferenceGateState(region: string | null | undefined, season: number | null = null): { shown: boolean; deciding: boolean } {
  const my = useMyConference(season, region?.toUpperCase() === CONFERENCE_REGION);
  return { shown: conferenceShown(region, my), deciding: my.loading };
}
