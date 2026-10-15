import { describe, expect, it } from "vitest";
import { teamError, teamsErrors, type TeamLookup } from "./teamCheck";

const known: Record<number, string> = { 4215: "Hypnotic Robotics", 19163: "NIS 2", 21059: "NIS Semey", 13684: "" };
const lookup: TeamLookup = async (n) => (n in known ? known[n] : null);
const offline: TeamLookup = async () => undefined;

describe("teamError", () => {
  it("asks for a number when the field is empty", async () => {
    expect(await teamError("", lookup)).toBe("Enter a team number.");
    expect(await teamError("  ", lookup)).toBe("Enter a team number.");
  });
  it("rejects what can't be a team number", async () => {
    expect(await teamError("0", lookup)).toMatch(/1 to 6 digits/);
    expect(await teamError("1234567", lookup)).toMatch(/1 to 6 digits/);
    expect(await teamError("12a", lookup)).toMatch(/1 to 6 digits/);
  });
  it("blocks a team we have no record of, naming the number", async () => {
    expect(await teamError("99999", lookup)).toBe("There's no FTC team 99999 on record. Check the number.");
  });
  it("accepts a known team, including one with no name on file", async () => {
    expect(await teamError("4215", lookup)).toBeNull();
    expect(await teamError("13684", lookup)).toBeNull();
  });
  it("lets the number through when the lookup can't run (offline at a venue)", async () => {
    expect(await teamError("99999", offline)).toBeNull();
  });
});

describe("teamsErrors", () => {
  const labels = ["red team 1", "red team 2", "blue team 1", "blue team 2"];
  it("gives each field its own error and flags a repeat against the field it repeats", async () => {
    expect(await teamsErrors(["4215", "19163", "4215", "99999"], labels, lookup)).toEqual([
      null,
      null,
      "4215 is already red team 1. Pick four different teams.",
      "There's no FTC team 99999 on record. Check the number.",
    ]);
  });
  it("compares team numbers, not text: 04215 repeats 4215", async () => {
    expect(await teamsErrors(["4215", "19163", "04215", "21059"], labels, lookup)).toEqual([
      null, null, "4215 is already red team 1. Pick four different teams.", null,
    ]);
  });
  it("is all clear for four different known teams", async () => {
    expect(await teamsErrors(["4215", "19163", "21059", "13684"], labels, lookup)).toEqual([null, null, null, null]);
  });
});
