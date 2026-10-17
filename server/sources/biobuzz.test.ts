// BIOBUZZ (2026) score mapping from both sources: endgame = park, the three bonus
// RPs in the engine's slots, and HIVE TIPs (Section 13 Table 13-1's second sort key).
import { describe, it, expect } from "vitest";
import { splitFirstScore } from "../data/seasons";
import { split } from "./ftcScout";
import { scoutEventQuery, parseScoutEventRecord } from "@control-scout/predict-engine";

// Field names from the FIRST Events API v2.0 schema (ScoreDetailAllianceModel_2026).
const first = {
  autoPoints: 40, teleopPoints: 120, teleopParkPoints: 10, foulPointsCommitted: 5, totalPoints: 165,
  autoHiveTips: 2, teleopHiveTips: 3, swarmRP: true, pollinator1RP: true, pollinator2RP: false,
};
// FTC Scout's MatchScores2026Alliance.
const scout = {
  autoPoints: 40, dcPoints: 120, dcParkPoints: 10, penaltyPointsCommitted: 5, penaltyPointsByOpp: 0,
  totalPointsNp: 160, totalPoints: 160, swarmRp: true, pollinator1Rp: true, pollinator2Rp: false, tips: 5,
};

describe("BIOBUZZ scores", () => {
  it("FIRST: park is the endgame, TIPS are auto + TeleOp, bonus RPs map to the engine's slots", () => {
    const s = splitFirstScore(2026, first);
    expect(s).toMatchObject({ auto: 40, endgame: 10, teleop: 110, np: 160, pen: 5, tips: 5 });
    expect(s.bonus).toEqual({ movement: true, goal: true, pattern: false });
  });

  it("FIRST: no TIPS fields means TIPS aren't reported (not zero)", () => {
    const { autoHiveTips: _a, teleopHiveTips: _t, ...older } = first;
    expect(splitFirstScore(2026, older).tips).toBeUndefined();
  });

  it("FTC Scout: same mapping (park endgame, swarm/pollinator RPs, tips)", () => {
    const s = split(2026, scout)!;
    expect(s).toMatchObject({ auto: 40, endgame: 10, teleop: 110, np: 160, tips: 5 });
    expect(s.bonus).toEqual({ movement: true, goal: true, pattern: false });
  });

  it("the engine's FTC Scout query asks BIOBUZZ fields for 2026 (and DECODE's only for 2025)", () => {
    const q26 = scoutEventQuery(2026), q25 = scoutEventQuery(2025);
    for (const f of ["dcParkPoints", "swarmRp", "pollinator1Rp", "pollinator2Rp", "tips"]) expect(q26).toContain(f);
    for (const f of ["dcBasePoints", "movementRp"]) { expect(q26).not.toContain(f); expect(q25).toContain(f); }
  });

  it("the engine's FTC Scout parser reads 2026 bonus RPs and the park endgame", () => {
    const resp = { data: { eventByCode: {
      code: "USTXQ1", type: "Qualifier", start: "2026-11-07", end: "2026-11-07", remote: false, hybrid: false, teams: [], awards: [],
      matches: [{ matchNum: 1, series: 0, tournamentLevel: "Quals", hasBeenPlayed: true, actualStartTime: "2026-11-07T15:00:00Z",
        teams: [{ teamNumber: 1, alliance: "Red", onField: true }, { teamNumber: 2, alliance: "Red", onField: true }, { teamNumber: 3, alliance: "Blue", onField: true }, { teamNumber: 4, alliance: "Blue", onField: true }],
        scores: { red: scout, blue: { ...scout, swarmRp: false, pollinator1Rp: false } } }],
    } } };
    const ev = parseScoutEventRecord(resp, 2026)!;
    expect(ev.matches[0].red).toMatchObject({ endgame: 10, teleop: 110, bonusRp: { movement: true, goal: true, pattern: false } });
    expect(ev.matches[0].blue.bonusRp).toEqual({ movement: false, goal: false, pattern: false });
  });
});
