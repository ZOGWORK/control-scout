// Team colours as a personal key: only palette colours for real team numbers are kept, a device's and
// the account's colours merge team by team (the newer side wins a team set on both), and Compare uses a
// chosen colour before its usual one.
import { describe, expect, it } from "vitest";
import { cleanValue, EMPTY_STATE, mergeValue, PERSONAL_KEYS } from "./personal";
import { TEAM_COLORS, teamColorOf } from "./teamColors";
import { teamPalette } from "../pages/ComparePage";

describe("teamColors personal key", () => {
  it("syncs like the other personal keys, starting empty", () => {
    expect(PERSONAL_KEYS).toContain("teamColors");
    expect(EMPTY_STATE.teamColors).toEqual({});
  });

  it("keeps palette colours for valid team numbers only", () => {
    expect(cleanValue("teamColors", { "4215": "sky", "16": "indigo", "0": "sky", "abc": "sky", "1234567": "sky", "33950": "chartreuse", "6980": 3 }))
      .toEqual({ "4215": "sky", "16": "indigo" });
    expect(cleanValue("teamColors", ["sky"])).toBeNull();
    expect(cleanValue("teamColors", null)).toBeNull();
  });

  it("merges team by team, the newer side winning a team both set", () => {
    const account = { value: { "4215": "sky", "16": "indigo" }, updatedAt: 1 };
    const local = { value: { "4215": "rose", "6980": "teal" }, updatedAt: 2 };
    expect(mergeValue("teamColors", account, local)?.value).toEqual({ "4215": "rose", "16": "indigo", "6980": "teal" });
    expect(mergeValue("teamColors", { ...account, updatedAt: 3 }, local)?.value).toEqual({ "4215": "sky", "16": "indigo", "6980": "teal" });
  });

  it("looks a team's colour up, and Compare falls back to its usual colours", () => {
    const colors = { "4215": "violet" };
    expect(teamColorOf(colors, 4215)?.css).toBe(TEAM_COLORS.find((c) => c.id === "violet")!.css);
    expect(teamColorOf(colors, 16)).toBeNull();
    // Gold is the accent, never a team's colour: one saved before shows as the team's usual colour.
    expect(teamColorOf({ "16": "gold" }, 16)).toBeNull();
    expect(TEAM_COLORS.map((c) => c.id)).not.toContain("gold");
    const pal = teamPalette([16, 4215, 6980], (t) => teamColorOf(colors, t));
    expect(pal).toEqual(["var(--color-team-a)", TEAM_COLORS.find((c) => c.id === "violet")!.css, "var(--color-team-c)"]);
  });
});
