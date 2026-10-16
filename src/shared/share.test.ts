// The words on a share card, and the addresses that point at it.
import { describe, expect, it } from "vitest";
import { allianceText, favourite, oddsPct, shareFileName, shareHeadline, shareImagePath, sharePagePath } from "./share";
import { oddsPct as appOddsPct } from "../lib/format";

describe("share card text", () => {
  it("names alliances as people say them", () => {
    expect(allianceText([4215])).toBe("4215");
    expect(allianceText([4215, 16379])).toBe("4215 & 16379");
    expect(allianceText([4215, 16379, 21058])).toBe("4215, 16379 & 21058");
    expect(allianceText([])).toBe("");
  });

  it("1v1 and 2v2 headlines lead with the favourite", () => {
    expect(shareHeadline({ red: [4215], blue: [33950], pRed: 0.73 })).toBe("Our model gives 4215 a 73% win chance vs 33950");
    expect(shareHeadline({ red: [4215, 16379], blue: [33950, 21058], pRed: 0.73 })).toBe("Our model gives 4215 & 16379 a 73% win chance vs 33950 & 21058");
    // Blue favoured: blue leads, with blue's chance.
    expect(shareHeadline({ red: [4215, 16379], blue: [33950, 21058], pRed: 0.21 })).toBe("Our model gives 33950 & 21058 a 79% win chance vs 4215 & 16379");
    // A given P(blue) wins over 1 − P(red) (ties possible).
    expect(shareHeadline({ red: [1], blue: [2], pRed: 0.3, pBlue: 0.65 })).toBe("Our model gives 2 a 65% win chance vs 1");
    // A coin flip leads with red.
    expect(favourite({ red: [1], blue: [2], pRed: 0.5 }).side).toBe("red");
  });

  it("past tense once the match is played", () => {
    expect(shareHeadline({ red: [1, 2], blue: [3, 4], pRed: 0.6, played: true })).toBe("Our model gave 1 & 2 a 60% win chance vs 3 & 4");
  });

  it("rounds percentages exactly as the rest of the app (never a flat 0% or 100%)", () => {
    expect(appOddsPct).toBe(oddsPct);
    expect(oddsPct(0.725)).toBe("73%");
    expect(oddsPct(0.7249)).toBe("72%");
    expect(oddsPct(0.995)).toBe("99%");
    expect(oddsPct(0.9851)).toBe("99%");
    expect(oddsPct(0.984)).toBe("98%");
    expect(oddsPct(0.004)).toBe("1%");
    expect(oddsPct(1, true)).toBe("100%");
    expect(oddsPct(NaN)).toBe("—");
    expect(shareHeadline({ red: [1], blue: [2], pRed: 0.999 })).toBe("Our model gives 1 a 99% win chance vs 2");
    expect(shareHeadline({ red: [1], blue: [2], pRed: 0.0004 })).toBe("Our model gives 2 a 99% win chance vs 1");
  });

  it("builds the image, page and file addresses", () => {
    const q = { season: 2025, red: [4215, 16379], blue: [33950, 21058] };
    expect(shareImagePath(q)).toBe("/api/share/match.png?season=2025&red=4215,16379&blue=33950,21058");
    expect(shareImagePath({ ...q, format: "square" })).toBe("/api/share/match.png?season=2025&red=4215,16379&blue=33950,21058&format=square");
    expect(shareImagePath({ ...q, event: "USTXCMP", match: "qual:0:12" })).toBe("/api/share/match.png?season=2025&red=4215,16379&blue=33950,21058&event=USTXCMP&match=qual:0:12");
    // A match without its event isn't a match reference.
    expect(shareImagePath({ ...q, match: "qual:0:12" })).not.toContain("match=");
    expect(sharePagePath(q)).toBe("/predict?mode=match&season=2025&red=4215,16379&blue=33950,21058");
    expect(sharePagePath({ ...q, event: "USTXCMP", match: "qual:0:12" })).toBe("/events/2025/USTXCMP?tab=matches&match=qual%3A0%3A12");
    expect(shareFileName(q)).toBe("control-scout-4215-16379-vs-33950-21058.png");
    expect(shareFileName({ ...q, format: "square" })).toBe("control-scout-4215-16379-vs-33950-21058-square.png");
  });
});
