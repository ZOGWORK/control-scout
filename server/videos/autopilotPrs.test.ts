// The clip autopilot's open PRs as Owner › Clip coverage reads them (server/videos/autopilotPrs.ts): the events each
// one ships, from the mark the runner writes (frameQueue then shows them as "reading": frameQueue.test.ts).
import { afterEach, describe, expect, it } from "vitest";
import { autopilotPrs, forgetAutopilotPrs, markedEvents } from "./autopilotPrs";
import { prMarker } from "../../scripts/lib/autopilotRows";

const row = (code: string, videoId: string) => ({ videoId, code, checked: "2026-11-17", starts: {} });
const issues = (list: unknown[], ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => list })) as unknown as typeof fetch;

afterEach(() => forgetAutopilotPrs());

describe("autopilot PRs", () => {
  it("reads the events a PR ships from the runner's own mark", () => {
    expect(markedEvents(`Read by the clip autopilot.\n\n${prMarker(2025, [row("AAQ", "v1"), row("AAQ", "v2"), row("BBQ", "v3")])}`)).toEqual(["2025/AAQ", "2025/BBQ"]);
    expect(markedEvents("no mark")).toEqual([]);
    expect(markedEvents("<!-- clip-autopilot {broken} -->")).toEqual([]);
  });

  it("lists open labelled PRs (not issues) by event, kept 10 minutes; GitHub failing keeps the last list", async () => {
    const pr = { number: 1700, body: prMarker(2025, [row("AAQ", "v1")]), pull_request: {} };
    const issue = { number: 1701, body: prMarker(2025, [row("ZZQ", "v9")]) };
    const t = Date.parse("2026-11-17T12:00:00Z");
    expect([...(await autopilotPrs(t, issues([pr, issue])))]).toEqual([["2025/AAQ", 1700]]);
    // Within 10 minutes: the same list, GitHub not asked.
    expect([...(await autopilotPrs(t + 60_000, issues([])))]).toEqual([["2025/AAQ", 1700]]);
    // After it, GitHub down: the last list stays.
    expect([...(await autopilotPrs(t + 11 * 60_000, issues([], false)))]).toEqual([["2025/AAQ", 1700]]);
    // The test suite itself never reaches GitHub.
    forgetAutopilotPrs();
    expect((await autopilotPrs(t)).size).toBe(0);
  });

});
