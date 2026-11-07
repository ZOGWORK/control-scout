// A comma clause saying what isn't asked (sign-off Set A: "…, not just one number", "in 2024-25, not this season")
// goes, and the rest is answered; a "not" clause that filters stays. Held out: other teams, words and seasons.
import { describe, expect, it } from "vitest";
import { withoutContrast } from "./searchAnswer";

describe("withoutContrast", () => {
  it("drops \"not just …\" and \"not only …\": more than that is wanted", () => {
    expect(withoutContrast("6980 auto trend this season, not just the average")).toBe("6980 auto trend this season");
    expect(withoutContrast("who won Think at Edison, not only the winner?")).toBe("who won Think at Edison?");
    expect(withoutContrast("compare 6980 and 4215 on rating, not just OPR, in 2024-25")).toBe("compare 6980 and 4215 on rating, in 2024-25");
  });
  it("drops \"not\" and a season: the season said beside it is the one", () => {
    expect(withoutContrast("6980 record in 2023-24, not last season")).toBe("6980 record in 2023-24");
    expect(withoutContrast("6980 awards in 2023, not 2024-25, at worlds")).toBe("6980 awards in 2023, at worlds");
    expect(withoutContrast("6980 events, NOT this year")).toBe("6980 events");
  });
  it("keeps a \"not\" that filters, and a \"not\" with no comma", () => {
    for (const q of ["teams in Ohio, not rookies", "top 5 teams by rating, not OPR", "teams not at worlds", "6980 matches not just quals"]) expect(withoutContrast(q)).toBe(q);
    // Greptile on #1031: a quoted phrase asks for exactly its words, comma clause and all.
    for (const q of ['"Raider Robotics, not just Gold"', 'teams named "Gears, not only Bolts", not just in Ohio']) expect(withoutContrast(q)).toBe(q);
  });
});
