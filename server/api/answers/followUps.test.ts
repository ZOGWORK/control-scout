// People also ask (./followUps.ts): every question shown is a search that answers directly (asked again from scratch,
// it gives the same line), none is the search itself or shown twice, a question with no answer for this team is left
// out, and the questions are the same for any team. The generator names no team, event or year.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "../query/parse";
import { parseContext } from "../query/context";
import { failureOf, outcomeTrace } from "../../searchFailures";
import { clearAllCaches } from "../../caches";
import { relatedPage, grouped, teamTitle } from "./relatedPage";
import { pageMeta } from "../../seoMeta";
import { canonicalQuery } from "../../../src/lib/meta";
import { RELATED_QUERY_MAX, SEARCH_MAX_QUERY, SEARCH_PAGE_LIMIT, firstCards, followApiPath, queryCut, relatedApiPath } from "../../../src/shared/search";
import { MAX_QUERY } from "../searchAnswer";
import type { SearchAnswer, SearchFollowUp } from "../../../src/shared/api";
import { aheadCount, answerKey, candidates, followUps, followUpsWithin, keptFollowUps, lineOf, precomputeFollowUps, type Progress, pageAnswer, previewOf, ASK_MAX, RELATED_MAX } from "./followUps";

const TEAMS = [4215, 6980, 7149] as const;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [7149, "ENFORCERS"], [207, "Critical Mass"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJQ1', 'Garden State Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't')");
  for (const [t, rank, opr] of [[4215, 1, 101.6], [6980, 2, 46.9], [7149, 3, 115.3], [207, 4, 60]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJQ1', ?, ?)", [t, rank]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'USNJQ1', ?, ?, 30, 60, 10, 3)", [t, opr]);
    // The season's numbers the boards rank by, each a little different so every board has its own order.
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, matches, wins, losses, ties) VALUES (2025, ?, ?, ?, ?, ?, ?, 4, 3, 2, 1, 0)", [t, opr, opr / 4, opr / 2, opr / 8, rank]);
  }
  const games: [number, number, number[], number[]][] = [[150, 90, [4215, 207], [6980, 7149]], [80, 120, [4215, 6980], [7149, 207]], [200, 100, [7149, 4215], [6980, 207]]];
  for (const [i, [red, blue, reds, blues]] of games.entries()) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJQ1', 'qual', 0, ?, ?, '2026-01-10T10:00:00Z', 1, ?, ?, ?, ?, 't')", [i + 1, `Q${i + 1}`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJQ1', 'qual', 0, ?, ?, ?, 1)", [i + 1, t, a]);
    }
  }
  // Only 4215 has an award: "What awards has 6980 won?" has no answer, and is never asked.
  await run("INSERT INTO awards (season, code, team, type, placement, name) VALUES (2025, 'USNJQ1', 4215, 'Inspire', 1, 'Inspire Award')");
  await rebuildSearch();
});

const both = async (q: string) => followUps(q, await pageAnswer(q, 25, new Set()));
const asked = async (q: string) => (await both(q)).ask;

describe("people also ask", () => {
  it.each(TEAMS)("offers only searches answered directly, for %i", async (t) => {
    const q = `${t} record`;
    const { ask, related } = await both(q);
    expect(ask.length).toBeGreaterThan(0);
    expect(ask.length).toBeLessThanOrEqual(ASK_MAX);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(RELATED_MAX);
    // Never the search itself, never one twice, never a question again as a related search.
    const all = [...ask, ...related];
    expect(all.map((x) => x.q.toLowerCase())).not.toContain(q);
    expect(new Set(all.map((x) => x.q.toLowerCase())).size).toBe(all.length);
    clearAllCaches();
    const keys = new Set<string>();
    for (const x of all) {
      const a = await searchAnswer(x.q, { limit: 25 });
      expect(failureOf(x.q, a, outcomeTrace(a)), x.q).toBeNull();
      expect(a.sorry, x.q).toBeUndefined();
      // The line shown is the answer's own, and no two answer the same.
      expect(previewOf(a), x.q).toBe(x.preview);
      expect(keys.has(answerKey(a)), x.q).toBe(false);
      keys.add(answerKey(a));
    }
    // Related searches are the short form: no question marks.
    expect(related.every((x) => !x.q.includes("?"))).toBe(true);
  });

  it("leaves out a question with no answer for this team", async () => {
    expect((await asked("4215 record")).map((x) => x.q)).toContain("What awards has 4215 won?");
    expect((await asked("6980 record")).map((x) => x.q)).not.toContain("What awards has 6980 won?");
  });

  it("never asks again, in other words, a search the page already offers", async () => {
    // A question search can't answer yet: the page offers the team's own searches ("4215 record 2025–26").
    const q = "what is 4215's favorite color";
    const a = await pageAnswer(q, 25, new Set());
    const offered = [...(a.suggest ?? []), ...(a.sorry?.suggest ?? [])];
    expect(offered.length).toBeGreaterThan(0);
    const what = async (x: string) => answerKey(await pageAnswer(x, 25, new Set()));
    const theirs = new Set(await Promise.all(offered.map(what)));
    const ask = (await followUps(q, a)).ask;
    expect(ask.length).toBeGreaterThan(0);
    for (const x of ask) expect(theirs.has(await what(x.q)), x.q).toBe(false);
  });

  it("offers a board's neighbours as related searches, in the season asked", async () => {
    const { ask, related } = await both("best auto opr");
    expect(ask.map((x) => x.q).filter((x) => /^Who has the best/.test(x))).toEqual([]);
    expect(related.map((x) => x.q)).toEqual(expect.arrayContaining(["best teleop opr", "best endgame opr"]));
    const q = "best auto opr in 2025-26";
    const cs = candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set()));
    expect(cs.map((x) => x.short)).toContain("best teleop opr in 2025-26");
    expect(cs.map((x) => x.q)).toContain("Who has the best TeleOp OPR in 2025-26?");
  });

  it("counts the events its page lists, never more", () => {
    const events = (total: number, listed: number) => ({ q: "", hits: Array.from({ length: listed }, (_, i) => ({ kind: "event", ref: String(i), title: "" })), pages: [], understood: { kind: "events", label: "This week's events", total } }) as unknown as SearchAnswer;
    expect(lineOf(events(86, 25))?.value).toBe("25 events");
    expect(lineOf(events(9, 9))?.value).toBe("9 events");
    expect(lineOf(events(4, 0))).toBeNull();
  });

  it("says the season every line's numbers are from, once", () => {
    const stat = (label: string, scope: string[]) => ({ q: "", hits: [], pages: [], stat: { family: "stat", intent: "rating", title: "", scope, headline: { value: "98 ± 3.2", label }, blocks: [], definition: "", source: "" } }) as unknown as SearchAnswer;
    // Not said in the line: the answer's season chip is.
    expect(lineOf(stat("#525 worldwide of 7,809 rated", ["2025–26"]))?.rest).toBe("#525 worldwide of 7,809 rated · 2025–26");
    expect(lineOf(stat("7 performance · 4 judged", ["All seasons"]))?.rest).toBe("7 performance · 4 judged · all seasons");
    // Already said: never twice.
    expect(lineOf(stat("81% win rate in 32 matches in 2025–26", ["2025–26"]))?.rest).toBe("81% win rate in 32 matches in 2025–26");
    expect(lineOf(stat("over 7 seasons", ["All seasons"]))?.rest).toBe("over 7 seasons");
    // A chip that isn't a season ("New Jersey") is never said as one.
    expect(lineOf(stat("in New Jersey", ["New Jersey"]))?.rest).toBe("in New Jersey");
    // An all-season answer narrowed to one match says that match's season, never "all seasons".
    const narrowed = stat("75–19 in Q6 at League Meet", ["All seasons"]);
    (narrowed.stat!.headline as { sub?: string }).sub = "2026–27 · Nov 7, 2026";
    expect(lineOf(narrowed)?.rest).toBe("75–19 in Q6 at League Meet · 2026–27");
    // A season only inside a longer line under it ("Last together …, 2025–26") isn't the headline's own.
    const partner = stat("3-0-0 together in 3 matches", ["All seasons"]);
    (partner.stat!.headline as { sub?: string }).sub = "Last together Q23 at League Meet, 2025–26";
    expect(lineOf(partner)?.rest).toBe("3-0-0 together in 3 matches · all seasons");
    // A card says its own season.
    const card = { q: "", hits: [], pages: [], card: { kind: "team", title: "", season: 2025, lines: [{ text: "#3 of 40", detail: "at Garden State Qualifier" }] } } as unknown as SearchAnswer;
    expect(lineOf(card)?.rest).toBe("at Garden State Qualifier · 2025–26");
  });

  it("knows one board by its title's words, whatever their wording, and its other end as another", () => {
    const board = (title: string) => ({ stat: { family: "leaderboard", intent: "top-opr", title, scope: ["New Jersey", "2025–26"] } }) as unknown as SearchAnswer;
    expect(answerKey(board("Best team in New Jersey by OPR · 2025–26"))).toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
    // Its other end, or a list of fewer teams, is another board.
    expect(answerKey(board("Lowest 10 teams by OPR in New Jersey · 2025–26"))).not.toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
    expect(answerKey(board("Top 10 rookies by OPR in New Jersey · 2025–26"))).not.toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
  });

  it("never reads one FTC word as the place or event it also names", async () => {
    const q = "4215 record";
    const p = await parseQuery(q, await parseContext());
    const a = await pageAnswer(q, 25, new Set());
    // "if I change the alliance": the word read as Alliance, Nebraska.
    const place = (name: string, typed: string) => ({ ...p, place: { kind: "city", country: "USA", state: "NE", city: name, name, typed } }) as typeof p;
    expect(candidates(place("Alliance", "alliance"), a).filter((c) => /Alliance/.test(c.q))).toEqual([]);
    expect(candidates({ ...p, event: { typed: "auto" } } as typeof p, a).filter((c) => /\bAuto\b/.test(c.q))).toEqual([]);
    // A name of two words, or one that isn't FTC's own, is the place.
    expect(candidates(place("High Point", "high point"), a).some((c) => c.q.includes("in High Point"))).toBe(true);
    expect(candidates(place("Oradell", "oradell"), a).some((c) => c.q.includes("in Oradell"))).toBe(true);
    // A state code that is also a word ("IN", "OR"), read by the parser, is the state.
    const q2 = "best auto opr in IN";
    expect(candidates(await parseQuery(q2, await parseContext()), await pageAnswer(q2, 25, new Set())).some((c) => c.q.includes("Indiana"))).toBe(true);
  });

  it("offers only what the search is about: never a team only a question's answer named", async () => {
    // A search about no team: the questions' answers name the season's leaders, but nothing follows about them.
    const f = await both("upcoming events");
    expect(f.highlights).toBeUndefined();
    expect([...f.ask, ...f.related].filter((x) => /\b\d{3,}\b/.test(x.q))).toEqual([]);
    // A search about a team keeps that team's.
    expect((await both("4215 record")).related.every((x) => /\b4215\b/.test(x.q) || x.family !== "team")).toBe(true);
  });

  it("never follows a number the answer read as a threshold, nor a filtered list's first row, as a team", async () => {
    // Team 50 exists, so the parser reads "50" as it; the answer reads it as the OPR floor of a board.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (50, 'Fifty', 'Town', 'CA', 'USA')");
    await rebuildSearch();
    clearAllCaches();
    try {
      const q = "teams from new jersey with opr over 50";
      const a = await pageAnswer(q, 25, new Set());
      expect(a.intent?.pattern).toMatch(/\[threshold\]/);
      expect(a.intent?.pattern).not.toMatch(/\[team\]/);
      const f = await followUps(q, a);
      expect(f.about).not.toBe(50);
      expect(f.highlights?.team).not.toBe(50);
      expect([...f.ask, ...f.related].filter((x) => /\b50\b/.test(x.q)).map((x) => x.q)).toEqual([]);
      // Nor is a filtered list about its first row: no team's follow-ups at all, the place's instead.
      expect(f.about).toBeUndefined();
      expect(f.highlights).toBeUndefined();
      expect([...f.ask, ...f.related].filter((x) => /\b\d{3,}\b/.test(x.q)).map((x) => x.q)).toEqual([]);
      expect(f.ask.some((x) => /New Jersey/.test(x.q))).toBe(true);
      // Its related searches are about the place too: its boards there.
      expect(f.related.length).toBeGreaterThan(0);
      expect(f.related.every((x) => /new jersey/i.test(x.q)), f.related.map((x) => x.q).join(" ; ")).toBe(true);
    } finally {
      await run("DELETE FROM teams WHERE number = 50");
      await rebuildSearch();
      clearAllCaches();
    }
  });

  it("says a season the query typed with its preposition once", async () => {
    const q = "4215 record in 2025-26";
    const qs = candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set())).map((x) => x.q);
    expect(qs).toContain("What is 4215's OPR in 2025-26?");
    const last = candidates(await parseQuery("4215 record last season", await parseContext()), await pageAnswer("4215 record last season", 25, new Set())).map((x) => x.q);
    expect(last).toContain("What is 4215's OPR last season?");
    expect(last.filter((x) => /\bin (?:last|this)\b/i.test(x))).toEqual([]);
    expect(qs.filter((x) => /\bin in\b/i.test(x))).toEqual([]);
  });

  it("one award asked about: the follow-ups are about its winner, never the first of the event's other awards", async () => {
    await run("INSERT INTO awards (season, code, team, type, placement, name) VALUES (2025, 'USNJQ1', 7149, 'Innovate', 1, 'Innovate Award')");
    clearAllCaches();
    const q = "Innovate award at Garden State Qualifier";
    const a = await pageAnswer(q, 25, new Set());
    expect(a.card?.award).toBe("Innovate");
    expect((await followUps(q, a)).about).toBe(7149);
    await run("DELETE FROM awards WHERE type = 'Innovate'");
    clearAllCaches();
  });
  it("never asks about a place the card answered without", async () => {
    const q = "best teams in new jersey by opr";
    const p = await parseQuery(q, await parseContext());
    const a = await pageAnswer(q, 25, new Set());
    expect(candidates(p, a).some((x) => /New Jersey/.test(x.q))).toBe(true);
    // The same words read, but a card that names no place (as "… in one season" read as a town named One).
    const away = { ...a, stat: { ...a.stat!, title: "Top teams worldwide", scope: ["Worldwide"] } };
    expect(candidates(p, away).filter((x) => /New Jersey/.test(x.q))).toEqual([]);
  });
  it("says the season in two teams' season questions, never in their head-to-head", async () => {
    const q = "4215 vs 6980 2024-25";
    const qs = candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set())).map((x) => x.q);
    expect(qs).toContain("Who has the higher OPR in 2024-25, 4215 or 6980?");
    expect(qs).toContain("Who has the better record in 2024-25, 4215 or 6980?");
    expect(qs).toContain("How has 4215 done against 6980?");
  });
  it("three or four teams compared: every question names them all, each team's own after", async () => {
    for (const [q, named] of [["4215 vs 6980 vs 7149 opr", "4215, 6980 or 7149"], ["compare 4215, 6980, 7149 and 207", "4215, 6980, 7149 or 207"]] as const) {
      const ask = await asked(q);
      const many = ask.filter((x) => / or \d+\?$/.test(x.q));
      expect(many.length).toBeGreaterThan(0);
      // Never two of them ("4215 or 6980?"): the question names every team, and its answer ranks them all.
      for (const x of many) expect(x.q.endsWith(`, ${named}?`)).toBe(true);
      // Each team's own questions are among those offered (People also ask or Related searches), never only built.
      const { related } = await both(q);
      const offered = [...ask, ...related];
      for (const t of named.split(/, | or /)) expect(offered.some((x) => x.q.includes(`${t}'s `) || (x.q.startsWith(`${t} `) && !x.q.includes(" vs "))), t).toBe(true);
    }
    // Asked as offered, the question compares every team it names.
    const a = await searchAnswer("Who has the best record, 4215, 6980 or 7149?", { limit: 25, full: true });
    expect([a.intent?.kind, a.stat?.teams?.map((t) => t.number)]).toEqual(["stat-compare-by", [4215, 6980, 7149]]);
    const which = await searchAnswer("which of 6980, 7149 and 207 has the best record", { limit: 25, full: true });
    expect([which.intent?.kind, which.stat?.teams?.map((t) => t.number)]).toEqual(["stat-compare-by", [6980, 7149, 207]]);
  });

  it("asks the same questions of any team", async () => {
    const shape = async (t: number) => {
      const q = `${t} record`;
      return candidates(await parseQuery(q, await parseContext()), await pageAnswer(q, 25, new Set())).map((x) => x.q.replaceAll(String(t), "#"));
    };
    const [a, ...rest] = await Promise.all(TEAMS.map(shape));
    expect(a.length).toBeGreaterThan(ASK_MAX);
    for (const b of rest) expect(b).toEqual(a);
  });

  it("names no team, event or year in the generator", () => {
    const src = readFileSync(join(__dirname, "followUps.ts"), "utf8");
    expect(src.match(/\b\d{3,}\b/g)).toBeNull();
    expect(src).not.toMatch(/garden state|hypnotic|bad wolf|enforcers|critical mass/i);
  });
});

describe("the related searches page", () => {
  const item = (q: string, family: SearchFollowUp["family"]): SearchFollowUp => ({ q, family, preview: q, value: q, rest: "", tone: { count: true } });

  it("heads a group only when it has two or more, and leaves no search out", () => {
    const g = grouped([item("a", "team"), item("b", "team"), item("c", "awards"), item("d", "predict")]);
    expect(g.map((x) => [x.title, x.items.map((i) => i.q)])).toEqual([["About this team", ["a", "b"]], ["More searches", ["c", "d"]]]);
    // One left over joins the biggest group: never a heading over one link.
    expect(grouped([item("a", "team"), item("b", "team"), item("c", "awards")]).map((x) => x.items.length)).toEqual([3]);
    // One search alone, with no group to join: listed, with no heading.
    expect(grouped([item("a", "awards")])).toEqual([{ title: "", items: [item("a", "awards")] }]);
    expect(grouped([])).toEqual([]);
  });

  it("lists only searches answered directly, grouped, for any team", async () => {
    for (const t of TEAMS) {
      const r = await relatedPage(`${t} record`);
      expect(r.found).toBe(true);
      expect(r.groups.every((g) => g.items.length >= 2)).toBe(true);
      const all = r.groups.flatMap((g) => g.items);
      expect(new Set(all.map((x) => x.q)).size).toBe(all.length);
      for (const x of all) {
        const a = await pageAnswer(x.q, 25, new Set());
        expect(failureOf(x.q, a, outcomeTrace(a)), x.q).toBeNull();
        expect(previewOf(a), x.q).toBe(x.preview);
      }
    }
  });

  it("titles the team group with the team it's about, never one of two", async () => {
    const titles = async (q: string) => (await relatedPage(q)).groups.map((g) => g.title);
    expect(await titles("4215 record")).toContain("About 4215 Hypnotic Robotics");
    expect(await titles("6980 record")).toContain("About 6980 Bad Wolf");
    // The starting points are about no team: no team group to name (none is taken from a question's answer).
    expect((await titles("")).filter((t) => t.startsWith("About "))).toEqual([]);
    // Searches about two teams: no one team to name.
    expect(await teamTitle(4215, [item("4215 record", "team"), item("6980 record", "team")])).toBeUndefined();
    expect(await teamTitle(421, [item("4215 record", "team")])).toBeUndefined();
    expect(await teamTitle(4215, [item("4215 record", "team"), item("4215 win rate", "team")])).toBe("About 4215 Hypnotic Robotics");
    // A broader search that joined the group (a lone leftover): no one team to name.
    expect(await teamTitle(4215, [item("4215 record", "team"), item("4215 win rate", "team"), item("top teams", "leaders")])).toBeUndefined();
  });

  it("lists a plain team search's own follow-ups, as /search does beside it", async () => {
    const r = await relatedPage("4215");
    expect(r.found).toBe(true);
    expect(r.groups.flatMap((g) => g.items).some((x) => x.q.includes("4215"))).toBe(true);
  });

  it("gives the starting points with no search, or one nothing follows from", async () => {
    for (const q of ["", "qqzx vvblorp"]) {
      const r = await relatedPage(q);
      expect(r.found).toBe(false);
      // This fixture has no season's leaders: whatever is listed is still in groups of two or more.
      expect(r.groups.every((g) => g.items.length >= 2)).toBe(true);
      expect((await pageMeta("/related-searches", { q })).bodyHtml).toContain('href="/search"');
    }
  });

  it("is drawn whole in the first paint, at its own address", async () => {
    const m = await pageMeta("/related-searches", { q: "4215 record" });
    expect(m.title).toBe("Related searches: 4215 record");
    expect(m.path).toBe("/related-searches?q=4215%20record");
    // The app's own canonical keeps the same address, and it starts from the lists drawn here.
    expect(canonicalQuery("/related-searches", "?q=+4215+record+&utm_source=x")).toBe("?q=4215%20record");
    expect(Object.keys(m.pageData ?? {})).toEqual([relatedApiPath("4215 record")]);
    expect(m.pageData?.[relatedApiPath("4215 record")]).toEqual(await relatedPage("4215 record"));
    expect(RELATED_QUERY_MAX).toBe(MAX_QUERY);
    expect(m.description.length).toBeGreaterThanOrEqual(120);
    expect(m.bodyHtml).toContain("<h2>");
    expect(m.bodyHtml).toContain(`href="/search?q=${encodeURIComponent("What awards has 4215 won?")}"`);
    expect((await pageMeta("/related-searches")).title).toBe("Popular FTC searches");
  });
});

describe("a list question's preview", () => {
  it("says how many teams, then the first, never one team as the whole answer", async () => {
    const { lineOf } = await import("./followUps");
    const a = { q: "teams at X", hits: [], pages: [], step: "deterministic", weak: false,
      stat: { family: "leaderboard", intent: "event-best", title: "Best teams at X", scope: [], blocks: [], listed: 10,
        headline: { value: "12853 Robo Cavos", label: "OPR there 46.0, 4-2-0 · Emerson" } } } as never;
    expect(lineOf(a, true)).toMatchObject({ value: "10 teams", rest: "first: 12853 Robo Cavos, OPR there 46.0, 4-2-0 · Emerson" });
    // A leader question ("who is best at X") keeps the team as its answer.
    expect(lineOf(a)).toMatchObject({ value: "12853 Robo Cavos" });
    // One team listed: still the count, never that team as if it were the answer.
    const one = { ...(a as object), stat: { ...(a as { stat: object }).stat, listed: 1 } } as never;
    expect(lineOf(one, true)).toMatchObject({ value: "1 team", rest: "first: 12853 Robo Cavos, OPR there 46.0, 4-2-0 · Emerson" });
  });
});

describe("the search page's first paint", () => {
  it("carries People also ask under the answer and Related searches at the end, each a link that runs it", async () => {
    const q = "4215 record";
    const f = await keptFollowUps(q);
    expect(f.ask.length).toBeGreaterThan(0);
    expect(f.related.length).toBeGreaterThan(0);
    const m = await pageMeta("/search", { q });
    const html = m.bodyHtml!;
    const paa = html.indexOf('data-block="people-also-ask"'), rel = html.indexOf('data-block="related-searches"');
    // Under the answer card, before the results; the related searches after the results, last.
    expect(paa).toBeGreaterThan(html.indexOf("<section"));
    expect(paa).toBeLessThan(html.indexOf("<h2>Teams"));
    expect(rel).toBeGreaterThan(html.indexOf("<h2>Teams"));
    // Each question opens (a <details>) to its answer's line and a link that runs that exact question.
    for (const x of f.ask) {
      expect(html).toContain(`<summary>${x.q}</summary>`);
      expect(html).toContain(`href="/search?q=${encodeURIComponent(x.q)}"`);
    }
    for (const x of f.related) expect(html).toContain(`href="/search?q=${encodeURIComponent(x.q)}"`);
    expect(html).toContain(`href="/related-searches?q=${encodeURIComponent(q)}"`);
    // Never the search itself.
    expect([...f.ask, ...f.related].map((x) => x.q.toLowerCase())).not.toContain(q);
    // The app starts from the same ones: no second request.
    expect(m.pageData?.[followApiPath(q)]).toEqual({ q, ...f });
  });

  it("has none on a page that answered nothing", async () => {
    const m = await pageMeta("/search", { q: "zzqx nothing at all" });
    expect(m.bodyHtml).not.toContain("people-also-ask");
    expect(m.bodyHtml).not.toContain("related-searches");
  });
});

describe("the follow-ups' time budget (followUpsWithin)", () => {
  it("past its time sends the questions checked so far, marked partial, then the whole set once made", async () => {
    clearAllCaches();
    const part = await followUpsWithin("4215", new Set(), 0);
    expect(part.partial).toBe(true);
    const whole = await keptFollowUps("4215");
    expect(whole.partial).toBeUndefined();
    expect(whole.ask.length).toBeGreaterThan(0);
    // Made and kept: within its time now, whole.
    expect(await followUpsWithin("4215", new Set(), 50)).toEqual(whole);
  });

  it("what's checked so far is always the first of the whole set's questions, in its order", async () => {
    clearAllCaches();
    const a = await pageAnswer("4215", 25, new Set());
    clearAllCaches();
    const progress: Progress = {};
    let done = false;
    const making = followUps("4215", a, new Set(), progress).finally(() => { done = true; });
    // Read it each turn of the loop while it's made: every reading with questions, until it's done.
    const seen: string[][] = [];
    while (!done) {
      await new Promise((ok) => setImmediate(ok));
      const now = progress.now?.();
      if (now?.ask.length) seen.push(now.ask.map((x) => x.q));
    }
    const whole = (await making).ask.map((x) => x.q);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((x) => x.length < whole.length)).toBe(true);
    for (const x of seen) expect(whole.slice(0, x.length)).toEqual(x);
  });

  it("gives the same set as followUps itself, ready in time", async () => {
    clearAllCaches();
    const a = await pageAnswer("4215 vs 6980", 25, new Set());
    const direct = await followUps("4215 vs 6980", a);
    clearAllCaches();
    expect(await followUpsWithin("4215 vs 6980", new Set(), 60_000)).toEqual(direct);
  });
});

// Search audit 2026-11-24, Q13 and Q14: the dropdown and the page are one reading, kept once whatever the list's
// length; a question longer than search reads says what it left out.
describe("one reading for every list, and a long question's cut said", () => {
  it("the dropdown's answer is the page's, cut to its first cards", async () => {
    for (const q of ["4215 record", "hypnotic robotics", "best opr in nj"]) {
      const page = await pageAnswer(q, SEARCH_PAGE_LIMIT, new Set());
      const drop = await pageAnswer(q, 15, new Set());
      expect({ ...drop, hits: [] }, q).toEqual({ ...page, hits: [] });
      expect(drop.hits, q).toEqual(firstCards(page.hits, 15));
      // The same cut each time, with the search's outcome on it (Loopy on #2263).
      expect(await pageAnswer(q, 15, new Set()), q).toBe(drop);
      expect(outcomeTrace(drop), q).toEqual(outcomeTrace(page));
      expect(outcomeTrace(drop), q).not.toBeNull();
    }
  });
  it("words past the length search reads are said, never dropped", async () => {
    const tail = "and also what about their alliance partners at the qualifier";
    const q = `${"what is the record of team 4215 hypnotic robotics this season ".repeat(3)}${tail}`;
    expect(q.length).toBeGreaterThan(SEARCH_MAX_QUERY);
    const a = await searchAnswer(q, { limit: 25, learn: false });
    expect(a.understood?.unread?.at(-1)).toBe(queryCut(q));
    expect(queryCut(q).endsWith("qualifier")).toBe(true);
    expect((await searchAnswer("4215 record", { limit: 25, learn: false })).understood?.unread ?? []).toEqual([]);
    // A long question searched again as rewritten (a chat command pasted whole): its cut said once (Loopy on #2263).
    const asked = `/ask question:${q}`;
    const b = await searchAnswer(asked, { limit: 25, learn: false });
    expect((b.understood?.unread ?? []).filter((u) => u.includes("qualifier"))).toEqual([queryCut(asked)]);
    // A long question answered as chat: its cut said on that answer too (Loopy on #2263).
    const chat = "who made you? ".repeat(13).trim();
    expect(chat.length).toBeGreaterThan(SEARCH_MAX_QUERY);
    const c = await searchAnswer(chat, { limit: 25, learn: false });
    expect(c.chat).toBe("meta");
    expect(c.understood?.unread?.at(-1)).toBe(queryCut(chat));
  });
});

describe("follow-ups made ahead (precomputeFollowUps)", () => {
  /** Asked until what's served is no longer `old` (a set made again behind it), at most `ms`. */
  const until = async (q: string, old: unknown, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const now = await followUpsWithin(q, new Set(), 0);
      if (now !== old || Date.now() > end) return now;
      await new Promise((ok) => setTimeout(ok, 50));
    }
  };

  it("are served at once, the same set followUps makes; stale after a data move, and made again behind it", async () => {
    clearAllCaches();
    const { kvSet } = await import("../../db");
    await kvSet("search:version", "ahead-1");
    await new Promise((ok) => setTimeout(ok, 2_100));
    expect(await precomputeFollowUps(["4215", "6980"])).toBe(2);
    expect(aheadCount()).toBe(2);
    // Ready with no time at all: made ahead.
    const served = await followUpsWithin("4215", new Set(), 0);
    expect(served).toEqual(await followUps("4215", await pageAnswer("4215", 25, new Set())));
    // Run again on the same index (a retry after one failed): what was made is kept, not made again.
    expect(await precomputeFollowUps(["4215", "6980"])).toBe(2);
    expect(await followUpsWithin("4215", new Set(), 0)).toBe(served);
    // Preferred teams: never the set made for anyone.
    expect(await followUpsWithin("4215", new Set(["team:6980"]), 0)).not.toBe(served);
    // New data (the kept answers' generation moves): the old set is served once more, and made again behind it.
    clearAllCaches();
    expect(await followUpsWithin("4215", new Set(), 0)).toBe(served);
    const again = await until("4215", served);
    expect(again).not.toBe(served);
    expect(again).toEqual(served);
    // A stats run moves the index: no longer served (made again as any search's).
    await kvSet("search:version", "ahead-2");
    await new Promise((ok) => setTimeout(ok, 2_100));
    expect((await followUpsWithin("4215", new Set(), 0)).partial).toBe(true);
    // Made again for the new index, the old ones dropped.
    expect(await precomputeFollowUps(["6980"])).toBe(1);
    expect(aheadCount()).toBe(1);
  }, 90_000);
});
