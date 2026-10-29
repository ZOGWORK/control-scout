// The fact check Bruno's blurbs pass before publishing, and the templates that stand in.
import { describe, expect, it } from "vitest";
import { checkBlurb, checkIntro, compose, numbersIn, plainWeekText, seasonText, templateBlurb, templateIntro, type FactPacket, type PacketTeam } from "./factCheck";

const team = (o: Partial<PacketTeam> = {}): PacketTeam => ({
  team: 18360, name: "Roboteers 2.0", rank: 3, priorRank: 7, movement: 4, rating: 118.4, ratingDelta: 12.3,
  record: { wins: 9, losses: 1, ties: 0 }, opr: 98.06, lastEvent: { name: "Texas Championship", result: "Ranked 2 of 32; Winning alliance" }, ...o,
});
const packet = (teams: PacketTeam[] = [team()]): FactPacket => ({ season: 2025, week: "2026-w43", teams });

describe("numbers in text", () => {
  it("reads digits, signs, records, ranks, ordinals and number words", () => {
    expect(numbersIn("Up +4 to #3 after a 9-1-0 run, 3rd at states, OPR 1,234.5 and three wins").map((n) => n.value))
      .toEqual([4, 3, 9, 1, 0, 3, 1234.5, 3]);
  });
});

describe("a blurb passes when every number is the team's own", () => {
  const ok = [
    "Roboteers 2.0 jump 4 spots to #3 after a 9-1 run at the Texas Championship.",
    "Rating 118 (+12) and an OPR near 98: ranked 2 of 32 and on the winning alliance.",
    "A third-place spot in the top 5, with a rating of 118.4.",
    "Comfortably inside the top five again.",
    "Up four places this week 43, and still in the top 25.",
    "18360 keep climbing: 10 matches, 9 wins.",
  ];
  for (const text of ok) it(text, () => expect(checkBlurb(text, team(), packet())).toEqual({ ok: true, reasons: [] }));
});

describe("a blurb fails", () => {
  const cases: [string, string, RegExp][] = [
    ["an invented number", "They scored 245 points in the final.", /unknown number "245"/],
    ["an invented record", "A perfect 12-0 run.", /record "12-0" isn't the team's 9-1-0/],
    ["a made-up score", "Won the final 120-95.", /record "120-95"/],
    ["a team number that isn't in the packet", "They edged out 4215 in the semis.", /unknown number "4215"/],
    ["a wrong rounding", "Rating 117 this week.", /unknown number "117"/],
    ["a top-N claim the rank doesn't support", "Firmly in the top 2.", /doesn't fit rank 3/],
    ["a spelled-out top-N claim the rank doesn't support", "Firmly in the top two.", /"top two" doesn't fit rank 3/],
    ["FTC Scout", "Their FTC Scout page tells the story.", /another site/],
    ["ftcscout.org", "See ftcscout.org for more.", /another site/],
    ["The Orange Alliance", "Long a favourite on The Orange Alliance.", /another site/],
    ["a link", "Watch at https://youtube.com/x", /another site/],
    ["too long", Array.from({ length: 61 }, () => "go").join(" "), /61 words/],
    ["empty", "   ", /empty/],
  ];
  for (const [label, text, why] of cases) {
    it(label, () => {
      const c = checkBlurb(text, team(), packet());
      expect(c.ok).toBe(false);
      expect(c.reasons.join("; ")).toMatch(why);
    });
  }

  it("another team's number from the packet still fails in this team's blurb", () => {
    const other = team({ team: 4215, name: "Hypnotic", rank: 1, priorRank: 1, movement: 0, rating: 150, ratingDelta: null, opr: 130, record: null, lastEvent: null });
    expect(checkBlurb("Chasing 4215 for the top spot.", team(), packet([other, team()])).ok).toBe(false);
    // In the intro, any packet number is fine.
    expect(checkIntro("4215 leads at 150; 18360 climbs 4 to #3.", packet([other, team()])).ok).toBe(true);
  });
});

describe("templates", () => {
  it("the data-only blurb, and it passes its own check", () => {
    const t = templateBlurb(team(), true);
    expect(t).toBe("Up 4 to #3, 9-1 this season, last at Texas Championship (Ranked 2 of 32; Winning alliance); rating 118.4 (+12.3), OPR 98.1.");
    expect(checkBlurb(t, team(), packet()).ok).toBe(true);
  });
  it("down, holding, new, and no previous week", () => {
    expect(templateBlurb(team({ movement: -2, priorRank: 1 }), true)).toMatch(/^Down 2 to #3/);
    expect(templateBlurb(team({ movement: 0, priorRank: 3 }), true)).toMatch(/^Holds #3/);
    expect(templateBlurb(team({ movement: null, priorRank: null }), true)).toMatch(/^New to the top 25 at #3/);
    expect(templateBlurb(team({ movement: null, priorRank: null, ratingDelta: -1.25, record: null, lastEvent: null, opr: null }), false)).toBe("#3; rating 118.4 (−1.3).");
    for (const t of [team({ movement: -2, priorRank: 1, ratingDelta: -4 }), team({ movement: null, priorRank: null })]) {
      expect(checkBlurb(templateBlurb(t, true), t, packet([t])).ok).toBe(true);
    }
  });
  it("the intro names the leader and the biggest climber, and passes its check", () => {
    const p = packet([team({ rank: 1, movement: 0, priorRank: 1, team: 4215, name: "Hypnotic" }), team({ rank: 2, movement: 5, priorRank: 7 }), team({ team: 7, rank: 3, priorRank: null, movement: null })]);
    const intro = templateIntro(p, "2026-10-23", true);
    expect(intro).toBe("This week's top 3, from the live world ranking as of Friday, Oct 23. 4215 Hypnotic leads with a rating of 118.4. 18360 Roboteers 2.0 made the biggest climb, up 5 to #2. 1 team is new to the list.");
    expect(checkIntro(intro, p, "2026-10-23").ok).toBe(true);
    expect(checkIntro(intro, p).ok).toBe(false); // the date's day is allowed only as the publish date
  });
});

describe("compose", () => {
  const p = packet([team({ team: 1, rank: 1 }), team({ team: 2, rank: 2 }), team({ team: 3, rank: 3 })]);
  it("keeps Bruno's blurbs that pass, templates the rest (failed, missing), and records why", () => {
    const c = compose(p, {
      intro: "What a week at the top.",
      blurbs: [
        { team: 1, text: "Team 1 rolls on at #1 with a 9-1 record." },
        { team: 2, text: "Team 2 posted a 300-point high score." },
      ],
    }, "2026-10-23", true);
    expect(c.introSource).toBe("bruno");
    expect(c.entries.map((e) => e.source)).toEqual(["bruno", "template", "template"]);
    expect(c.entries[1].rejected).toEqual(['unknown number "300"']);
    expect(c.entries[2].rejected).toEqual(["no blurb"]);
  });
  it("no answer from Bruno: every blurb and the intro are the template", () => {
    const c = compose(p, null, "2026-10-23", true);
    expect(c.introSource).toBe("template");
    expect(c.entries.every((e) => e.source === "template" && !e.rejected)).toBe(true);
  });
  it("an intro that fails the check is the template", () => {
    expect(compose(p, { intro: "Check FTCScout for 999 more.", blurbs: [] }, "2026-10-23", true).introSource).toBe("template");
  });
});

describe("the week and season in Bruno's words", () => {
  it("a raw week id becomes \"week 43\" and a bare season year its label, before the check", () => {
    expect(plainWeekText("Welcome to week 2026-w43 of the 2025 season.", { season: 2025 })).toBe("Welcome to week 43 of the 2025–26 season.");
    expect(plainWeekText("Week 2026-w43: 2026-w43 is here.", { season: 2025 })).toBe("Week 43: week 43 is here.");
    // Another year's season is left as written (and the check judges it).
    expect(plainWeekText("Best since the 2019 season.", { season: 2025 })).toBe("Best since the 2019 season.");
  });

  it("compose publishes the plain wording, and it still passes the check", () => {
    const c = compose(packet(), { intro: "Welcome to the power rankings for week 2026-w43 of the 2025 season.", blurbs: [{ team: 18360, text: "Roboteers 2.0 climb to #3 in week 2026-w43." }] }, "2026-10-23", true);
    expect(c.intro).toBe("Welcome to the power rankings for week 43 of the 2025–26 season.");
    expect(c.introSource).toBe("bruno");
    expect(c.entries[0]).toMatchObject({ source: "bruno", text: "Roboteers 2.0 climb to #3 in week 43." });
    expect(seasonText(2026)).toBe("2026–27");
  });
});
