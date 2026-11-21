// @vitest-environment jsdom
// The thread (./thread.ts): a follow-up that names no team of its own is asked about the team the last answer was
// about, a question with its own subject is left alone, and only one team is ever carried.
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";
import { THREAD_MS, followUpText, forgetTurn, lastTurn, rememberTurn, resolveFollowUp, teamOf } from "./thread";

const team = (ref: string, title = `6980 | Bad Wolf`): SearchHit => ({ kind: "team", ref, title, subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" });
const place = (): SearchHit => ({ kind: "place", ref: "nj", title: "New Jersey", subtitle: "USA", season: null, match: "exact" });
const answer = (q: string, a: Partial<SearchAnswer> = {}): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...a });

beforeEach(forgetTurn);

describe("resolveFollowUp", () => {
  it("asks a bare follow-up about the team: the team goes in front of what is left", () => {
    expect(resolveFollowUp("and last season?", 6980)).toBe("6980 last season?");
    expect(resolveFollowUp("what about at Worlds?", 6980)).toBe("6980 at Worlds?");
    expect(resolveFollowUp("Also their awards", 6980)).toBe("Also 6980 awards");
  });

  it("puts the team where the words pointed back", () => {
    expect(resolveFollowUp("who beat them?", 6980)).toBe("who beat 6980?");
    expect(resolveFollowUp("how many events have they been to", 6980)).toBe("how many events have 6980 been to");
  });

  it("reads a whole season as when, not as a team number", () => {
    expect(resolveFollowUp("and 2025?", 6980)).toBe("6980 2025");
    expect(resolveFollowUp("what about 2024-25?", 6980)).toBe("6980 2024-25");
  });

  it("leaves a question alone when it names a team, a place or anything else of its own", () => {
    expect(resolveFollowUp("and 4215?", 6980)).toBeNull();
    expect(resolveFollowUp("what about team 12345 at worlds", 6980)).toBeNull();
    expect(resolveFollowUp("how many teams are in new jersey", 6980)).toBeNull();
    expect(resolveFollowUp("meets this weekend", 6980)).toBeNull();
  });

  it("has nothing to carry without a team from the last answer", () => {
    expect(resolveFollowUp("and last season?", null)).toBeNull();
  });
});

describe("which answer leaves a team to carry", () => {
  it("a question's card team, a stat answer's one team, or the one team the results name", () => {
    expect(teamOf({ answer: answer("6980 worlds", { card: { kind: "worlds", title: "Worlds appearances", team: { number: 6980, name: "Bad Wolf" }, lines: [] } }) })).toBe(6980);
    expect(teamOf({ answer: answer("6980 best score", { stat: { team: { number: 6980, name: "Bad Wolf" } } as never }) })).toBe(6980);
    expect(teamOf({ hits: [team("6980")] })).toBe(6980);
  });

  it("a set of teams or a place leaves nothing: the next question never borrows a team it didn't name", () => {
    expect(teamOf({ hits: [team("6980"), team("4215"), team("207")] })).toBeNull();
    expect(teamOf({ hits: [place(), team("4215")] })).toBeNull();
    expect(teamOf({ answer: answer("teams in NJ"), hits: [team("4215")] })).toBe(4215);
  });
});

describe("the thread this tab keeps", () => {
  it("remembers the last answered question and the team it was about", () => {
    rememberTurn({ q: "6980 worlds", hits: [team("6980")] });
    expect(lastTurn()).toMatchObject({ q: "6980 worlds", team: 6980 });
    expect(resolveFollowUp("who beat them?", lastTurn()!.team)).toBe("who beat 6980?");
  });

  it("a follow-up typed into the box doesn't wipe the team it was about", () => {
    rememberTurn({ q: "6980 worlds", hits: [team("6980")] });
    // The dropdown answers "and last season?" for the words as typed: no team of its own.
    rememberTurn({ q: "and last season?", hits: [place()] });
    expect(lastTurn()!.team).toBe(6980);
    // An answer about many teams, asked as its own question, does become the thread's (with nothing to carry).
    rememberTurn({ q: "teams in new jersey", hits: [team("6980"), team("4215")] });
    expect(lastTurn()).toMatchObject({ q: "teams in new jersey", team: null });
  });

  it("forgets a thread older than its lifetime", () => {
    const at = Date.UTC(2026, 10, 21, 12);
    rememberTurn({ q: "6980", hits: [team("6980")] }, at);
    expect(lastTurn(at + THREAD_MS)).not.toBeNull();
    expect(lastTurn(at + THREAD_MS + 1)).toBeNull();
  });

  it("reads a follow-up as one, and not a question that opens the same way", () => {
    expect(followUpText("and last season?")).toBe(true);
    expect(followUpText("who beat them?")).toBe(true);
    expect(followUpText("so how many teams are in New Jersey")).toBe(false);
    expect(followUpText("teams in New Jersey")).toBe(false);
  });
});
