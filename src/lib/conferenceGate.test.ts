// Who sees New Jersey's conference rankings: a New Jersey league only; there, everyone with no My team, a New Jersey
// My team, and never a My team based elsewhere (not even while its home loads).
import { describe, expect, it } from "vitest";
import { conferenceShown } from "./conferenceGate";
import type { TeamConferenceInfo } from "../shared/conferences";

const info = (nj: boolean | null): TeamConferenceInfo => ({ team: 1, season: 2025, nj, league: null, conference: null });

describe("conference gate", () => {
  it("shows a New Jersey league to no My team and to a New Jersey My team", () => {
    expect(conferenceShown("USNJ", { team: null, info: null })).toBe(true);
    expect(conferenceShown("usnj", { team: 4215, info: info(true) })).toBe(true);
  });
  it("hides it from a My team based elsewhere, and while My team's home is still loading", () => {
    expect(conferenceShown("USNJ", { team: 1111, info: info(false) })).toBe(false);
    expect(conferenceShown("USNJ", { team: 1111, info: null })).toBe(false);
    expect(conferenceShown("USNJ", { team: 999999, info: info(null) })).toBe(false);
  });
  it("never shows one for a league outside New Jersey", () => {
    expect(conferenceShown("USMI", { team: null, info: null })).toBe(false);
    expect(conferenceShown("USMI", { team: 4215, info: info(true) })).toBe(false);
    expect(conferenceShown(null, { team: null, info: null })).toBe(false);
  });
});
