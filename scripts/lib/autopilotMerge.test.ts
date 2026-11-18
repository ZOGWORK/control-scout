// The clip autopilot's merge gate (scripts/lib/autopilotMerge.ts): what stops it merging its own data PR with nobody
// watching.
import { describe, expect, it } from "vitest";
import { clipsMergeProblems, fileProblems, frameMergeProblems, labelPlaces, LOOPY_LOGIN, loopySummary, orderProblems, readyProblems, reviewedSha, type IssueComment, type PrState } from "./autopilotMerge";
import type { FrameTiming } from "../../server/data/frameTimings";
import type { ClipCheck } from "../../server/data/clipChecks";

const row = (o: Partial<FrameTiming> = {}): FrameTiming => ({ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-17", starts: {}, ...o });
const NONE = new Map<string, number>();

describe("frameMergeProblems", () => {
  const live = row({ checked: "2026-11-16", starts: { Q1: 100, Q2: 400 }, opens: { Q1: 80, Q2: 380 }, missing: { Q3: "no frame read of it" }, review: { Q4: { t: 990, why: "one signal" } } });

  it("merges a re-read that keeps every live start and fills what was missing or for review, each opening on a lead", () => {
    const next = row({ starts: { Q1: 101, Q2: 398, Q3: 700, Q4: 1000 }, opens: { Q1: 81, Q2: 378, Q3: 688, Q4: 995 } });
    expect(frameMergeProblems(2025, [next], [live], [live], NONE)).toEqual([]);
    // A brand-new row: every start is new.
    expect(frameMergeProblems(2025, [live, row({ videoId: "VIDEObbbbb2", starts: { Q5: 50 }, opens: { Q5: 30 } })], [live], [live], NONE)).toEqual([]);
  });

  it("stops on a live start moved more than 2 s, or dropped", () => {
    expect(frameMergeProblems(2025, [row({ starts: { Q1: 103, Q2: 400 } })], [live], [live], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: live Q1 moved 100 → 103"]);
    expect(frameMergeProblems(2025, [row({ starts: { Q2: 400 } })], [live], [live], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: live Q1 dropped"]);
  });

  it("stops on a new start the live row didn't hold missing or for review", () => {
    expect(frameMergeProblems(2025, [row({ starts: { Q1: 100, Q2: 400, Q9: 2000 } })], [live], [live], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: new start Q9 wasn't missing or for review"]);
  });

  it("stops on an opening outside the 20/12/5/2/0 s leads", () => {
    expect(frameMergeProblems(2025, [row({ starts: { Q1: 100, Q2: 400 }, opens: { Q1: 93, Q2: 380 } })], [live], [live], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: Q1 opens 7 s before its start, not 20, 12, 5, 2 or 0 s before its start, or 2 or 4 s after it"]);
  });

  it("stops on a row removed, and on a video filed under another season", () => {
    expect(frameMergeProblems(2025, [], [live], [live], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: row removed"]);
    const other = row({ videoId: "VIDEOccccc3", starts: { Q1: 5 } });
    expect(frameMergeProblems(2025, [live, other], [live], [live], new Map([["VIDEOccccc3", 2024]]))).toEqual(["VIDEOccccc3|USXXQ: video already filed under 2024"]);
  });

  it("stops on an edge read beyond 120 s unless every frame between was clear", () => {
    const at = (o: Partial<FrameTiming>) => frameMergeProblems(2025, [row({ starts: { Q1: 100, Q2: 400 }, ...o })], [live], [live], NONE);
    expect(at({ opensOn: { at: 150, label: "Q1" } })).toEqual(["VIDEOaaaaa1|USXXQ: opening edge read at 150 s, beyond 120 s and not clear"]);
    expect(at({ endsOn: { at: 9000, label: "Q2", fromEnd: 200 } })).toEqual(["VIDEOaaaaa1|USXXQ: end edge read 200 s from the end, beyond 120 s and not clear"]);
    expect(at({ opensOn: { at: 150, label: "Q1", clear: true }, endsOn: { at: 9000, label: "Q2", fromEnd: 90 } })).toEqual([]);
  });

  it("stops on a live clip that would stop playing: a row gaining its first openings, a start left without one", () => {
    const bare = row({ checked: "2026-11-16", starts: { Q1: 100, Q2: 400, Q3: 700 } });
    // Q1 and Q2 get openings, Q3 none: with any openings in the row, Q3 isn't played any more.
    const partial = row({ starts: { Q1: 100, Q2: 400, Q3: 700 }, opens: { Q1: 80, Q2: 388 } });
    expect(frameMergeProblems(2025, [partial], [bare], [bare], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: live clip Q3 would stop playing"]);
    // Every start opened, or the unopened one kept as unconfirmed: nothing stops playing.
    expect(frameMergeProblems(2025, [row({ ...partial, opens: { Q1: 80, Q2: 388, Q3: 695 } })], [bare], [bare], NONE)).toEqual([]);
    expect(frameMergeProblems(2025, [row({ ...partial, unconfirmed: ["Q3"] })], [bare], [bare], NONE)).toEqual([]);
  });

  it("measures the PR's change from where it branched: rows main gained since aren't removals; main's newer row is the live one", () => {
    const gained = row({ videoId: "VIDEOeeeee5", starts: { Q1: 7 } });
    const next = row({ starts: { Q1: 100, Q2: 400, Q3: 700 }, opens: { Q1: 80, Q2: 380, Q3: 680 } });
    expect(frameMergeProblems(2025, [next], [live], [live, gained], NONE)).toEqual([]);
    // Main moved Q2 since the branch: the PR's row, still at the old second, would move main's live clip.
    const moved = row({ ...live, starts: { Q1: 100, Q2: 420 } });
    expect(frameMergeProblems(2025, [next], [live], [moved], NONE)).toEqual(["VIDEOaaaaa1|USXXQ: live Q2 moved 420 → 400"]);
  });

  it("leaves rows main already holds alone: only the PR's change is checked", () => {
    const old = row({ videoId: "VIDEOddddd4", starts: { Q2: 10, Q1: 20 } });
    expect(frameMergeProblems(2025, [old, live], [old, live], [old, live], NONE)).toEqual([]);
  });
});

describe("orderProblems", () => {
  it("orders quals, each semifinal series, finals", () => {
    expect(orderProblems(2022, { Q1: 10, Q2: 20, M1: 100, M2: 150, "M1-2": 200, "M2-2": 250, "M2-3": 300, F1: 400, F2: 500 })).toEqual([]);
    expect(orderProblems(2022, { Q1: 30, Q2: 20 })).toEqual(["Q2 starts at 20, not after Q1 (30) in quals"]);
    expect(orderProblems(2022, { M1: 300, "M1-2": 200 })).toEqual(["M1-2 starts at 200, not after M1 (300) in semifinal 1"]);
    expect(orderProblems(2022, { F1: 500, F2: 400 })).toEqual(["F2 starts at 400, not after F1 (500) in finals"]);
  });

  it("orders a double-elimination bracket by match, a replay only after its own match", () => {
    expect(orderProblems(2025, { M5: 100, M6: 200, M7: 300, "M6-2": 400, M8: 500 })).toEqual([]);
    expect(orderProblems(2025, { M5: 300, M6: 200 })).toEqual(["M6 starts at 200, not after M5 (300) in bracket"]);
    expect(orderProblems(2025, { M6: 300, "M6-2": 200 })).toEqual(["M6-2 starts at 200, not after M6 (300) in bracket M6"]);
    expect(labelPlaces(2025, "X1")).toEqual([]);
  });
});

describe("clipsMergeProblems", () => {
  const c = (o: Partial<ClipCheck> = {}): ClipCheck => ({ videoId: "W9fnbtAc6Z8", code: "USCOLIQ", season: 2025, checked: "2026-11-17", ...o });
  it("merges a sweep that keeps the sweep's rules; stops on a removed row or a broken one", () => {
    const live = c({ checked: "2026-11-16", ok: ["Q1"] });
    expect(clipsMergeProblems([c({ ok: ["Q1", "Q2"], pulled: { Q14: { t: 12659, showed: "Q17" } } })], [live], [live])).toEqual([]);
    expect(clipsMergeProblems([], [live], [live])).toEqual(["W9fnbtAc6Z8|USCOLIQ: row removed"]);
    expect(clipsMergeProblems([c({ ok: ["Q1"], pulled: { Q14: { t: 12659, showed: "Q14" } } })], [live], [live])).toEqual(["W9fnbtAc6Z8|USCOLIQ: Q14: pulled, but its frame names Q14"]);
  });
});

describe("readyProblems", () => {
  const checks = ["lint", "changelog", "test (shard 1/3)", "test (shard 2/3)", "test (shard 3/3)", "build"].map((name) => ({ name, state: "SUCCESS" }));
  const pr = (o: Partial<PrState> = {}): PrState => ({ head: "ea476144d0000", loopy: "**Confidence: 5/5** — No open findings.\n<sub>last reviewed `ea47614`</sub>", checks, ...o });
  it("is ready at Loopy 5/5 on the exact head with every check passed", () => {
    expect(readyProblems(pr())).toEqual([]);
  });
  it("waits on a lower confidence, a review of another head, no review, a check not passed, or too few checks", () => {
    expect(readyProblems(pr({ loopy: "**Confidence: 4/5**\nlast reviewed `ea47614`" }))).toEqual(["Loopy 4/5, not 5/5"]);
    expect(readyProblems(pr({ head: "ff7d51b0000" }))).toEqual(["Loopy reviewed ea47614, not the head ff7d51b"]);
    expect(readyProblems(pr({ loopy: null }))).toEqual(["no Loopy review"]);
    expect(readyProblems(pr({ checks: [...checks.slice(1), { name: "lint", state: "IN_PROGRESS" }] }))).toEqual(["checks not passed: lint IN_PROGRESS"]);
    expect(readyProblems(pr({ checks: checks.slice(0, 3) }))).toEqual(["3 checks, fewer than 5"]);
  });
});

describe("loopySummary", () => {
  const c = (login: string, type: string, body: string, updated_at: string) => ({ user: { login, type }, body, updated_at }) satisfies IssueComment;
  const real = c(LOOPY_LOGIN, "Bot", "<!-- loopy:summary -->\n**Confidence: 3/5**\nlast reviewed `aaaaaaa`", "2026-11-17T10:00:00Z");
  it("reads only Loopy's own bot account: a look-alike's later fake 5/5 never counts", () => {
    const fake = c("loopy-fan", "User", "<!-- loopy:summary -->\n**Confidence: 5/5**\nlast reviewed `aaaaaaa`", "2026-11-17T11:00:00Z");
    const fakeBot = c("loopyreviews-bot", "User", fake.body, "2026-11-17T12:00:00Z");
    expect(loopySummary([real, fake, fakeBot])).toBe(real.body);
    expect(loopySummary([fake, fakeBot])).toBeNull();
  });
  it("takes its last updated summary (it edits one in place), never its other comments", () => {
    const edited = { ...real, body: "<!-- loopy:summary -->\n**Confidence: 5/5**\nlast reviewed `bbbbbbb`", updated_at: "2026-11-17T13:00:00Z" };
    const chatter = c(LOOPY_LOGIN, "Bot", "Reviewing now…", "2026-11-17T14:00:00Z");
    expect(loopySummary([edited, c(LOOPY_LOGIN, "Bot", real.body, "2026-11-17T09:00:00Z"), chatter])).toBe(edited.body);
    expect(loopySummary([{ user: null, body: real.body, updated_at: "2026-11-17T15:00:00Z" }])).toBeNull();
  });
  it("reads a deleted author and an empty body as the REST jq gives them, without throwing", () => {
    // `{user: {login: .user.login, type: .user.type}}` on a deleted account: both fields null, never a null user.
    const ghost: IssueComment = { user: { login: null, type: null }, body: real.body, updated_at: "2026-11-17T16:00:00Z" };
    const empty: IssueComment = { user: { login: LOOPY_LOGIN, type: "Bot" }, body: null, updated_at: "2026-11-17T17:00:00Z" };
    expect(loopySummary([real, ghost, empty])).toBe(real.body);
  });
  it("names the head its summary says it reviewed", () => {
    expect(reviewedSha(real.body)).toBe("aaaaaaa");
    expect(reviewedSha("no sha here")).toBeNull();
    expect(reviewedSha(null)).toBeNull();
  });
});

describe("fileProblems: a data PR changes its data file only", () => {
  const file = "server/data/frameTimings/2024.ts";
  it("passes a PR with only its data file, with no version to check", () => {
    expect(fileProblems([file], file)).toEqual([]);
  });
  it("holds one still carrying a release from before (the next run rebuilds it without), and stops a person's file", () => {
    expect(fileProblems([file, "CHANGELOG.md", "package.json"], file)).toEqual(["still carries CHANGELOG.md, package.json (data PRs carry no version or CHANGELOG): rebuilt without on the next run"]);
    expect(fileProblems([file, "src/app.ts"], file)).toEqual(["changes more than its data file: src/app.ts"]);
    expect(fileProblems(["server/data/frameTimings/2023.ts"], file)).toEqual(["changes more than its data file: server/data/frameTimings/2023.ts", `doesn't change its data file ${file}`]);
  });
});

