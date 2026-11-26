// The automatic tagger (./creatorTags.ts) on 206 real FUN Robotics Network videos (their public RSS feeds, fetched
// 2026-11-26: the channel's newest uploads and 18 of its playlists), with each number's team as the database held it.
// Tags go live with no one confirming them, so the bar is zero false tags: none on an FRC, VEX or drone video, none
// from a year, a score, a ranking or a VEX number, and a bare number only beside its team's name.
import { describe, expect, it } from "vitest";
import fx from "./__fixtures__/funVideos.json";
import { fold } from "../../src/shared/query/names";
import { nameForms, programOf, seasonOf, seriesOf, tagsOf, type TagLookups } from "./creatorTags";

type Team = { name: string | null; seasons: number[] };
const TEAMS = fx.teams as Record<string, Team>;
function lookups(teams: Record<string, Team>): TagLookups {
  const byName = new Map<string, number[]>();
  for (const [n, t] of Object.entries(teams)) { const f = fold(t.name ?? ""); if (f) byName.set(f, [...(byName.get(f) ?? []), Number(n)]); }
  return {
    team: (n) => teams[n],
    active: (n, s) => !!teams[n]?.seasons.some((x) => s == null || Math.abs(x - s) <= 1),
    named: (f) => byName.get(f) ?? [],
  };
}
const LOOK = lookups(TEAMS);

/** Each fixture video as the intake reads it: series and program from its playlists and words, then its tags. */
const read = fx.videos.map((v) => {
  const pls = v.playlists.map((p) => p.title);
  const series = seriesOf(v.title, pls);
  const program = programOf(v.title, v.description, pls, series ? pls.filter((t) => seriesOf("", [t]) === series) : []);
  const season = seasonOf(v.title, v.description, v.published);
  return { ...v, series, program, season, tags: tagsOf({ title: v.title, description: v.description, program, season }, LOOK) };
});
const byTitle = (t: string) => read.find((v) => v.title === t)!;

describe("the creator-video tagger on real FUN videos", () => {
  it("tags no FRC, VEX or drone video, though their numbers are FTC teams too", () => {
    const other = read.filter((v) => v.program !== "ftc");
    expect(other.length).toBeGreaterThan(100);
    expect(other.filter((v) => v.tags.length).map((v) => v.title)).toEqual([]);
    // 118 and 3075 are FTC team numbers as well as these FRC teams.
    expect(TEAMS[118]?.name).toBe("Steel Hornets");
    expect(byTitle("118 Robonauts | Behind the Bumpers | FRC REBUILT Robot").program).toBe("frc");
    expect(byTitle("3075 Ha-Dream Team | Behind the Bumpers | FRC REBUILT Robot").program).toBe("frc");
    expect(byTitle("Pivoting Piston Toggle Mech | 98601S Elixir (Troy) | V5RC Override Robot Rundown").program).toBe("vex");
    expect(byTitle("11V IRVINE RUIGUAN | Pits & Parts | V5RC Override Robot").program).toBe("vex");
    expect(byTitle("Aerial Drone Competition Playoffs 2026").program).toBe("unknown");
    expect(byTitle("Inside a TPU Printed Combat Robot | \"Something\" the Beetleweight").program).toBe("unknown");
  });

  it("takes the series from the channel's playlists: Behind the Bot (FTC), never Behind the Bumpers (FRC)", () => {
    expect(byTitle("21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot").series).toBe("behind-the-bot");
    // In the Behind the Bot playlist though its title names a Snapshot.
    expect(byTitle("Intake and Shooter on an Arm | 8628 Chickenados | FTC BIOBUZZ Shapshot").series).toBe("behind-the-bot");
    expect(byTitle("6328 Mechanical Advantage | Behind the Bumpers | FRC REBUILT Robot").series).toBeNull();
    expect(read.filter((v) => v.series === "behind-the-bot").every((v) => v.program === "ftc")).toBe(true);
    expect(byTitle("Week 1 FRC Top 25 | REBUILT 2026")).toMatchObject({ series: "top-25", program: "frc" });
    expect(byTitle("FTC Top 25 | DECODE | January - Presented by Studica Robotics")).toMatchObject({ series: "top-25", program: "ftc", season: 2025 });
    expect(byTitle("3946E Enigma | Pits & Parts | Override Robot")).toMatchObject({ series: "pits-and-parts", program: "vex" });
    expect(byTitle("Winning DECODE as the Lower Seed | FTC FUNalysis")).toMatchObject({ series: "funalysis", program: "ftc" });
  });

  it("tags each Behind the Bot team whose number and name are in the title", () => {
    const btb = read.filter((v) => v.series === "behind-the-bot").map((v) => [v.title, v.tags.map((t) => `${t.team} ${t.rule}`)]);
    expect(Object.fromEntries(btb)).toEqual({
      "21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot": ["21229 title:bare-name"],
      "Intake and Shooter on an Arm | 8628 Chickenados | FTC BIOBUZZ Shapshot": ["8628 title:bare-name"],
      "13684 Infinity Tech | Behind the Bot | FTC BIOBUZZ Robot": ["13684 title:bare-name"],
      "19705 WXYZ | Behind the Bot | FTC BIOBUZZ Ri3D Robot": ["19705 title:bare-name"],
      "A301 Motor and SystemCore Testing | Behind the Bot | 14906 Leviathan Robotics": ["14906 title:bare-name"],
      // Stored as CYBERMOON093: the digits after a name are dropped.
      "19256 CyberMoon | Behind the Bot | EU Premiere WAC": ["19256 title:bare-name"],
      "23286 Lazer Robotics | Behind the Bot | FTC DECODE Robot": ["23286 title:bare-name"],
      "18221 Meta^Infinity | Behind the Bot | FTC DECODE Robot": ["18221 title:bare-name"],
      "11329 I.C.E. Robotics | Behind the Bot | FTC DECODE Robot": ["11329 title:bare-name"],
      "32896 Droid Squad | Behind the Bot | FTC DECODE Robot": ["32896 title:bare-name"],
      "11260 Up-A-Creek Robotics | Behind the Bot | FTC DECODE Robot": ["11260 title:bare-name"],
      "10084 Team Calamari | Behind the Bot | FTC DECODE Robot": ["10084 title:bare-name"],
      "Aerospace Cables for Turret | 24006 LeXT--Watermelon Why? | DECODE Snapshot": ["24006 title:bare-name"],
      // The name beside the number isn't the team's on file (CRAB, The Marvels of MAS, NIS KYRAN): a bare number
      // needs its name, so no tag rather than a guess.
      "16010 Astra Machina | Behind the Bot | FTC BIOBUZZ Robot": [],
      "19564 ITKAN Solar | Behind the Bot | FTC DECODE Robot": [],
      "21058 Panheya (ᵔ ᵔ) | Behind the Bot | FTC DECODE Robot": [],
    });
  });

  it("finds every title tag beside its team's name, and no other", () => {
    const tags = read.flatMap((v) => v.tags.filter((t) => t.rule.startsWith("title:")).map((t) => ({ v, t })));
    expect(tags.map(({ t }) => t.team).sort((a, b) => a - b)).toEqual([5477, 6962, 8628, 8721, 9200, 9626, 9879, 10084, 10084, 11260, 11260, 11329, 12682, 12808, 13684, 14343, 14906,
      15991, 17011, 18221, 18225, 19013, 19256, 19376, 19502, 19660, 19705, 19862, 21229, 21229, 22105, 22489, 23286, 23305, 23334, 23400, 24006, 24180, 24290, 24697, 25609, 32896, 32896]);
    for (const { v, t } of tags) {
      const forms = nameForms(TEAMS[t.team].name);
      expect(forms.some((f) => fold(v.title).includes(`${t.team} ${f}`) || fold(v.title).includes(`${f} ${t.team}`)), v.title).toBe(true);
    }
  });

  it("tags a description's numbers only beside their names, and only on FTC videos", () => {
    const desc = read.flatMap((v) => v.tags.filter((t) => t.rule.startsWith("description:")).map((t) => ({ v, t })));
    expect(desc.length).toBeGreaterThan(20); // the Top 25 lists
    for (const { v, t } of desc) {
      expect(v.program).toBe("ftc");
      const forms = nameForms(TEAMS[t.team].name);
      expect(forms.some((f) => fold(v.description).includes(`${t.team} ${f}`) || fold(v.description).includes(`${f} ${t.team}`)), `${v.title}: ${t.team}`).toBe(true);
    }
  });
});

describe("the tagger's rules", () => {
  const teams: Record<string, Team> = {
    2026: { name: "Year Bots", seasons: [2025, 2026] },
    245: { name: "Scorers", seasons: [2025, 2026] },
    1: { name: "Uno", seasons: [2025, 2026] },
    25: { name: "Quarter", seasons: [2025, 2026] },
    24118: { name: "Vexed", seasons: [2025, 2026] },
    12345: { name: "Sample Robotics", seasons: [2025, 2026] },
    5000: { name: "Retired", seasons: [2015] },
    7777: { name: "Lucky Sevens", seasons: [2025] },
    8888: { name: "Twin Name", seasons: [2025] },
    8889: { name: "Twin Name", seasons: [2025] },
    300: { name: "Spartans", seasons: [2025] },
  };
  const look = lookups(teams);
  const tag = (title: string, description = "", season: number | null = 2025) => tagsOf({ title, description, program: "ftc", season }, look).map((t) => `${t.team} ${t.rule}`);

  it("tags a number with a cue, when the team is active around the video's season", () => {
    expect(tag("Robot reveal", "Team 12345 built this. Also #300 and FTC 7777.")).toEqual(["300 description:cue", "7777 description:cue", "12345 description:cue"]);
    expect(tag("FTC #12345 robot reveal")).toEqual(["12345 title:cue"]);
    // Not active for years: no tag.
    expect(tag("Team 5000 robot reveal")).toEqual([]);
  });

  it("never reads a year, a score, a count or a ranking as a team", () => {
    expect(tag("FTC 2026 Kickoff | BIOBUZZ", "The 2026 season starts now")).toEqual([]);
    expect(tag("Robot scores 245 points", "A 245 point match, #1 seed, #25 in the world, over 300 teams, $5000 a year, 60% of 1,245 matches")).toEqual([]);
    expect(tag("FTC Top 25 | DECODE")).toEqual([]);
    // With the name right beside it, a year-like number is the team.
    expect(tag("2026 Year Bots | Behind the Bot | FTC BIOBUZZ Robot")).toEqual(["2026 title:bare-name"]);
  });

  it("never reads a VEX-style number as a team", () => {
    expect(tag("FTC robot vs 24118E", "Team 24118E and #24118A, 24118E Vexed")).toEqual([]);
    expect(programOf("24118E Vexed | Robot Rundown", "", [])).toBe("vex");
  });

  it("tags a bare number only with its name beside it, either side", () => {
    expect(tag("Turret | 12345 Sample Robotics | FTC DECODE Snapshot")).toEqual(["12345 title:bare-name"]);
    expect(tag("Sample Robotics (12345) | FTC DECODE")).toEqual(["12345 title:bare-name"]);
    expect(tag("Turret | 12345 Other Name | FTC DECODE Snapshot")).toEqual([]);
  });

  it("tags a name with no number only on an exact, unique, whole title part", () => {
    expect(tag("Spartans | FTC DECODE Snapshot")).toEqual(["300 title:name"]);
    expect(tag("Twin Name | FTC DECODE Snapshot")).toEqual([]);
    expect(tag("The Spartans way of building | FTC DECODE")).toEqual([]);
  });

  it("tags nothing on a video that isn't FTC's", () => {
    for (const program of ["frc", "vex", "unknown"] as const) expect(tagsOf({ title: "12345 Sample Robotics | Team 7777", description: "", program, season: 2025 }, look)).toEqual([]);
    expect(programOf("FTC and FRC teams together", "", [])).toBe("unknown");
    expect(programOf("Can you guess this robot?", "#ftc #decode", [])).toBe("ftc");
  });

  it("reads the season from a game's name, else from the date (seasons start in September)", () => {
    expect(seasonOf("FTC Top 25 | Final Into the Deep", "", "2025-05-01T00:00:00Z")).toBe(2024);
    expect(seasonOf("Robot reveal", "", "2026-09-10T00:00:00Z")).toBe(2026);
    expect(seasonOf("Robot reveal", "", "2026-08-31T00:00:00Z")).toBe(2025);
  });
});
