// @vitest-environment jsdom
// Audit PRIVATE-F02: an import checks every row before storing anything, counts only what it saved, and says
// how many rows it left out and why. The audit's own file (object-valued notes) imports nothing and breaks nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyScoutImport, downloadScoutBackup, importMessage, importPlan, importRows, importScoutRows, previewScoutImport, scoutExportJson } from "./scoutImport";
import { localScoutEntries, saveScoutEntry } from "./scouting";

beforeEach(() => { localStorage.clear(); });

const good = (uuid: string, over: Record<string, unknown> = {}) => ({ uuid, team: 101, season: 2025, kind: "match", eventCode: "AUDIT1", matchLabel: "Q1", data: { auto: 3 }, notes: "fast", ...over });

describe("importing a scouting export", () => {
  it("the audit's file: object notes are refused, nothing is stored, the message says so", () => {
    const rows = importRows(JSON.stringify({ format: "control-scout-scouting", version: 1, entries: [good("audit-import-malformed", { data: {}, notes: { invalid: "object" } })] }))!;
    const r = importScoutRows(rows);
    expect(r).toMatchObject({ imported: 0, problems: ["notes not text"], notStored: 0 });
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

// Audit E3: the preview, read before anything is written.
describe("previewing an import", () => {
  const snapshot = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

  it("counts new, already here and invalid rows, with a reason tied to each bad row, and writes nothing", () => {
    saveScoutEntry({ ...good("here00000001"), kind: "match", workspaceId: null });
    saveScoutEntry({ ...good("other0000001"), kind: "match", workspaceId: null });
    const before = snapshot();
    const p = previewScoutImport([
      good("new000000001"),
      good("here00000001", { notes: "changed", updatedAt: Date.now() + 1000 }),
      good("badnotes0001", { notes: { x: 1 }, matchLabel: "Q3" }),
      good("badteam00001", { team: "abc" }),
      "nope",
      good("new000000001", { matchLabel: "Q9" }),
    ]);
    expect(snapshot()).toBe(before); // a preview reads only
    expect(p.total).toBe(6);
    expect(p.fresh.map((r) => r.row)).toEqual([1]);
    expect(p.duplicates.map((d) => [d.row, d.age])).toEqual([[2, "newer"]]);
    expect(p.invalid.map((r) => `Row ${r.row} · ${r.label}: ${r.reason}`)).toEqual([
      "Row 3 · team 101 · Q3: notes not text",
      "Row 4 · team abc · Q1: bad team number",
      "Row 5 · not an entry: not an entry",
      "Row 6 · team 101 · Q9: same id as row 1",
    ]);
    expect(p.untouched).toBe(1); // other0000001 stays as it is
    expect(importPlan(p, "newer")).toEqual({ add: 1, update: 1, keep: 0, skip: 4 });
  });

  it("says whether each duplicate is newer, older, the same or undated, and the policy picks which replace", () => {
    const t = Date.now();
    for (const id of ["dupnewer0001", "dupolder0001", "dupsame00001", "dupnodate001"]) saveScoutEntry({ ...good(id), kind: "match", workspaceId: null });
    const p = previewScoutImport([
      good("dupnewer0001", { notes: "theirs", updatedAt: t + 60_000 }),
      good("dupolder0001", { notes: "theirs", updatedAt: t - 60_000 }),
      good("dupsame00001", { updatedAt: t - 60_000 }),
      good("dupnodate001", { notes: "theirs" }),
    ]);
    expect(p.duplicates.map((d) => d.age)).toEqual(["newer", "older", "same", "undated"]);
    expect(importPlan(p, "newer")).toMatchObject({ add: 0, update: 1, keep: 3 });
    expect(importPlan(p, "file")).toMatchObject({ add: 0, update: 3, keep: 1 }); // an identical copy is never rewritten

    const r = applyScoutImport(p, "newer");
    expect(r).toMatchObject({ imported: 1, updated: 1, kept: 3 });
    const notes = Object.fromEntries(localScoutEntries().map((e) => [e.uuid, e.notes]));
    expect(notes).toMatchObject({ dupnewer0001: "theirs", dupolder0001: "fast", dupnodate001: "fast" });
    expect(importMessage(r)).toEqual({ tone: "success", text: "Imported 1 entry (0 new, 1 updated). Kept the copies of 3 entries already here." });

    applyScoutImport(previewScoutImport([good("dupolder0001", { notes: "theirs", updatedAt: t - 60_000 })]), "file");
    expect(localScoutEntries().find((e) => e.uuid === "dupolder0001")!.notes).toBe("theirs");
  });

  it("imports go to Personal only: a workspace copy with the same id is untouched", () => {
    saveScoutEntry({ ...good("shared000001"), kind: "match", workspaceId: "ws1" });
    const p = previewScoutImport([good("shared000001", { notes: "mine" })]);
    expect(p.fresh).toHaveLength(1);
    applyScoutImport(p, "file");
    expect(localScoutEntries("ws1")[0].notes).toBe("fast");
    expect(localScoutEntries().find((e) => e.uuid === "shared000001")!.notes).toBe("mine");
  });

  it("rows the file marks deleted are left out, never deleting anything here", () => {
    saveScoutEntry({ ...good("keepme000001"), kind: "match", workspaceId: null });
    const p = previewScoutImport([good("keepme000001", { deleted: true, updatedAt: Date.now() + 5000 }), good("gone00000001", { deleted: true })]);
    expect(p.deletedInFile.map((r) => r.row)).toEqual([1, 2]);
    const r = applyScoutImport(p, "file");
    expect(localScoutEntries().find((e) => e.uuid === "keepme000001")!.deleted).toBeFalsy();
    expect(importMessage(r)).toEqual({ tone: "success", text: "Nothing new to import. Left out 2 entries marked deleted in the file." });
  });

  it("a partially invalid file never gets a plain success", () => {
    expect(importMessage(importScoutRows([good("okrow0000001"), good("okrow0000001")])).tone).toBe("warning");
    expect(importMessage(importScoutRows([good("okrow0000002"), good("badrow000001", { notes: 1 })])).tone).toBe("warning");
  });

  it("older exports stay compatible: a bare list, version 1, and no format field", () => {
    const old = { uuid: "oldformat001", team: 7, season: 2024, kind: "pit", eventCode: null, matchLabel: null, data: { drivetrain: "Tank" }, notes: "", updatedAt: 1_700_000_000_000 };
    for (const text of [JSON.stringify([old]), JSON.stringify({ format: "control-scout-scouting", version: 1, entries: [old] }), JSON.stringify({ entries: [old] })]) {
      localStorage.clear();
      const p = previewScoutImport(importRows(text)!);
      expect(p.fresh.map((r) => r.label)).toEqual(["team 7 · pit"]);
      expect(applyScoutImport(p, "newer").imported).toBe(1);
    }
  });

  it("the backup is an export of Personal on this device that Import reads back", () => {
    saveScoutEntry({ ...good("backup000001"), kind: "match", workspaceId: null });
    saveScoutEntry({ ...good("backup000002"), kind: "match", workspaceId: null, deleted: true });
    saveScoutEntry({ ...good("wsonly000001"), kind: "match", workspaceId: "ws1" });
    const text = scoutExportJson(new Date("2026-10-19T00:00:00Z"));
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: "control-scout-scouting", version: 1, exportedAt: "2026-10-19T00:00:00.000Z" });
    expect(file.entries.map((e: { uuid: string }) => e.uuid)).toEqual(["backup000001"]);
    expect(file.entries[0].workspaceId).toBeUndefined();
    expect(previewScoutImport(importRows(text)!).duplicates.map((d) => d.age)).toEqual(["same"]); // round-trips

    const blobs: Blob[] = [];
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    let name = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    downloadScoutBackup(new Date("2026-10-19T00:00:00Z"));
    expect(click).toHaveBeenCalledOnce();
    expect(name).toBe("control-scout-scouting-backup-2026-10-19.json");
    expect(blobs[0].type).toBe("application/json");
    create.mockRestore(); click.mockRestore();
  });
});
