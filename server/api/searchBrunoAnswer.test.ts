// Bruno's written answer on /search (server/api/searchBrunoAnswer.ts), against a fake Control Point: asked only for a
// question, with the facts search found; an answer naming a number that isn't in them is dropped; cached; off,
// unconfigured, failing or slow: no answer. Never a real AI call.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { invalidateFlags, setFlag } from "../flags";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { BRUNO_ANSWER_TIMEOUT_MS, answerFacts, brunoAnswer, grounded, resetBrunoAnswerCache } from "./searchBrunoAnswer";
import { isBrunoQuestion } from "../../src/shared/search";

let fake: Server;
let reply: unknown = { text: null };
let mode: "ok" | "error" | "slow" = "ok";
const asked: { question: string; facts: string[] }[] = [];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, 4215)");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2023, 'USNJCMP', 'New Jersey State Championship', 'Championship', 'Hillsborough', 'NJ', 'USA', '2024-03-17', '2024-03-17', 't'), (2024, 'USNJCMP', 'New Jersey Championship', 'Championship', 'Hillsborough', 'NJ', 'USA', '2025-03-16', '2025-03-16', 't')");
  await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (2023, 'USNJCMP', 4215, 3, 4, 1, 0), (2024, 'USNJCMP', 4215, 7, 3, 2, 0)");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2023, 'USNJCMP', 4215, 111.5, 5), (2024, 'USNJCMP', 4215, 117.3, 5)");
  await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, wins, losses, ties, matches) VALUES (2025, 4215, 101.6, 616, 8375, 26, 6, 0, 32)");
  await rebuildSearch();
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      asked.push(JSON.parse(body));
      const send = () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
      if (req.url !== "/internal/bruno/search-answer") res.writeHead(404).end("{}");
      else if (mode === "error") res.writeHead(502).end('{"error":"ai_failed"}');
      else if (mode === "slow") setTimeout(send, BRUNO_ANSWER_TIMEOUT_MS + 1000);
      else send();
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  process.env.CONTROL_POINT_INTERNAL_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.CONTROL_POINT_INTERNAL_KEY = "test";
});
afterAll(() => { fake.close(); delete process.env.CONTROL_POINT_INTERNAL_URL; delete process.env.CONTROL_POINT_INTERNAL_KEY; });
beforeEach(async () => { mode = "ok"; reply = { text: null }; asked.length = 0; resetBrunoAnswerCache(); await setFlag("brunoAnswers", true, "test"); invalidateFlags(); });

const Q = "how many times did 4215 go to states";

describe("which searches are questions", () => {
  it("a question gets Bruno; a name, a number or a topic doesn't", () => {
    for (const q of [Q, "is bad wolf good?", "when did 23268 go to worlds and what was their opr then", "who won the new jersey championship"]) expect(isBrunoQuestion(q), q).toBe(true);
    for (const q of ["4215", "hypnotic", "hypnotic opr", "4215 vs 6980", "new jersey championship", "what"]) expect(isBrunoQuestion(q), q).toBe(false);
  });
});

describe("the facts Bruno is given", () => {
  it("are search's own records: where the records start, the card's lines with OPR, the results and the latest season", async () => {
    const facts = await answerFacts(await searchAnswer(Q, { learn: false }));
    expect(facts[0]).toBe("Control Scout's event records start with the 2023–24 FTC season; nothing earlier is recorded.");
    expect(facts).toContain("State championships for team 4215 Hypnotic Robotics: 2 found (2 times).");
    expect(facts.some((f) => f.includes("New Jersey Championship: 2024–25 · Mar 16, 2025") && f.includes("OPR 117.3"))).toBe(true);
    expect(facts).toContain("Team 4215 in 2025–26: record 26-6-0, OPR 101.6, OPR rank 616 of 8375.");
  });
});

describe("grounding", () => {
  const facts = ["- New Jersey Championship: 2024–25 · ranked #7 · 3-2-0 in quals · OPR 117.3", "Team 4215 in 2025–26: OPR rank 616 of 8,375."];
  it("every number must be one the facts or the question have", () => {
    expect(grounded("Yes: 4215 went to states, ranked #7 with OPR 117.3 (3-2-0) in 2024–25.", facts, Q)).toBe(true);
    expect(grounded("Its OPR rank is 616 of 8,375.", facts, Q)).toBe(true);
    expect(grounded("Its OPR was 120.", facts, Q)).toBe(false);
    expect(grounded("It went 5 times.", facts, Q)).toBe(false);
  });
});

/** What brunoAnswer gives for a reply: his points, or none. */
const withPoints = (r: unknown) => ({ points: [], ...(r as object) });

describe("asking Bruno", () => {
  it("passes his points through, each checked with the sentence: one made-up number drops the answer", async () => {
    reply = { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3, OPR 111.5", " 2024–25:  ranked #7 ", ""] };
    expect(await brunoAnswer(Q)).toEqual({ text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3, OPR 111.5", "2024–25: ranked #7"] });
    resetBrunoAnswerCache();
    reply = { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3, OPR 999.9"] };
    expect(await brunoAnswer(Q)).toBeNull();
  });
  it("sends the question and the facts, and answers his text", async () => {
    reply = { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24: ranked #3 in 2023–24 (OPR 111.5) and #7 in 2024–25 (OPR 117.3)." };
    expect(await brunoAnswer(Q)).toEqual(withPoints(reply));
    expect(asked).toHaveLength(1);
    expect(asked[0].question).toBe(Q);
    expect(asked[0].facts).toEqual(await answerFacts(await searchAnswer(Q, { learn: false })));
  });
  it("drops an answer with a number that isn't in the facts", async () => {
    reply = { text: "Hypnotic Robotics went to states 6 times." };
    expect(await brunoAnswer(Q)).toBeNull();
  });
  it("a question by its \"?\" alone is one too (read before cleaning drops it)", async () => {
    reply = { text: "Hypnotic Robotics (4215) has an OPR of 101.6 in 2025–26." };
    expect(await brunoAnswer("hypnotic opr?")).toEqual(withPoints(reply));
    expect(asked[0].question).toBe("hypnotic opr");
  });
  it("two asks at once for the same question share one call", async () => {
    reply = { text: "4215 went to states 2 times." };
    const [a, b] = await Promise.all([brunoAnswer(Q), brunoAnswer(Q)]);
    expect(a).toEqual(withPoints(reply));
    expect(b).toEqual(withPoints(reply));
    expect(asked).toHaveLength(1);
  });
  it("reads with the page's own preferred teams, each set cached apart", async () => {
    reply = { text: "4215 went to states 2 times." };
    await brunoAnswer(Q, { prefer: new Set(["team:4215"]) });
    await brunoAnswer(Q);
    expect(asked).toHaveLength(2);
  });
  it("caches each question: asked once", async () => {
    reply = { text: "4215 went to states 2 times." };
    await brunoAnswer(Q);
    await brunoAnswer(`  ${Q.toUpperCase()} `);
    expect(asked).toHaveLength(1);
  });
  it("never asks for a non-question, with the switch off, or with no Control Point configured", async () => {
    expect(await brunoAnswer("4215")).toBeNull();
    await setFlag("brunoAnswers", false, "test");
    invalidateFlags();
    expect(await brunoAnswer(Q)).toBeNull();
    await setFlag("brunoAnswers", true, "test");
    invalidateFlags();
    const url = process.env.CONTROL_POINT_INTERNAL_URL;
    delete process.env.CONTROL_POINT_INTERNAL_URL;
    try { expect(await brunoAnswer(Q)).toBeNull(); } finally { process.env.CONTROL_POINT_INTERNAL_URL = url; }
    expect(asked).toHaveLength(0);
  });
  it("failing or slow: no answer, within the timeout, and not cached", async () => {
    for (const m of ["error", "slow"] as const) {
      mode = m;
      const t0 = Date.now();
      expect(await brunoAnswer(Q)).toBeNull();
      expect(Date.now() - t0).toBeLessThan(BRUNO_ANSWER_TIMEOUT_MS + 1500);
    }
    mode = "ok";
    reply = { text: "4215 went to states 2 times." };
    expect(await brunoAnswer(Q)).toEqual(withPoints(reply));
  }, 30_000);
});
