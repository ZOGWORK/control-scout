// answerFacts: the team's own meets with each phase's OPR are in the facts Bruno reads. The screenshot's "what did
// Theseus get in auto OPR at their last meet" needs that meet's number (team_event_stats), not the season's average —
// without it the chat truthfully said it couldn't find the number and sent the reader looking for a team number.
import { beforeAll, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { answerFacts, ungrounded } from "./searchBrunoAnswer";
import type { SearchAnswer } from "../../src/shared/api";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (26000, 'Theseus', 'Austin', 'TX', 'USA', 2025)");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USTXBIO', 'BIOBUZZ', 'Qualifier', 'Austin', 'TX', 'USA', '2026-11-07', '2026-11-08', 't')");
  await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, matches, wins, losses, ties) VALUES (2025, 26000, 88.4, 39.1, 10, 6, 4, 0)");
  await run(`INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches)
    VALUES (2025, 'USTXBIO', 26000, 92.5, 45.2, 41.0, 6.3, 6)`);
});

/** The answer search gives for a team name: its card names the team, which is what answerFacts reads. */
const answer = (): SearchAnswer => ({
  q: "what did theseus get in auto opr at biobuzz", hits: [], pages: [], step: "deterministic", weak: false,
  card: { kind: "info", title: "Theseus", team: { number: 26000, name: "Theseus" }, lines: [] },
});

it("gives him the team's last meet with its auto, teleop and endgame OPR", async () => {
  const facts = await answerFacts(answer());
  expect(facts.join("\n")).toContain("Team 26000 at BIOBUZZ (2025–26, 2026-11-07): Auto OPR 45.2, TeleOp OPR 41.0, Endgame OPR 6.3, OPR 92.5.");
  // The answer those facts make possible passes the number check; the season average alone would not have.
  expect(ungrounded("Theseus scored **45.2** auto OPR at BIOBUZZ.", facts, answer().q)).toEqual([]);
});
