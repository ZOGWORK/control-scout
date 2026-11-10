// Numbers said as words (launch audit, Nov 9 2026, Phase A4): digits after a word that takes a number, words elsewhere.
import { describe, expect, it } from "vitest";
import { INFORMAL, spelledNumbers } from "./lexicon";

describe("spelledNumbers", () => {
  it("reads a number said as words after a word that takes one", () => {
    expect(spelledNumbers("who partnered 4215 at nj championship with opr over eighty")).toBe("who partnered 4215 at nj championship with opr over 80");
    expect(spelledNumbers("top five teams in nj")).toBe("top 5 teams in nj");
    expect(spelledNumbers("4215 last ten matches")).toBe("4215 last 10 matches");
    expect(spelledNumbers("won by twenty-five points")).toBe("won by 25 points");
    expect(spelledNumbers("scores above a hundred and ten")).toBe("scores above 110");
    expect(spelledNumbers("more than seventeen teams")).toBe("more than 17 teams");
  });
  it("leaves every other word as typed", () => {
    for (const q of ["which one is better", "the best one", "two teams at worlds", "seven wonders robotics", "top fiver", '"over eighty" robotics']) expect(spelledNumbers(q), q).toBe(q);
  });
  it("champs is the championship", () => {
    expect(INFORMAL).toContainEqual(["champs", "championship"]);
  });
});
