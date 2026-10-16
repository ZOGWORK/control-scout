// The power-rankings file format: parsing, every validation error, movement, scaffolding.
import { describe, expect, it } from "vitest";
import { droppedOut, movements, parseRankings, scaffold, type RankingDoc } from "./format";
import { isWeekId, weekIdOf, weekLabel, weekStart } from "../../src/shared/powerRankings";

const FM = ["---", "title: Power rankings, week 42", "season: 2025", "week: 2026-w42", "published: 2026-10-19", "intro: |", "  First paragraph.", "", "  Second *paragraph*.", "---", ""];
const entry = (rank: number, team: number, extra = "") => `## ${rank}. ${team}${extra}\nBlurb for ${team}, with **bold**.\n`;
const file = (teams: number[] = Array.from({ length: 25 }, (_, i) => 1000 + i), fm = FM) => [...fm, ...teams.map((t, i) => entry(i + 1, t))].join("\n");
const errorsOf = (text: string, name = "2026-w42.md") => { const r = parseRankings(text, name); return r.ok ? [] : r.errors; };

describe("parseRankings", () => {
  it("reads a good file: front-matter, a block intro, 25 entries in order", () => {
    const r = parseRankings(file(), "2026-w42.md");
    expect(r.ok).toBe(true);
    const d = (r as { doc: RankingDoc }).doc;
    expect(d).toMatchObject({ week: "2026-w42", season: 2025, title: "Power rankings, week 42", published: "2026-10-19", sample: false });
    expect(d.intro).toBe("First paragraph.\n\nSecond *paragraph*.");
    expect(d.entries).toHaveLength(25);
    expect(d.entries[0]).toEqual({ rank: 1, team: 1000, blurb: "Blurb for 1000, with **bold**.", movement: null });
    expect(d.entries[24].rank).toBe(25);
  });

  it("ignores the team name after the number, reads an optional {movement}, tolerates CRLF and a BOM", () => {
    const teams = Array.from({ length: 25 }, (_, i) => 2000 + i);
    const text = "﻿" + [...FM, ...teams.map((t, i) => entry(i + 1, t, i === 0 ? " Hypnotic Robotics {+3}" : i === 1 ? " {new}" : i === 2 ? " Team Name {=}" : i === 3 ? " {-2}" : ""))].join("\r\n");
    const r = parseRankings(text, "2026-w42.md");
    expect(r.ok).toBe(true);
    const e = (r as { doc: RankingDoc }).doc.entries;
    expect(e[0]).toMatchObject({ team: 2000, movement: { kind: "up", by: 3 } });
    expect(e[1].movement).toEqual({ kind: "new" });
    expect(e[2].movement).toEqual({ kind: "same" });
    expect(e[3].movement).toEqual({ kind: "down", by: 2 });
    expect(e[4].movement).toBeNull();
  });

  it("wrong count: 24 or 26 entries", () => {
    expect(errorsOf(file(Array.from({ length: 24 }, (_, i) => 1000 + i)))).toContain("found 24 entries; a week has exactly 25");
    expect(errorsOf(file(Array.from({ length: 26 }, (_, i) => 1000 + i)))).toContain("found 26 entries; a week has exactly 25");
  });

  it("a malformed team number is an error, never a shorter team", () => {
    for (const bad of ["19066.5", "4215x", "4215,"]) {
      const text = file().replace("## 3. 1002", `## 3. ${bad}`);
      expect(errorsOf(text).some((e) => /an entry heading must look like "## 1\. 4215"/.test(e)), bad).toBe(true);
    }
  });

  it("a duplicate team names both places", () => {
    const teams = Array.from({ length: 25 }, (_, i) => 1000 + i);
    teams[9] = 1002;
    expect(errorsOf(file(teams))).toContain("team 1002 is listed twice (#3 and #10)");
  });

  it("bad team numbers, ranks out of order, malformed headings, text before the first entry", () => {
    const teams = Array.from({ length: 25 }, (_, i) => 1000 + i);
    const text = [...FM, "Stray words.", ...teams.map((t, i) => entry(i === 4 ? 9 : i + 1, i === 2 ? 1234567 : t))].join("\n").replace("## 8. 1007", "## Eight: 1007");
    const errs = errorsOf(text);
    expect(errs.some((e) => /1234567 isn't a valid FTC team number/.test(e))).toBe(true);
    expect(errs).toContain("entry 5 is numbered 9: entries go 1 to 25 in order");
    expect(errs.some((e) => /an entry heading must look like "## 1\. 4215"/.test(e))).toBe(true);
    expect(errs.some((e) => /^line 12: text before the first entry/.test(e))).toBe(true);
  });

  it("bad front-matter: missing, unknown and malformed keys, a week that isn't the file's", () => {
    expect(errorsOf(file().replace(/^---\n/, ""))[0]).toMatch(/must start with front-matter/);
    const fm = (lines: string[]) => errorsOf(file(undefined, ["---", ...lines, "---", ""]));
    const errs = fm(["title: T", "season: 25", "week: 2026-w54", "published: 2026-02-30", "intro: hi", "colour: red"]);
    expect(errs).toContain('front-matter: unknown key "colour" (expected title, season, week, published, intro, sample)');
    expect(errs).toContain('front-matter: season "25" must be a year like 2025 (the season\'s first year)');
    expect(errs).toContain('front-matter: week "2026-w54" isn\'t an ISO week like 2026-w42');
    expect(errs).toContain('front-matter: published "2026-02-30" must be a date like 2026-10-19');
    expect(fm(["title: T", "season: 2025", "week: 2026-w41", "published: 2026-10-19", "intro: hi"])).toContain("front-matter: week 2026-w41 doesn't match the file name (2026-w42.md)");
    expect(fm(["season: 2025", "week: 2026-w42", "published: 2026-10-19"])).toEqual(['front-matter: "title" is missing', 'front-matter: "intro" is missing']);
    expect(fm(["title: T", "title: U", "season: 2025", "week: 2026-w42", "published: 2026-10-19", "intro: hi"])).toContain('front-matter: "title" is given twice');
    expect(fm(["title: T", "season: 2025", "week: 2026-w42", "published: 2026-10-19", "intro: hi", "sample: yes"])).toContain("front-matter: sample must be true or false");
    expect(fm(["just words"])[0]).toMatch(/expected "key: value"/);
  });

  it("quoted values; sample: true", () => {
    const r = parseRankings(file(undefined, ["---", 'title: "Week 42: the big one"', "season: 2025", "week: 2026-W42", "published: 2026-10-19", "intro: 'Short.'", "sample: true", "---", ""]), "2026-w42.md");
    expect(r.ok && r.doc).toMatchObject({ title: "Week 42: the big one", intro: "Short.", week: "2026-w42", sample: true });
  });

  it("refuses unwritten (TODO), empty and overlong blurbs and intros", () => {
    const teams = Array.from({ length: 25 }, (_, i) => 1000 + i);
    let text = file(teams).replace("Blurb for 1003, with **bold**.", "TODO: blurb.").replace("Blurb for 1005, with **bold**.", "").replace("Blurb for 1006, with **bold**.", "x".repeat(701));
    text = text.replace("First paragraph.", "TODO: intro");
    const errs = errorsOf(text);
    expect(errs.some((e) => /^entry #4 \(line \d+\): the blurb still says TODO$/.test(e))).toBe(true);
    expect(errs.some((e) => /^entry #6 \(line \d+\): the blurb is empty$/.test(e))).toBe(true);
    expect(errs.some((e) => /^entry #7 \(line \d+\): the blurb is 701 characters \(at most 700\)$/.test(e))).toBe(true);
    expect(errs).toContain("front-matter: the intro still says TODO");
  });
});

describe("movement vs the previous week", () => {
  const doc = (teams: number[], moves: (RankingDoc["entries"][number]["movement"])[] = []) => ({ entries: teams.map((team, i) => ({ rank: i + 1, team, blurb: "b", movement: moves[i] ?? null })) });

  it("up, down, same and new against the previous list; who dropped out", () => {
    const prev = doc([10, 20, 30, 40, 50]);
    const now = doc([30, 20, 10, 60, 40]);
    expect(movements(now, prev)).toEqual([{ kind: "up", by: 2 }, { kind: "same" }, { kind: "down", by: 2 }, { kind: "new" }, { kind: "down", by: 1 }]);
    expect(droppedOut(now, prev)).toEqual([{ team: 50, lastRank: 5 }]);
  });

  it("no previous week: the author's own notes, else none; computed moves win over notes", () => {
    const now = doc([1, 2, 3], [{ kind: "up", by: 4 }, null, { kind: "new" }]);
    expect(movements(now, null)).toEqual([{ kind: "up", by: 4 }, null, { kind: "new" }]);
    expect(droppedOut(now, null)).toEqual([]);
    expect(movements(now, doc([2, 1, 3]))).toEqual([{ kind: "up", by: 1 }, { kind: "down", by: 1 }, { kind: "same" }]);
  });
});

describe("weeks", () => {
  it("ISO week ids, starts and labels", () => {
    expect(weekIdOf(new Date("2026-10-16T12:00:00Z"))).toBe("2026-w42");
    expect(weekIdOf(new Date("2027-01-01T12:00:00Z"))).toBe("2026-w53"); // 2026 has 53 ISO weeks
    expect(weekIdOf(new Date("2025-12-29T12:00:00Z"))).toBe("2026-w01");
    expect(isWeekId("2026-w53")).toBe(true);
    expect(isWeekId("2025-w53")).toBe(false);
    expect(isWeekId("2026-w00")).toBe(false);
    expect(isWeekId("2026-W42")).toBe(false); // ids are lower case (the API and pages lower-case first)
    expect(weekStart("2026-w42")).toBe("2026-10-12");
    expect(weekStart("2026-w01")).toBe("2025-12-29");
    expect(weekLabel("2026-w42")).toBe("Week 42 · Oct 12–18, 2026");
    expect(weekLabel("2026-w44")).toBe("Week 44 · Oct 26 – Nov 1, 2026");
  });
});

describe("scaffold (npm run power-rankings:new)", () => {
  const teams = Array.from({ length: 25 }, (_, i) => ({ team: 100 + i, name: i === 0 ? "Robo {Name}" : null, rating: 200 - i, opr: i === 1 ? null : 150.04, wins: 10, losses: 2, ties: 1 }));

  it("writes front-matter and the 25 teams, each with a TODO blurb carrying its numbers", () => {
    const text = scaffold({ week: "2026-w43", season: 2025, published: "2026-10-26", teams });
    expect(text.startsWith("---\ntitle: Power rankings, week 43\nseason: 2025\nweek: 2026-w43\npublished: 2026-10-26\nintro: |\n  TODO:")).toBe(true);
    expect(text).toContain("## 1. 100 Robo Name\nTODO: blurb. (Rating 200.0, OPR 150.0, record 10-2-1.)");
    expect(text).toContain("## 2. 101\nTODO: blurb. (Rating 199.0, OPR –, record 10-2-1.)");
    expect(text.match(/^## /gm)).toHaveLength(25);
  });

  it("doesn't validate until every TODO is written; then it does, in the scaffold's order", () => {
    const text = scaffold({ week: "2026-w43", season: 2025, published: "2026-10-26", teams });
    const r = parseRankings(text, "2026-w43.md");
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.filter((e) => /TODO/.test(e))).toHaveLength(26); // the intro and 25 blurbs
    const written = text.replace(/TODO: a paragraph.*/, "The intro.").replace(/^TODO: blurb\..*$/gm, "Written.");
    const ok = parseRankings(written, "2026-w43.md");
    expect(ok.ok).toBe(true);
    expect((ok as { doc: RankingDoc }).doc.entries.map((e) => e.team)).toEqual(teams.map((t) => t.team));
  });
});
