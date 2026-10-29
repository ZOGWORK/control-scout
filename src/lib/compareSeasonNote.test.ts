import { describe, expect, it } from "vitest";
import { compareSeasonNote } from "./compareSeasonNote";

const t = (number: number, hasResults = true) => ({ number, hasResults });

describe("compareSeasonNote", () => {
  it("says nothing for a season picked by hand, or when every team has current results", () => {
    expect(compareSeasonNote({ asked: true, season: 2025, current: 2026, teams: [t(4215)] })).toBeNull();
    expect(compareSeasonNote({ asked: false, season: 2026, current: 2026, teams: [t(4215), t(6980)] })).toBeNull();
    expect(compareSeasonNote({ asked: false, season: 2026, current: 2026, teams: [] })).toBeNull();
  });
  it("explains a fall back to last season", () => {
    expect(compareSeasonNote({ asked: false, season: 2025, current: 2026, teams: [t(4215), t(6980)] }))
      .toBe("No 2026–27 results yet, so this compares 2025–26: 2025–26 is the latest season any of these teams has results in.");
    expect(compareSeasonNote({ asked: false, season: 2025, current: 2026, teams: [t(4215)] }))
      .toBe("No 2026–27 results yet, so this compares 2025–26: 2025–26 is the latest season this team has results in.");
  });
  it("names the teams with nothing in the season shown", () => {
    expect(compareSeasonNote({ asked: false, season: 2026, current: 2026, teams: [t(18360), t(4215, false)] }))
      .toBe("Showing 2026–27: 2026–27 is the latest season any of these teams has results in. 4215 has none in 2026–27; pick another season above to compare it there.");
    expect(compareSeasonNote({ asked: false, season: 2026, current: 2026, teams: [t(18360), t(4215, false), t(6980, false)] }))
      .toMatch(/ 4215 and 6980 have none in 2026–27; pick another season above to compare them there\.$/);
  });
});
