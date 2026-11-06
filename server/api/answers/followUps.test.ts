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
import { relatedPage, grouped } from "./relatedPage";
import { pageMeta } from "../../seoMeta";
import { canonicalQuery } from "../../../src/lib/meta";
import { RELATED_QUERY_MAX, relatedApiPath } from "../../../src/shared/search";
import { MAX_QUERY } from "../searchAnswer";
import type { SearchAnswer, SearchFollowUp } from "../../../src/shared/api";
import { answerKey, candidates, followUps, lineOf, pageAnswer, previewOf, ASK_MAX, RELATED_MAX } from "./followUps";

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

  it("knows one board by its title's words, whatever their wording, and its other end as another", () => {
    const board = (title: string) => ({ stat: { family: "leaderboard", intent: "top-opr", title, scope: ["New Jersey", "2025–26"] } }) as unknown as SearchAnswer;
    expect(answerKey(board("Best team in New Jersey by OPR · 2025–26"))).toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
    // Its other end, or a list of fewer teams, is another board.
    expect(answerKey(board("Lowest 10 teams by OPR in New Jersey · 2025–26"))).not.toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
    expect(answerKey(board("Top 10 rookies by OPR in New Jersey · 2025–26"))).not.toBe(answerKey(board("Top 10 teams by OPR in New Jersey · 2025–26")));
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
