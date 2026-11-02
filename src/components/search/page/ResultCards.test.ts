// Early in a season most teams have no numbers yet: their cards show last season's, labelled with it, never a blank
// or a zero from the new season.
import { describe, expect, it } from "vitest";
import type { TeamSummary } from "../../../shared/api";
import { teamSeasons } from "./ResultCards";

const t = (team: number, record: string | null, opr: number | null): TeamSummary => ({ team, name: null, place: "", opr, oprRank: null, of: null, rating: null, ratingSd: null, record, lastEvent: null, nextEvent: null });

describe("teamSeasons", () => {
  it("uses this season's numbers when there are any, else last season's", () => {
    const m = teamSeasons([t(1, "3-0-0", 50), t(2, null, null)], [t(1, "9-1-0", 80), t(2, "20-4-0", 119.7)], 2026);
    expect(m.get(1)).toMatchObject({ season: 2026, s: { record: "3-0-0" } });
    expect(m.get(2)).toMatchObject({ season: 2025, s: { record: "20-4-0" } });
  });
  it("keeps a team with no numbers in either season (its badges are left out, not zeroed)", () => {
    expect(teamSeasons([t(3, null, null)], [], 2026).get(3)).toMatchObject({ season: 2026, s: { record: null } });
  });
});
