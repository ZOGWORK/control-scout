// Highlights over any scope, through the pipeline end to end (./highlights.ts, ./execute.ts): Worlds, one division, a
// championship with its divisions, a region, a season, a team, a team at an event or at Worlds, a team that wasn't
// there. Each match listed once with its reason, the latest season with matches read when none is said (stated once,
// in the chip), and the best match's video on the card.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { answerVideo } from "../answers/video";
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../src/shared/searchStat";

// Wednesday 2026-03-18: the current season is 2025–26, whose Worlds (in April) hasn't been played.
const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
const stat = async (q: string) => (await ask(q)).stat as StatAnswer;
const rows = (s: StatAnswer): StatMatchRow[] => s.blocks.flatMap((b) => (b.kind === "matches" ? b.rows : []));
const codeOf = (r: StatMatchRow) => /^\/events\/\d{4}\/([^?]+)/.exec(r.href)![1];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string][] = [[4215, "Hypnotic Robotics", "NJ"], [6980, "Bad Wolf", "NJ"], [10809, "Crow Force", "CA"], [5555, "Golden Bots", "CA"], [7149, "Enforcers", "TX"], [23268, "Ultraviolet", "TX"],
    // A second team by the same name, elsewhere: named with its place, the one there.
    [20245, "Ultraviolet", "MI"]];
  for (const [n, name, state] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const s of [2024, 2025]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string, state: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, division_code, source) VALUES (?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, ?, 't')", [season, code, name, type, state, start, start, division]);
  const CMP = "FIRST Championship - FIRST Tech Challenge";
  await ev(2024, "FTCCMP1", CMP, "FIRSTChampionship", "2025-04-19", "TX");
  await ev(2024, "FTCCMP1JACK", `${CMP} - Jackson Division`, "FIRSTChampionship", "2025-04-17", "TX", "FTCCMP1");
  await ev(2024, "FTCCMP1ROSS", `${CMP} - Ross Division`, "FIRSTChampionship", "2025-04-17", "TX", "FTCCMP1");
  await ev(2024, "USNJCMP", "New Jersey Championship", "Championship", "2025-03-08", "NJ");
  await ev(2024, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2025-03-08", "NJ", "USNJCMP");
  await ev(2024, "USCAQ1", "Golden Qualifier", "Qualifier", "2025-01-11", "CA");
  // 2025–26: Worlds listed, not played; a New Jersey qualifier played.
  await ev(2025, "FTCCMP1", CMP, "FIRSTChampionship", "2026-04-29", "TX");
  await ev(2025, "FTCCMP1JACK", `${CMP} - Jackson Division`, "FIRSTChampionship", "2026-04-27", "TX", "FTCCMP1");
  await ev(2025, "USNJQ1", "Garden Qualifier", "Qualifier", "2026-01-10", "NJ");
  await ev(2025, "USTXQ1", "Lone Star Qualifier", "Qualifier", "2026-02-07", "TX");
  await ev(2025, "USCOQ1", "Peak Qualifier", "Qualifier", "2026-02-14", "CO");
  let n = 0;
  const match = async (season: number, code: string, level: "qual" | "playoff", series: number, label: string, day: string, red: [number, number, number], blue: [number, number, number], reds: number[], blues: number[], video: string | null = null) => {
    n++;
    // [total, points without penalties, auto]
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, blue_total, blue_np, blue_auto, video, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 't')`, [season, code, level, series, n, label, `${day}T10:00:00Z`, red[0], red[1], red[2], blue[0], blue[1], blue[2], video]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", [season, code, level, series, n, t, a]);
      await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, 1)", [season, code, t]);
    }
  };
  // Worlds 2024–25: the best score in Jackson (with its video), the biggest margin in Ross, the final last.
  await match(2024, "FTCCMP1JACK", "qual", 0, "Q16", "2025-04-17", [520, 500, 120], [300, 290, 60], [7149], [23268], "https://www.youtube.com/watch?v=abcdefghijk");
  await match(2024, "FTCCMP1JACK", "qual", 0, "Q17", "2025-04-17", [301, 300, 150], [300, 299, 70], [23268], [7149]);
  await match(2024, "FTCCMP1ROSS", "qual", 0, "Q3", "2025-04-17", [450, 440, 90], [40, 40, 10], [4215], [6980]);
  await match(2024, "FTCCMP1ROSS", "playoff", 1, "M1", "2025-04-18", [380, 370, 80], [350, 345, 75], [4215], [6980]);
  await match(2024, "FTCCMP1", "playoff", 0, "F1", "2025-04-19", [400, 395, 100], [410, 405, 95], [4215], [7149]);
  // New Jersey 2024–25: the championship and its division.
  await match(2024, "USNJCMPPKWY", "qual", 0, "Q1", "2025-03-08", [250, 240, 50], [100, 100, 20], [4215], [6980]);
  await match(2024, "USNJCMP", "playoff", 0, "F1", "2025-03-08", [200, 195, 40], [210, 205, 45], [4215], [6980]);
  // California 2024–25: the season's best score anywhere.
  await match(2024, "USCAQ1", "qual", 0, "Q1", "2025-01-11", [600, 590, 130], [200, 200, 40], [10809], [5555]);
  // New Jersey 2025–26.
  await match(2025, "USNJQ1", "qual", 0, "Q1", "2026-01-10", [180, 175, 30], [120, 120, 25], [4215], [6980]);
  await match(2025, "USNJQ1", "qual", 0, "Q2", "2026-01-10", [130, 130, 35], [129, 125, 20], [6980], [4215]);
  // Texas 2025–26: a double-elimination bracket numbered from 0, its opening match series 0, the final series 5.
  // Its qualifications take the best score and the biggest margin, so the latest playoff match is the bracket's to say.
  await match(2025, "USTXQ1", "qual", 0, "Q1", "2026-02-07", [200, 200, 50], [150, 150, 5], [7149], [23268]);
  await match(2025, "USTXQ1", "qual", 0, "Q2", "2026-02-07", [100, 100, 10], [20, 20, 5], [7149], [23268]);
  await match(2025, "USTXQ1", "playoff", 0, "M1", "2026-02-07", [90, 90, 10], [80, 80, 10], [7149], [23268]);
  await match(2025, "USTXQ1", "playoff", 5, "M6", "2026-02-07", [95, 95, 10], [70, 70, 10], [7149], [23268]);
  // Colorado 2025–26: its final is also its best score, so its highlights list it as that, not as the latest playoff.
  await match(2025, "USCOQ1", "qual", 0, "Q1", "2026-02-14", [100, 100, 10], [90, 90, 10], [7149], [23268]);
  await match(2025, "USCOQ1", "playoff", 1, "M1", "2026-02-14", [120, 120, 10], [100, 100, 10], [7149], [23268]);
  await match(2025, "USCOQ1", "playoff", 2, "M2", "2026-02-14", [300, 300, 10], [100, 100, 10], [7149], [23268]);
  await rebuildSearch();
  clearAllCaches();
});

describe("highlights over a scope", () => {
  it("worlds highlights: the latest Worlds played, said once in the chip; each match once with its reason", async () => {
    const a = await ask("worlds highlights");
    const s = a.stat as StatAnswer;
    expect(s.intent).toBe("scope-highlights");
    expect(s.title).toBe("Highlights at Worlds, 2024–25");
    expect(s.scope[0]).toBe("No 2025–26 matches yet at Worlds; showing 2024–25");
    expect(s.scope.filter((c) => c.includes("2025–26"))).toHaveLength(1);
    const rs = rows(s);
    expect(rs.map((r) => [r.note, r.label, codeOf(r)])).toEqual([
      ["Best score", "Q16", "FTCCMP1JACK"], ["Biggest margin", "Q3", "FTCCMP1ROSS"], ["Latest playoff match", "F1", "FTCCMP1"],
      ["Best Auto", "Q17", "FTCCMP1JACK"], ["Closest finish", "M1", "FTCCMP1ROSS"],
    ]);
    expect(new Set(rs.map((r) => r.href)).size).toBe(rs.length);
    // Each row is the alliance its reason is about: the final's winner was blue.
    expect(rs[2]).toMatchObject({ alliance: "blue", own: 410, opp: 400, result: "W" });
    expect(s.headline).toMatchObject({ value: "500 points", href: rs[0].href });
  });

  it("the best match's video plays on the card", async () => {
    const v = await answerVideo(await ask("worlds highlights"));
    expect(v?.main).toMatchObject({ videoId: "abcdefghijk", kind: "match", match: "Q16" });
  });

  it("one division: that division's matches only, its dates and place in the chips", async () => {
    for (const q of ["jackson division highlights", "worlds jackson division highlights", "worlds highlights jackson division"]) {
      const s = await stat(q);
      expect(s.title, q).toBe("Highlights at Worlds · Jackson Division, 2024–25");
      expect(rows(s).map((r) => `${codeOf(r)} ${r.label}`), q).toEqual(["FTCCMP1JACK Q16", "FTCCMP1JACK Q17"]);
      expect(s.scope, q).toEqual(["No 2025–26 matches yet at Worlds · Jackson Division; showing 2024–25", "2024–25", "Apr 17, 2025", "Town, TX", "Official events"]);
    }
  });

  it("a championship named: it and its divisions, never the region's other events", async () => {
    const s = await stat("nj championship highlights");
    expect(s.title).toBe("Highlights at New Jersey Championship, 2024–25");
    expect(rows(s).map((r) => codeOf(r)).sort()).toEqual(["USNJCMP", "USNJCMPPKWY"]);
  });

  it("a calendar year with an event is the one held that year", async () => {
    const s = await stat("nj championship highlights 2025");
    expect(s.title).toBe("Highlights at New Jersey Championship, 2024–25");
    expect(s.scope.some((c) => /^No /.test(c))).toBe(false);
  });

  it("a region: the current season when it has matches, no relaxation said", async () => {
    const s = await stat("new jersey highlights");
    expect(s.title).toBe("Highlights in New Jersey, 2025–26");
    expect(s.scope.some((c) => /^No /.test(c))).toBe(false);
    // Two matches: the second is the biggest margin left, and nothing is left for a closest finish.
    expect(rows(s).map((r) => [r.note, r.label, codeOf(r)])).toEqual([["Best score", "Q1", "USNJQ1"], ["Biggest margin", "Q2", "USNJQ1"]]);
    const named = await stat("new jersey highlights 2024-25");
    expect(rows(named).map((r) => codeOf(r)).sort()).toEqual(["USNJCMP", "USNJCMPPKWY"]);
  });

  it("a season said: everywhere that season, as asked", async () => {
    const s = await stat("highlights 2024-25");
    expect(s.title).toBe("Highlights, 2024–25");
    expect(s.scope.some((c) => /^No /.test(c))).toBe(false);
    expect(rows(s)[0]).toMatchObject({ note: "Best score", label: "Q1", own: 600 });
    expect(codeOf(rows(s)[0])).toBe("USCAQ1");
  });

  it("other ways of saying it read the same: best matches, top moments", async () => {
    for (const q of ["top moments at worlds", "best matches at worlds", "best worlds videos"]) {
      expect((await stat(q)).title, q).toBe("Highlights at Worlds, 2024–25");
    }
  });

  it("highlights: the standout matches, then every match's video and each event's stream", async () => {
    const s = await stat("worlds jackson division highlights");
    expect(s.blocks.map((b) => b.kind)).toEqual(["matches", "videos"]);
    const v = s.blocks[1] as Extract<StatBlock, { kind: "videos" }>;
    expect(v.tiles.map((t) => [t.label, t.red, t.blue, t.redScore, t.blueScore, t.level])).toEqual([["Q16", [7149], [23268], 520, 300, "qual"], ["Q17", [23268], [7149], 301, 300, "qual"]]);
    expect(v.streams).toEqual([{ label: "Worlds · Jackson Division", href: "/events/2024/FTCCMP1JACK" }]);
    // No line of its own when nothing has a video: the highlights say so.
    expect(v.empty).toBeUndefined();
  });

  it("a recap, the videos, a replay, a stream: a video page, every match first, led by the latest playoff match", async () => {
    for (const q of ["worlds recap", "worlds videos", "watch worlds", "worlds replay", "worlds vods", "worlds stream"]) {
      const s = await stat(q);
      expect(s.title, q).toBe("Match videos at Worlds, 2024–25");
      expect(s.blocks.map((b) => b.kind), q).toEqual(["videos"]);
      expect(s.headline?.label, q).toBe("Latest playoff match: F1 at Worlds finals");
    }
    const v = (await stat("worlds recap")).blocks[0] as Extract<StatBlock, { kind: "videos" }>;
    // Across divisions: each tile says its event; the divisions before the finals they feed.
    expect(v.tiles.map((t) => `${t.event} ${t.label}`)).toEqual(["Worlds · Jackson Division Q16", "Worlds · Jackson Division Q17", "Worlds · Ross Division Q3", "Worlds · Ross Division M1", "Worlds finals F1"]);
    expect(v.streams?.map((l) => l.label)).toEqual(["Worlds · Jackson Division", "Worlds · Ross Division", "Worlds finals"]);
    expect(v.empty?.text).toBe("No match videos at Worlds in 2024–25 yet.");
  });

  it("a calendar year with Worlds is the Worlds held that year", async () => {
    const s = await stat("worlds highlights 2025");
    expect(s.title).toBe("Highlights at Worlds, 2024–25");
    expect(s.scope.some((c) => /^No /.test(c))).toBe(false);
  });

  it("Worlds' divisions said with no team are every division, as Worlds is (failed-search #844, #784)", async () => {
    for (const q of ["worlds division highlights", "WORLDS divisions highlights"]) expect((await stat(q)).title, q).toBe("Highlights at Worlds, 2024–25");
  });

  it("a count asked for: at most that many", async () => {
    expect(rows(await stat("top 2 highlights at worlds")).map((r) => r.note)).toEqual(["Best score", "Biggest margin"]);
  });

  it("a double-elimination bracket numbered from 0: its last match is the latest, never the opening one", async () => {
    const s = await stat("texas highlights");
    expect(rows(s).find((r) => r.note === "Latest playoff match")?.label).toBe("M6");
  });

  it("a match's number is that match, never the highlights", async () => {
    expect((await ask("jackson division q16 video")).stat?.intent).not.toBe("scope-highlights");
  });

  it("recent highlights, no team or event: the latest week of play's standout matches (failed-search #1205)", async () => {
    // The latest day played is Colorado's (Feb 14): its week is Feb 8–14, so Texas (Feb 7) is out.
    const s = await stat("recent highlights");
    expect(s.intent).toBe("scope-highlights");
    expect(s.title).toBe("Recent highlights, 2025–26");
    expect(s.scope).toContain("Feb 8–14, 2026");
    expect(new Set(rows(s).map(codeOf))).toEqual(new Set(["USCOQ1"]));
    expect(s.source).toBe("From 3 played matches on Feb 8–14, 2026");
    // Another measure word before it keeps the week.
    expect((await stat("best recent highlights")).title).toBe("Recent highlights, 2025–26");
    // With a place: that place's latest week.
    const nj = await stat("new jersey recent highlights");
    expect(nj.title).toBe("Recent highlights in New Jersey, 2025–26");
    expect(new Set(rows(nj).map(codeOf))).toEqual(new Set(["USNJQ1"]));
    // A team or an event said already says which matches: read as before.
    expect((await stat("4215 recent highlights")).intent).toBe("team-highlights");
  });
});

describe("a team's highlights", () => {
  it("its season, by number or by name, in any order", async () => {
    for (const q of ["4215 highlights 2024-25", "hypnotic robotics match highlights 2024-25", "highlights 2024-25 hypnotic robotics"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("team-highlights");
      expect(a.stat?.team?.number, q).toBe(4215);
      expect(a.stat?.title, q).toBe("Highlights, 2024–25");
    }
  });

  it("by part of its name, or by a name two teams share with the place said (failed-search #1003, #992)", async () => {
    for (const [q, team] of [["hypnotic highlights 2024-25", 4215], ["Hypnotic videos 2024-25", 4215], ["ultraviolet texas highlights 2024-25", 23268], ["Ultraviolet tx highlights 2024-25", 23268]] as const) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("team-highlights");
      expect(a.stat?.team?.number, q).toBe(team);
    }
    // A place that limits the event stays the event's (Greptile on #1197): the team's highlights at NJ states.
    expect((await stat("hypnotic highlights at nj states 2024-25")).title).toMatch(/New Jersey/);
    // A word that only starts no word of the team found is never read as that team.
    expect((await ask("robotic stuff highlights 2024-25")).stat?.team).toBeUndefined();
  });

  it("at an event: only its matches there, never padded from other events; the event said once, in the title", async () => {
    const s = await stat("4215 highlights at nj championship");
    expect(s.title).toBe("Highlights at New Jersey Championship - Parkway Division, 2024–25");
    expect(rows(s).map((r) => `${codeOf(r)} ${r.label} ${r.note}`)).toEqual(["USNJCMPPKWY Q1 Best score"]);
  });

  it("at Worlds: the latest Worlds it played, its division and the finals, said in the title", async () => {
    for (const q of ["4215 highlights at worlds", "best matches 4215 at worlds", "hypnotic robotics highlights at worlds"]) {
      const s = await stat(q);
      expect(s.intent, q).toBe("team-highlights");
      expect(s.title, q).toBe("Highlights at Worlds · Ross Division, 2024–25");
      expect(rows(s).every((r) => /^FTCCMP1/.test(codeOf(r))), q).toBe(true);
      expect(rows(s).length, q).toBeLessThanOrEqual(3);
    }
  });

  it("at a state championship in a place, or at the Worlds held in a year", async () => {
    const s = await stat("4215 highlights at nj states");
    expect(s.intent).toBe("team-highlights");
    expect(s.title).toBe("Highlights at New Jersey Championship - Parkway Division, 2024–25");
    expect((await stat("4215 highlights at worlds 2025")).title).toBe("Highlights at Worlds · Ross Division, 2024–25");
    expect(rows(await stat("top 2 4215 highlights at worlds"))).toHaveLength(2);
    expect((await ask("4215 top 0 highlights")).stat?.intent).not.toBe("team-highlights");
  });

  it("a recap leads with the last playoff match even when its highlights list it under another reason", async () => {
    expect((await stat("colorado highlights")).headline?.label).toBe("Best score without penalties: M2 at Peak Qualifier");
    expect((await stat("colorado recap")).headline).toMatchObject({ label: "Latest playoff match: M2 at Peak Qualifier", value: "300 points" });
  });

  it("a team's videos lead with its last playoff match, won or lost", async () => {
    // 4215's Worlds: it won its division's M1 and lost the final.
    expect((await stat("4215 videos at worlds")).headline?.label).toMatch(/^Latest playoff match: F1 at /);
  });

  it("a team's videos: every match it played there, its own events' streams", async () => {
    const s = await stat("4215 videos at worlds");
    expect(s.title).toBe("Match videos at Worlds · Ross Division, 2024–25");
    expect(s.blocks.map((b) => b.kind)).toEqual(["videos"]);
    const v = s.blocks[0] as Extract<StatBlock, { kind: "videos" }>;
    expect(v.tiles.map((t) => [t.label, t.red, t.blue])).toEqual([["Q3", [4215], [6980]], ["M1", [4215], [6980]], ["F1", [4215], [7149]]]);
    expect(v.empty).toMatchObject({ href: "/teams/4215?season=2024" });
  });

  it("a team's highlights: its standout matches first, then every match's video", async () => {
    expect((await stat("4215 highlights at worlds")).blocks.map((b) => b.kind)).toEqual(["matches", "videos"]);
  });

  it("a team that didn't play the event named: said so, with its own events, never another team's matches", async () => {
    const a = await ask("10809 highlights at worlds");
    const s = a.stat as StatAnswer;
    expect(s.title).toBe("No highlights at the FIRST Championship");
    expect(s.none).toBe("Crow Force (10809) has no played matches at the FIRST Championship. Its 2024–25 events are below.");
    expect(s.blocks).toEqual([{ kind: "links", title: "Its 2024–25 events", items: [{ label: "Golden Qualifier", sub: "Jan 11, 2025", href: "/events/2024/USCAQ1?team=10809" }] }]);
    expect(rows(s)).toEqual([]);
    expect(a.hits.map((h) => h.ref)).toEqual(["10809"]);
  });
});
