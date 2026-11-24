import { describe, expect, it } from "vitest";
import { failureBody } from "../../server/searchFailures.js";
import { buildSet, filedType, leftOut, queriesOf, rate, serialize, type ClosedIssue } from "./searchReplay.js";

const row = (over: Partial<Parameters<typeof failureBody>[0]>) => ({
  key: "4215 opr", hash: "abc", result_type: "team-fallback", intent: "opr", count: 2, first_seen: "2026-11-01T00:00:00Z",
  last_seen: "2026-11-02T00:00:00Z", examples: JSON.stringify(["4215 opr rn"]), missed: "{}", label: "", issue_number: 9,
  reading: JSON.stringify({ layers: [], won: null, team: "4215", intents: ["opr"], scope: [], filler: ["rn"] }),
  ...over,
}) as Parameters<typeof failureBody>[0];

const issue = (number: number, body: string, stateReason: string | null = "COMPLETED", labels: string[] = []): ClosedIssue =>
  ({ number, body, stateReason, labels: labels.map((name) => ({ name })) });

describe("search replay set", () => {
  it("reads the query as typed from an issue body the failed-search log writes", () => {
    const body = failureBody(row({}));
    expect(queriesOf(body)).toEqual(["4215 opr rn"]);
    expect(filedType(body)).toBe("team-fallback");
  });

  it("reads every variant of a pattern issue, never its key", () => {
    const body = failureBody(row({ key: "pattern: <team> opr", examples: JSON.stringify(["4215 opr rn", "6980 opr now"]) }));
    expect(queriesOf(body)).toEqual(["4215 opr rn", "6980 opr now"]);
  });

  it("leaves out issues closed as not planned or labelled dismissed", () => {
    expect(leftOut(issue(1, "", "NOT_PLANNED"))).toBe("not-planned");
    expect(leftOut(issue(1, "", "COMPLETED", ["failed-search", "dismissed"]))).toBe("dismissed");
    expect(leftOut(issue(1, ""))).toBeNull();
  });

  it("keeps one row a query, under the newest issue, marks eval questions and keeps recorded kinds", () => {
    const a = failureBody(row({ examples: JSON.stringify(["4215 OPR rn"]) }));
    const b = failureBody(row({ examples: JSON.stringify(["4215 opr  rn", "worlds winners 2025"]) }));
    const c = failureBody(row({ examples: JSON.stringify(["not worth it"]) }));
    const set = buildSet([issue(10, a), issue(12, b), issue(13, c, "NOT_PLANNED")], ["Worlds winners 2025"], new Map([["4215 opr rn", "stat:Team/opr"]]), "2026-11-24");
    expect(set).toMatchObject({ closed: 3, notPlanned: 1, dismissed: 0 });
    expect(set.rows).toEqual([
      { issue: 12, q: "4215 opr  rn", filed: "team-fallback", source: "visitor", kind: "stat:Team/opr" },
      { issue: 12, q: "worlds winners 2025", filed: "team-fallback", source: "eval", kind: null },
    ]);
    expect(JSON.parse(serialize(set))).toEqual(set);
  });

  it("rates in percent, 100 with nothing asked", () => {
    expect(rate(3, 4)).toBe(75);
    expect(rate(0, 0)).toBe(100);
  });
});
