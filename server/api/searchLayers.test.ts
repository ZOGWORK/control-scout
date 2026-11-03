// The layered query path (./searchLayers.ts, docs/search-layers.md) on a small fixture database: every paraphrase set
// returns its canonical answer, filler never changes an answer, forbidden words are never ignored, each layer reaches
// every intent on its own, and the outcome reporting reads is right.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { FILLER, FORBIDDEN, INTENTS, PARAPHRASES, WEAK_SIGNALS } from "./searchCatalog";
import { extract, paraphrase, searchKey, searchOutcome, setLayersForTest, stripFiller, tokens, traceOf } from "./searchLayers";
import { PARAPHRASE_SETS } from "./searchLayers.sets";

const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });
/** What an answer says: the card, the stat and its number, the team hit and the section or link it opens. */
const sig = (a: SearchAnswer) => JSON.stringify([a.stat?.title, a.stat?.headline?.value, a.card?.kind, a.card?.title, a.hits[0]?.ref, a.hits[0]?.section, a.hits[0]?.href]);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, rookie year, [opr, wins, losses] 2024-25, [opr, wins, losses] 2025-26
  const teams: [number, string, string, string, number, [number, number, number], [number, number, number]][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", 2009, [144.8, 25, 17], [101.6, 26, 6]],
    [6980, "Bad Wolf", "Oradell", "NJ", 2013, [40, 5, 15], [130, 20, 0]],
    [23268, "Ultraviolet", "Hackettstown", "NJ", 2023, [90, 12, 8], [157.9, 33, 17]],
    [14270, "Quantum Robotics", "Bucharest", "TX", 2018, [150, 30, 5], [200, 40, 2]],
    [25632, "Mean Green Machine", "Austin", "TX", 2022, [20, 2, 10], [22.6, 10, 10]],
    [32034, "Please Don't Explode", "Austin", "TX", 2024, [10, 1, 5], [43.7, 4, 8]],
    [11111, "Just In Time", "Austin", "TX", 2015, [30, 3, 3], [55, 6, 6]],
    [17799, "Newgen Leaders", "Austin", "TX", 2019, [12, 2, 6], [15.6, 3, 9]],
  ];
  for (const [n, name, city, state, rookie, before, now] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year, school, sponsors, website) VALUES (?, ?, ?, ?, 'USA', ?, ?, '[\"Acme\"]', 'https://example.org')", [n, name, city, state, rookie, `${city} High School`]);
    for (const [season, [opr, w, l]] of [[2024, before], [2025, now]] as const) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_sd, rating_matches, rating_rank, matches, wins, losses, ties)
        VALUES (?, ?, ?, ?, ?, ?, null, 7, ?, 3, 10, null, ?, ?, ?, 0)`, [season, n, opr, opr / 4, opr / 2, opr / 8, opr, w + l, w, l]);
    }
  }
  const ev = (season: number, code: string, name: string, type: string, start: string, state = "NJ") =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [season, code, name, type, state, start, start]);
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev(2025, "USNJQ1", "NJ Oradell Qualifier", "Qualifier", "2026-01-10");
  await ev(2025, "FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-30", "TX");
  await ev(2024, "USNJCMP", "New Jersey Championship", "Championship", "2025-03-15");
  await ev(2026, "USNJQ9", "NJ Future Qualifier", "Qualifier", "2099-01-10");
  for (const [season, code, team, rank] of [[2025, "USNJCMP", 4215, 2], [2025, "USNJCMP", 6980, 1], [2025, "USNJQ1", 4215, 1], [2025, "FTCCMP1", 4215, 5], [2024, "USNJCMP", 4215, 3], [2025, "USNJCMP", 23268, 3]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, 4, 1, 0, 5)", [season, code, team, rank]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, 100, 5)", [season, code, team]);
  }
  // Played matches at the state championship, and one upcoming.
  for (let n = 1; n <= 3; n++) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJCMP', 'qual', 0, ?, ?, '2026-03-15T10:00:00Z', 1, ?, ?, 90, 90, 't')", [n, `Q${n}`, 100 + n, 100 + n]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'USNJCMP', 'qual', 0, ?, 4215, 'red'), (2025, 'USNJCMP', 'qual', 0, ?, 6980, 'blue')", [n, n]);
  }
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 'Q1', '2099-01-10T10:00:00Z', 0, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2026, 'USNJQ9', 'qual', 0, 1, 4215, 'red')");
  await run("INSERT INTO event_teams (season, code, team) VALUES (2026, 'USNJQ9', 4215)");
  await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES
    (2025, 'USNJCMP', 'Winner', 1, 6980, 'Winning Alliance - Captain'), (2025, 'USNJCMP', 'Winner', 1, 23268, 'Winning Alliance - 1st Pick'),
    (2025, 'USNJCMP', 'Inspire', 1, 4215, 'Inspire Award'), (2025, 'USNJQ1', 'Think', 1, 4215, 'Think Award'), (2024, 'USNJCMP', 'Inspire', 1, 4215, 'Inspire Award')`);
  await rebuildSearch();
});

afterEach(() => setLayersForTest({}));

describe("Layer 0 and the word layers' tokens", () => {
  it("normalization keeps every word; a season and a possessive read whole", () => {
    expect(tokens("#4215's OPR in 2024 – 25")).toEqual(["4215", "opr", "in", "2024-25"]);
    expect(tokens("Hypnotic Robotics, DECODE year")).toEqual(["hypnotic", "robotics", "decode", "year"]);
  });
  it("every word list entry reads as itself, so none can never match", () => {
    for (const w of [...INTENTS.flatMap((i) => i.words), ...FILLER, ...FORBIDDEN, ...PARAPHRASES.flat(), ...Object.keys(WEAK_SIGNALS)]) {
      if (/^what does mean$|^when did start$/.test(w)) continue;
      expect(tokens(w).join(" "), w).toBe(w);
    }
  });
  it("each intent's keywords, beside a team (or alone, for the teamless ones), find that intent", async () => {
    for (const it of INTENTS.filter((i) => i.team === "required")) {
      for (const w of it.words) {
        const x = await extract(`4215 ${w}`);
        // A rule may hand a keyword to a stronger intent ("next match" is next-match's), never to none.
        expect(x.intents.length + x.weak.length, `4215 ${w}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("paraphrase sets: every member returns the canonical answer", () => {
  for (const set of PARAPHRASE_SETS) {
    it(`${set.intent}: ${set.canonical}`, async () => {
      const c = await ask(set.canonical);
      expect(searchOutcome(c)?.result, set.canonical).toBe("answered");
      for (const [dim, q] of set.members) expect(sig(await ask(q)), `${dim}: ${q}`).toBe(sig(c));
    });
  }
  it("each set has the long, filler and reversed or scope forms where the language allows them", () => {
    for (const id of ["location", "opr", "rating", "school", "rookie-year"]) {
      const set = PARAPHRASE_SETS.find((s) => s.intent === id)!;
      expect(set.members.some(([d, q]) => d === "long" && q.split(" ").length >= 10), id).toBe(true);
    }
    for (const set of PARAPHRASE_SETS) expect(set.members.some(([d]) => d === "filler"), set.intent).toBe(true);
  });
});

describe("filler: never changes an answer; forbidden words are never ignored", () => {
  const passing = ["4215 opr", "4215 location", "4215 awards", "4215 record", "top opr in new jersey", "what is opr", "4215 vs 6980"];
  it("every filler word, in front, middle and end, leaves the answer as it was", async () => {
    for (const q of passing) {
      const want = sig(await ask(q));
      const [first, ...rest] = q.split(" ");
      for (const f of FILLER.filter((w) => !/^(?:hey|hi|hello)$/.test(w) || q.startsWith("4215"))) {
        for (const v of [`${f} ${q}`, `${first} ${f} ${rest.join(" ")}`, `${q} ${f}`]) expect(sig(await ask(v)), v).toBe(want);
      }
    }
  }, 120_000);
  it("a filler word that's part of a team's full name stays the name", async () => {
    expect((await stripFiller("just in time opr")).q).toBe("just in time opr");
    expect((await ask("just in time opr")).stat?.headline?.value).toBe("55.0");
    expect((await stripFiller("please 4215 opr rn")).dropped).toEqual(["please", "rn"]);
    // A greeting alone is no query: nothing is made from it.
    expect((await stripFiller("hello")).q).toBe("hello");
  });
  it("a forbidden word changes the outcome, blocks or is named, never silently dropped", async () => {
    const want = sig(await ask("4215 opr"));
    const silent: string[] = [];
    for (const w of FORBIDDEN.filter((x) => !/^(?:vs|versus|or|and)$/.test(x))) {
      const a = await ask(`4215 ${w} opr`);
      if (sig(a) === want && !a.understood?.label.includes(`"${w}"`)) silent.push(w);
    }
    expect(silent).toEqual([]);
    // Layer 1 reads past "today" (a stopword there): the answer says so.
    expect((await ask("4215 today opr")).understood?.label).toMatch(/"today" isn't part of this answer/);
    // The same when a later layer answers it, after filler is taken out.
    expect((await ask("4215 today opr rn")).understood?.label).toMatch(/"today" isn't part of this answer/);
    const x = await extract("4215 not opr");
    expect(x.forbidden).toEqual(["not"]);
    expect(x.canonical).toBeNull();
  });
});

describe("redundancy: each layer reaches every intent on its own", () => {
  it("with Layer 1 off, every paraphrase set answers through the keyword layers", async () => {
    setLayersForTest({ template: false });
    for (const set of PARAPHRASE_SETS) {
      setLayersForTest({});
      const want = sig(await ask(set.canonical));
      setLayersForTest({ template: false });
      for (const [, q] of set.members) {
        const a = await ask(q);
        const o = searchOutcome(a)!;
        expect(o.won, `${q} (${o.layers.join(" > ")})`).not.toBeNull();
        expect(o.won).not.toBe("template");
        expect(sig(a), q).toBe(want);
      }
    }
  }, 120_000);
  it("with the keyword layers off, every canonical form still answers through Layer 1", async () => {
    setLayersForTest({ keyword: false });
    for (const set of PARAPHRASE_SETS) {
      const a = await ask(set.canonical);
      expect(searchOutcome(a), set.canonical).toMatchObject({ won: "template", result: "answered" });
    }
  });
  it("every intent in the catalog has a paraphrase set or a stated reason", () => {
    const covered = new Set(PARAPHRASE_SETS.map((s) => s.intent.split(" ")[0]));
    const named: Record<string, string> = { "win-rate": "record", rank: "record", "high-score": "matches", "next-match": "next", "next-event": "next", "last-event": "last", "last-match": "last", states: "worlds", reliability: "opr", "league-rank": "opr", "report-card": "opr", website: "sponsors", winners: "winners", leaderboard: "leaderboard", events: "events", matches: "matches", awards: "awards", rating: "rating" };
    for (const it of INTENTS) expect(covered.has(it.id) || covered.has(named[it.id] ?? "") || it.id === "versus", it.id).toBe(true);
  });
});

describe("Layers 3 and 5, scope position, precedence and ambiguity", () => {
  it("every paraphrase entry is read", () => {
    for (const [from, to] of PARAPHRASES) {
      const q = from === "what does mean" ? "what does opr mean" : from === "when did start" ? "when did 4215 start" : `4215 ${from}`;
      const p = paraphrase(q);
      expect(p.used, q).toContain(from);
      expect(p.q, q).toContain(to);
    }
  });
  it("every weak signal points at its intents, and one candidate is answered", async () => {
    for (const [w, ids] of Object.entries(WEAK_SIGNALS)) expect((await extract(`4215 ${w}`)).weak, w).toEqual(ids);
    const a = await ask("4215 based");
    expect(searchOutcome(a)).toMatchObject({ won: "scope", intents: ["location"] });
    expect(a.card?.title).toMatch(/Where they're from/);
  });
  it("scope is found before, after or between the team and the intent", async () => {
    const want = sig(await ask("4215 record 2024-25"));
    for (const q of ["2024-25 4215 record", "4215 2024-25 record", "record 2024-25 4215", "record of 4215 in 2024-25"]) expect(sig(await ask(q)), q).toBe(want);
    const place = sig(await ask("top opr in new jersey"));
    for (const q of ["new jersey top opr", "top new jersey opr", "nj best opr", "best opr nj"]) expect(sig(await ask(q)), q).toBe(place);
  });
  it("two teams beat one team's stat; a definition beats a name", async () => {
    expect((await extract("4215 opr vs 6980")).canonical).toBe("4215 vs 6980");
    expect((await ask("what does opr mean")).card?.title).toMatch(/^OPR/);
    // "mean" and "please" in a full name stay the name.
    expect((await extract("mean green machine opr")).teams).toEqual(["25632"]);
    // A name with an apostrophe reads as typed with or without it.
    for (const q of ["please don't explode opr", "please dont explode opr"]) expect((await extract(q)).teams, q).toEqual(["32034"]);
    expect((await stripFiller("please don't explode opr")).q).toBe("please don't explode opr");
  });
  it("two intents with no rule between them are named, never guessed", async () => {
    const a = await ask("4215 awards location");
    expect(searchOutcome(a)).toMatchObject({ result: "ambiguous", intents: ["awards", "location"], won: null });
    expect(a.understood?.label).toMatch(/awards or location: say which/);
    // Two facts from FIRST's listing are both answered, not ambiguous (failed-search #489).
    expect(searchOutcome(await ask("4215 sponsors school"))?.result).toBe("answered");
    // A weak word with two meanings is named too.
    expect((await extract("4215 stats")).weak).toEqual(["opr", "record"]);
  });
  it("every filter typed stays in the phrasing handed on; scope a weak word's intent can't take blocks it", async () => {
    expect((await extract("which events of 4215 in new jersey in 2025-26")).canonical).toBe("4215 events in New Jersey 2025-26");
    expect((await extract("record of 4215 at new jersey championship 2024-25")).canonical).toBe("4215 record at new jersey championship 2024-25");
    expect((await extract("awards of 4215 at new jersey championship 2024-25")).canonical).toBe("4215 awards at new jersey championship 2024-25");
    const a = await ask("4215 based 2024-25");
    expect(searchOutcome(a)?.won).not.toBe("scope");
    expect(a.card?.title ?? "").not.toMatch(/Where they're from/);
  });
  it("a team's events with no season: its latest season with an event, said so", async () => {
    const a = await ask("4215 events");
    expect(a.stat?.title).toBe("Events in 2026–27");
    expect(a.understood?.label).toMatch(/read as "4215 events in 2026-27"/);
  });
});

describe("the outcome failed-search reporting reads", () => {
  it("a direct answer, a fallback and a no-match, with the layers tried", async () => {
    expect(searchOutcome(await ask("4215 opr"))).toMatchObject({ result: "answered", won: "template", team: "4215", intents: ["opr"], layers: ["normalize", "template"] });
    expect(searchOutcome(await ask("4215 opr rn"))).toMatchObject({ result: "answered", won: "keyword", filler: ["rn"], normalized: "4215 opr" });
    // ("4215 not opr" is the boolean reader's now, declined plainly: ./searchBoolean.test.ts.)
    const f = searchOutcome(await ask("4215 never opr"))!;
    expect(f).toMatchObject({ result: "team-fallback", won: null, team: "4215" });
    expect(f.layers.at(-1)).toBe("fallback");
    expect(searchOutcome(await ask("zzqx wobble"))).toMatchObject({ result: "no-match", won: null });
    // Filler variants of one failing query share the key, and the key keeps a reporter's placeholders.
    expect(await searchKey("Please  #4215 [email] not OPR rn")).toBe("4215 [email] not opr");
    expect(searchOutcome(await ask("please 4215 never opr"))?.normalized).toBe(f.normalized);
  });
  it("the trace reporting reads: layers by number, ambiguity carried, the failure classified from it", async () => {
    const t = traceOf(searchOutcome(await ask("4215 awards location")))!;
    expect(t).toMatchObject({ won: null, team: "4215", ambiguous: ["awards", "location"] });
    expect(t.layers[0]).toBe("0");
    expect(t.layers.at(-1)).toBe("6");
    expect(traceOf(searchOutcome(await ask("4215 opr rn")))).toMatchObject({ won: "2", filler: ["rn"] });
    const { failureOf } = await import("../searchFailures");
    const a = await ask("4215 awards location");
    // Reporting classifies it as the user saw it: ambiguous, not a plain team fallback.
    expect(failureOf("4215 awards location", a, traceOf(searchOutcome(a)))).toMatchObject({ type: "ambiguous" });
    // A weak word declined for its scope is still a question that wasn't answered: reported.
    const w = await ask("4215 based 2024-25");
    expect(traceOf(searchOutcome(w))?.intents).toEqual(["location"]);
    expect(failureOf("4215 based 2024-25", w, traceOf(searchOutcome(w)))).not.toBeNull();
  });
  it("a count with a season isn't read as the current count", async () => {
    expect((await extract("number of teams new jersey 2024-25")).canonical).toBeNull();
    expect((await extract("number of teams new jersey")).canonical).toBe("how many teams in New Jersey");
  });
  it("only a top-level search has an outcome, and the answer's JSON has nothing new", async () => {
    const a = await ask("4215 opr rn");
    expect(JSON.stringify(a)).not.toMatch(/"layers"|"won"/);
    expect(searchOutcome({ ...a })).toBeUndefined();
    expect(searchOutcome(await searchAnswer("4215 opr", { limit: 25, intents: false }))).toBeUndefined();
  });
  it("the test-only switch is never a production toggle", () => {
    const env = process.env.VITEST;
    delete process.env.VITEST;
    try { expect(() => setLayersForTest({ template: false })).toThrow(/tests only/); } finally { process.env.VITEST = env; }
  });
});
