// @vitest-environment jsdom
// Audit PRIVATE-F02: an import checks every row before storing anything, counts only what it saved, and says
// how many rows it left out and why. The audit's own file (object-valued notes) imports nothing and breaks nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { importMessage, importRows, importScoutRows } from "./scoutImport";
import { localScoutEntries, saveScoutEntry } from "./scouting";

beforeEach(() => { localStorage.clear(); });

const good = (uuid: string, over: Record<string, unknown> = {}) => ({ uuid, team: 101, season: 2025, kind: "match", eventCode: "AUDIT1", matchLabel: "Q1", data: { auto: 3 }, notes: "fast", ...over });

describe("importing a scouting export", () => {
  it("the audit's file: object notes are refused, nothing is stored, the message says so", () => {
    const rows = importRows(JSON.stringify({ format: "control-scout-scouting", version: 1, entries: [good("audit-import-malformed", { data: {}, notes: { invalid: "object" } })] }))!;
    const r = importScoutRows(rows);
    expect(r).toEqual({ imported: 0, problems: ["notes not text"], notStored: 0 });
    expect(localStorage.getItem("cs-scout:audit-import-malformed")).toBeNull();
    expect(importMessage(r)).toEqual({ tone: "error", text: "Nothing imported. Skipped 1 entry that wasn't valid: notes not text (1)." });
  });

  it("valid rows are saved; bad ones are counted with their reasons; existing entries stay", () => {
    saveScoutEntry({ ...good("existing0001"), kind: "match", workspaceId: null });
    const r = importScoutRows([
      good("imported0001"),
      good("imported0002", { kind: "pit", matchLabel: null, data: { drivetrain: "Swerve", canDefend: true }, updatedAt: 1e300 }), // the file's timestamp isn't kept
      good("badnotes0001", { notes: ["x"] }),
      good("badnotes0002", { notes: 5 }),
      good("badteam00001", { team: "abc" }),
      good("baddata00001", { data: { cones: { deep: 1 } } }),
      "not an object",
    ]);
    expect(r.imported).toBe(2);
    expect(importMessage(r)).toEqual({
      tone: "warning",
      text: "Imported 2 entries. Skipped 5 entries that weren't valid: notes not text (2), not an entry (1), bad team number (1), answers not values (1).",
    });
    const stored = localScoutEntries().map((e) => e.uuid).sort();
    expect(stored).toEqual(["existing0001", "imported0001", "imported0002"]);
    const pit = localScoutEntries().find((e) => e.uuid === "imported0002")!;
    expect(pit.updatedAt).toBeLessThanOrEqual(Date.now());
    expect(pit.data).toEqual({ drivetrain: "Swerve", canDefend: true });
  });

  it("a clean file: success, with the count", () => {
    expect(importMessage(importScoutRows([good("clean0000001"), good("clean0000002")]))).toEqual({ tone: "success", text: "Imported 2 entries." });
  });

  it("a file that isn't an export, or has no entries", () => {
    expect(importRows("{nope")).toBeNull();
    expect(importRows(JSON.stringify({ format: "something-else", entries: [] }))).toBeNull();
    expect(importRows(JSON.stringify({ hello: 1 }))).toBeNull();
    expect(importRows(JSON.stringify([good("barelist0001")]))).toHaveLength(1);
    expect(importMessage(importScoutRows([]))).toEqual({ tone: "error", text: "That file has no scouting entries to import." });
  });
});
