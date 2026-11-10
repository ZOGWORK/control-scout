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
  it("never changes words of a team's or event's name", () => {
    const named = (w: string) => /top ten/i.test(w);
    expect(spelledNumbers("top ten robotics opr", named)).toBe("top ten robotics opr");
    expect(spelledNumbers("top ten teams in nj", (w) => w === "top five")).toBe("top 10 teams in nj");
    const wonders = (w: string) => /^seven wonders/i.test(w);
    expect(spelledNumbers("awards won by seven wonders robotics", wonders)).toBe("awards won by seven wonders robotics");
  });
  it("a longer number can end in one", () => {
    expect(spelledNumbers("scores above a hundred and one points")).toBe("scores above 101 points");
    expect(spelledNumbers("scores above one hundred one")).toBe("scores above 101");
    expect(spelledNumbers("over twenty one")).toBe("over 21");
  });
  it("only the words inside quotes stay as typed", () => {
    expect(spelledNumbers('"Top Ten Robotics" opr over eighty')).toBe('"Top Ten Robotics" opr over 80');
    expect(spelledNumbers('opr over eighty "top ten"')).toBe('opr over 80 "top ten"');
  });
  it("champs is the championship", () => {
    expect(INFORMAL).toContainEqual(["champs", "championship"]);
  });
});
