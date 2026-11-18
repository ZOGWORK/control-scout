// The merge gate's own-shape rules (scripts/lib/autopilotPr.ts): what stops an autopilot PR merging before any of its
// rows are read. The row rules are tested in autopilotMerge.test.ts.
import { describe, expect, it } from "vitest";
import { CLIPS_FILE, seasonFile, shapeProblems, type PrView } from "./autopilotPr";
import { prMarker } from "./autopilotRows";

const ROWS = [{ videoId: "VIDEOaaaaa1", code: "USXXQ" }];
const pr = (o: Partial<PrView> = {}): PrView => ({
  state: "OPEN", isDraft: false, mergeable: "MERGEABLE", headRefName: "clip-autopilot/2025-x-USXXQ",
  body: `Read by the clip autopilot.\n\n${prMarker(2025, ROWS)}`, files: [{ path: seasonFile(2025), changeType: "MODIFIED" }], ...o,
});

describe("shapeProblems", () => {
  it("passes an open data PR from the autopilot's branch changing its season file only", () => {
    expect(shapeProblems(pr())).toMatchObject({ file: seasonFile(2025), problems: [] });
    // A sweep PR: its mark names the clip checks file.
    expect(shapeProblems(pr({ body: prMarker(0, ROWS, CLIPS_FILE), files: [{ path: CLIPS_FILE, changeType: "MODIFIED" }] }))).toMatchObject({ file: CLIPS_FILE, problems: [] });
  });

  it("stops on any file beside its data file: a release (CHANGELOG, version) is no longer part of a data PR", () => {
    const files = ["CHANGELOG.md", "package.json", "package-lock.json"].map((path) => ({ path }));
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "MODIFIED" }, ...files] })).problems).toEqual(["changes more than its data file: CHANGELOG.md, package.json, package-lock.json"]);
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "MODIFIED" }, { path: "server/index.ts" }] })).problems).toEqual(["changes more than its data file: server/index.ts"]);
  });

  it("stops on a mark naming a file that isn't the autopilot's own, or no mark", () => {
    const bad = shapeProblems(pr({ body: prMarker(2025, ROWS, "server/index.ts"), files: [{ path: "server/index.ts" }] }));
    expect(bad).toMatchObject({ file: "", problems: [`its mark names server/index.ts, not ${seasonFile(2025)} or ${CLIPS_FILE}`] });
    expect(shapeProblems(pr({ body: "no mark here" }))).toMatchObject({ mark: null, file: "", problems: ["no autopilot mark"] });
  });

  it("waits on a PR not open, a draft, a conflict, mergeability not worked out, or another branch", () => {
    expect(shapeProblems(pr({ state: "CLOSED" })).problems).toEqual(["closed, not open"]);
    expect(shapeProblems(pr({ isDraft: true })).problems).toEqual(["a draft"]);
    expect(shapeProblems(pr({ mergeable: "CONFLICTING" })).problems).toEqual(["conflicts with main"]);
    expect(shapeProblems(pr({ mergeable: "UNKNOWN" })).problems).toEqual(["mergeability unknown, not worked out yet"]);
    expect(shapeProblems(pr({ headRefName: "claude/clips-2025" })).problems).toEqual(["branch claude/clips-2025, not the autopilot's (clip-autopilot/…)"]);
  });
});

describe("shapeProblems: its data file changed in place", () => {
  it("stops on a rename, an add or a delete of its data file, and on a PR changing nothing", () => {
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "MODIFIED" }] })).problems).toEqual([]);
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "RENAMED" }] })).problems).toEqual([`${seasonFile(2025)} renamed, not changed in place`]);
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "ADDED" }] })).problems).toEqual([`${seasonFile(2025)} added, not changed in place`]);
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025), changeType: "DELETED" }] })).problems).toEqual([`${seasonFile(2025)} deleted, not changed in place`]);
    // No change type at all (a malformed or older reply): never taken for an in-place change.
    expect(shapeProblems(pr({ files: [{ path: seasonFile(2025) }] })).problems).toEqual([`${seasonFile(2025)}: no change type from GitHub, not known to be changed in place`]);
    expect(shapeProblems(pr({ files: [] })).problems).toEqual([`doesn't change ${seasonFile(2025)}`]);
  });
});
