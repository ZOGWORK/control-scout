// Labels shared by the server and the web app.

/** Event types with no matches (kickoffs, workshops, practice days…): the Events page leaves them out, and so does
 *  Scout's picker until its Event type filter picks one (a pit can be scouted at a practice day). */
export const NO_MATCH_TYPES = ["Kickoff", "Workshop", "DemoExhibition", "VolunteerSignup", "PracticeDay", "InnovationChallenge"] as const;
export const isNoMatchType = (t: string | null | undefined): boolean => !!t && (NO_MATCH_TYPES as readonly string[]).includes(t);

/** Human label for a compact event type. */
export function eventTypeLabel(type: string | null | undefined): string {
  const map: Record<string, string> = {
    LeagueMeet: "League Meet", LeagueTournament: "League Tournament", Qualifier: "Qualifier", SuperQualifier: "Super Qualifier",
    Championship: "Championship", FIRSTChampionship: "FIRST Championship", Premier: "Premier Event", OffSeason: "Off-season",
    Kickoff: "Kickoff", Workshop: "Workshop", DemoExhibition: "Demo / Exhibition", Scrimmage: "Scrimmage",
    VolunteerSignup: "Volunteer Signup", PracticeDay: "Practice Day", InnovationChallenge: "Innovation Challenge",
  };
  return (type && map[type]) ?? type ?? "Event";
}

/**
 * Each season's names for its three bonus ranking points, in the engine's slot order (movement, goal,
 * pattern: server/data/seasons.ts splitFirstScore maps them; re-exported there). Null without bonus RPs.
 */
export function bonusLabels(season: number): [string, string, string] | null {
  if (season === 2025) return ["Movement", "Goal", "Pattern"];
  if (season === 2026) return ["Swarm", "Pollinator 1", "Pollinator 2"];
  return null;
}
