import { describe, expect, it } from "vitest";
import { datesIn, grade, sameAnswer, seasonsAsked, windowDays, type Live } from "./grade.js";

const stat = (s: NonNullable<Live["stat"]>, more: Partial<Live> = {}): Live => ({ step: "deterministic", understood: { kind: "question" }, stat: s, ...more });
const FRI = new Date(Date.UTC(2026, 10, 6));

describe("grade", () => {
  it("passes an answer of the asked kind that says the season back", () => {
    const r = stat({ family: "aggregate", intent: "record", title: "Record in 2025–26", scope: ["2025–26"], headline: { value: "26-6-0" } });
    expect(grade("4215 record in 2025-26", "record", r)).toMatchObject({ verdict: "pass" });
  });
  // C17: "17670 matches this season" is the season's record (6-0-0) with its matches listed, newest first.
  it("a season's matches are a record answer", () => {
    const r = stat({ family: "aggregate", intent: "season-matches", title: "Matches in 2026–27", scope: ["2026–27"], headline: { value: "6-0-0" } });
    expect(grade("17670 matches this season in 2026-27", "team-match|event|record|when-last", r)).toMatchObject({ verdict: "pass" });
  });
  it("names the pattern when there is no answer card", () => {
    expect(grade("x", "record", { step: "deterministic", understood: { kind: "team", label: "Team · This isn't answered directly yet" } }).pattern).toBe("team card only (not answered yet)");
    expect(grade("x", "record", { step: "recovery", understood: { kind: "names" } }).pattern).toBe("fallback only");
    expect(grade("x", "compare", { step: "deterministic", understood: { kind: "compare" } }).pattern).toBe("compare card without numbers");
  });
  it("fails the wrong kind, a missing season and a missing place", () => {
    const r = stat({ family: "two-team", intent: "h2h-wins", title: "Wins against 29566" });
    expect(grade("4215 wins vs losses by event", "record|trend", r).pattern).toBe("wrong answer kind");
    const s = stat({ family: "aggregate", intent: "record", title: "Record in 2024–25", scope: ["2024–25"] });
    expect(grade("4215 record in 2025-26", "record", s).pattern).toBe("season not stated");
    const p = stat({ family: "leaderboard", intent: "top-opr", title: "Top 10 teams by OPR · 2025–26" });
    expect(grade("top teams in Romania in 2025-26", "leaderboard", p).pattern).toBe("place not stated");
  });
  it("fails an empty comparison and a second period left out", () => {
    const empty = stat({ family: "two-team", intent: "compare", title: "4215 vs 6980", scope: ["2025–26"] });
    expect(grade("4215 vs 6980 in 2025-26", "compare", empty).pattern).toBe("compare card without numbers");
    const never = stat({ family: "two-team", intent: "head-to-head", title: "Meetings", none: "They have never played each other." });
    expect(grade("did 4215 ever play 6980", "h2h", never).verdict).toBe("pass");
    const half = stat({ family: "aggregate", intent: "record", title: "Record this month", headline: { value: "3-1-0" } });
    expect(grade("17965 record this month versus last month", "record", half, undefined, FRI).pattern).toBe("time filter not stated");
  });
  it("fails debug text", () => {
    const r = stat({ family: "stat", intent: "opr", title: "OPR" }, { understood: { kind: "question", label: "4215 · read as 4215 with states or opr" } });
    expect(grade("4215 opr", "opr", r).pattern).toBe("debug or meta text");
  });
  it("passes an invalid question only with a no-matches card", () => {
    const none = stat({ family: "two-team", intent: "head-to-head", title: "At Worlds", none: "4215 and 6980 have never played each other at Worlds." });
    expect(grade("4215 vs 6980 at worlds", "invalid", none)).toMatchObject({ verdict: "pass", invalid: true });
    const made = stat({ family: "two-team", intent: "head-to-head", title: "At Worlds", headline: { value: "4215 leads 1–0" } });
    expect(grade("4215 vs 6980 at worlds", "invalid", made).pattern).toBe("invalid query got an invented answer");
  });
  it("checks a time window by its words or its dates", () => {
    const said = stat({ family: "superlative", intent: "find-low", title: "Lowest-scoring match in Texas last week" });
    expect(grade("lowest scoring match in Texas last week", "match-find", said, undefined, FRI).verdict).toBe("pass");
    const dated = (d: string) => stat({ family: "superlative", intent: "season-top-matches", title: "Highest-scoring match in California", headline: { value: "98", sub: d } });
    expect(grade("highest scoring match in California this week", "match-find", dated("Nov 3, 2026"), undefined, FRI).verdict).toBe("pass");
    expect(grade("highest scoring match in California this week", "match-find", dated("Oct 3, 2026"), undefined, FRI).pattern).toBe("time filter missed");
    expect(grade("highest scoring match in California this week", "match-find", dated(""), undefined, FRI).pattern).toBe("time filter not stated");
  });
  it("reads the sorry state", () => {
    expect(grade("what is 4215's favorite color", "sorry", { understood: { kind: "names", label: "Sorry — I can't answer that yet" } }).verdict).toBe("pass");
    expect(grade("what is 4215's favorite color", "sorry", { understood: { kind: "names", label: "No team matched" } }).pattern).toBe("sorry state missing");
  });
});

describe("helpers", () => {
  it("reads the seasons a question names", () => {
    expect(seasonsAsked("4215 record in 2025-26")).toEqual([["2025-26"]]);
    expect(seasonsAsked("4215 matches at states in 2024")).toEqual([["2023-24", "2024-25", "2024"]]);
    expect(seasonsAsked("how many NJ teams went to worlds in 2024, versus 2025").map((s) => s[2])).toEqual(["2024", "2025"]);
    expect(seasonsAsked("4215 record")).toEqual([]);
    // The season a question rules out is never one the card must state.
    expect(seasonsAsked("what did 4215 do in 2024, not 2025, at states").map((s) => s[2])).toEqual(["2024"]);
    expect(seasonsAsked("23268's record in 2024-25, not 2025-26")).toEqual([["2024-25"]]);
  });
  it("works out windows from today", () => {
    const d = (n: number) => new Date(n).toISOString().slice(0, 10);
    expect(windowDays("this week", FRI).map(d)).toEqual(["2026-11-01", "2026-11-08"]);
    expect(windowDays("last week", FRI).map(d)).toEqual(["2026-10-25", "2026-11-01"]);
    expect(windowDays("yesterday", FRI).map(d)).toEqual(["2026-11-05", "2026-11-05"]);
    expect(windowDays("last month", FRI).map(d)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(datesIn("q11 nov 1 2026 2026-10-30", FRI).map(d)).toEqual(["2026-11-01", "2026-10-30"]);
  });
  it("calls two answers the same by kind and headline", () => {
    const a = stat({ family: "stat", intent: "opr", headline: { value: "101.6" } });
    expect(sameAnswer(a, stat({ family: "stat", intent: "opr", headline: { value: "101.6" } }))).toBe(true);
    expect(sameAnswer(a, stat({ family: "stat", intent: "opr", headline: { value: "97.9" } }))).toBe(false);
  });
});
