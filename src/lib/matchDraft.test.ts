// @vitest-environment jsdom
// Scouting a whole match: one draft per team, one Save. New teams make new entries (template fields only,
// template recorded); a team you already scouted in this match is edited, never saved twice; teams with
// nothing entered are skipped unless asked; a read-only workspace keeps it in Personal; drafts survive a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { localScoutEntries, templateFor, type ScoutEntry } from "./scouting";
import { matchDraftKey, savedMessage, useMatchDraft, yourMatchEntry, type MatchDraftOptions } from "./matchDraft";
import type { ScoutTemplate } from "../shared/scoutTemplate";
import type { ScheduleMatch, WatchedTeam } from "../shared/scoutMatch";

const match: ScheduleMatch = { key: "qual:0:14", label: "Q14", level: "qual", time: null, startsAt: null, played: false, red: [4410, 18360], blue: [23014, 7175] };
const red: WatchedTeam[] = [{ team: 4410, side: "red", station: 1 }, { team: 18360, side: "red", station: 2 }];
const wsTemplate: ScoutTemplate = {
  id: "ws:w1:2025:match", kind: "match", name: "Match scouting", version: 3,
  fields: [
    { id: "cycles", label: "Cycles", type: "counter", phase: "teleop", min: 1, max: 30 },
    { id: "climb", label: "Climb", type: "choice", phase: "endgame", options: ["Partial", "Full"] },
    { id: "tipped", label: "Tipped", type: "toggle", phase: "overall" },
  ],
};

function setup(over: Partial<MatchDraftOptions> = {}) {
  const props: MatchDraftOptions = { space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: wsTemplate, existing: [], author: 7, ...over };
  return renderHook((p: MatchDraftOptions) => useMatchDraft(p), { initialProps: props });
}

/** A workspace entry as the server sent it (on the device, not queued). */
function serverEntry(e: Partial<ScoutEntry> & { uuid: string; team: number }): ScoutEntry {
  const full: ScoutEntry = {
    workspaceId: "w1", season: 2025, eventCode: "USNJQ1", matchLabel: "Q14", kind: "match", data: { cycles: 4 }, notes: "",
    updatedAt: 1_700_000_000_000, authorAccountId: 7, authorDisplayName: "Me", templateId: "ws:w1:2025:match", templateVersion: 2, ...e,
  };
  localStorage.setItem(`cs-scout-ws:w1:${full.uuid}`, JSON.stringify(full));
  return full;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("useMatchDraft", () => {
  it("saves one new entry per team: kind match, event, normalized label, template fields only, template recorded, counter min", () => {
    const { result } = setup({ match: { ...match, label: "qm 014" } });
    act(() => { result.current.setAnswer(4410, "climb", "Full"); result.current.setAnswer(4410, "stray", 9); });
    act(() => { result.current.setAnswer(18360, "cycles", 6); result.current.setNotes(18360, "fast cycles"); });
    expect(result.current.teams.map((t) => t.status)).toEqual(["started", "started"]);
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toEqual({ ok: true, saved: 2, unchanged: 0, skipped: [] });
    const saved = localScoutEntries("w1").sort((a, b) => a.team - b.team);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ team: 4410, kind: "match", eventCode: "USNJQ1", matchLabel: "Q14", workspaceId: "w1", templateId: "ws:w1:2025:match", templateVersion: 3, data: { climb: "Full", cycles: 1 } });
    expect(saved[0].data).not.toHaveProperty("stray");
    expect(saved[1]).toMatchObject({ team: 18360, data: { cycles: 6 }, notes: "fast cycles" });
    // Drafts go once saved.
    expect(sessionStorage.getItem(matchDraftKey("w1", 2025, "USNJQ1", "Q14", 7))).toBeNull();
  });

  it("edits your entry for a team in this match (same uuid, its own template, the base it was opened on): no duplicate", () => {
    const mine = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410 });
    const { result } = setup({ existing: [mine] });
    expect(result.current.teams[0]).toMatchObject({ status: "done", data: { cycles: 4 }, entry: { uuid: "aaaaaaaaaaaa" } });
    act(() => { result.current.setAnswer(4410, "cycles", 5); });
    expect(result.current.teams[0].status).toBe("started");
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch({ includeEmpty: false }); });
    expect(r).toMatchObject({ ok: true, saved: 1, skipped: [18360] });
    const all = localScoutEntries("w1");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ uuid: "aaaaaaaaaaaa", data: { cycles: 5 }, templateId: "ws:w1:2025:match", templateVersion: 2, baseUpdatedAt: mine.updatedAt });
  });

  it("keeps the base the draft was opened on when a newer version arrives meanwhile", () => {
    const mine = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410 });
    const { result, rerender } = setup({ existing: [mine] });
    act(() => { result.current.setAnswer(4410, "cycles", 9); });
    const newer = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410, updatedAt: mine.updatedAt + 5000, data: { cycles: 2 } });
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: wsTemplate, existing: [newer], author: 7 });
    act(() => { result.current.saveMatch(); });
    expect(localScoutEntries("w1")[0]).toMatchObject({ data: { cycles: 9 }, baseUpdatedAt: mine.updatedAt });
  });

  it("an already-saved team with nothing changed isn't saved again", () => {
    const { result } = setup({ existing: [serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410 }), serverEntry({ uuid: "bbbbbbbbbbbb", team: 18360 })] });
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toEqual({ ok: true, saved: 0, unchanged: 2, skipped: [] });
    expect(localStorage.getItem("cs-scout-ws-dirty:w1")).toBeNull();
    expect(savedMessage("Q14", r as Extract<typeof r, { ok: true }>, "Q15")).toBe("Q14 was already saved. Now Q15.");
  });

  it("never edits another member's entry: yours is a second entry", () => {
    const theirs = serverEntry({ uuid: "cccccccccccc", team: 4410, authorAccountId: 99 });
    const { result } = setup({ existing: [theirs] });
    expect(result.current.teams[0].status).toBe("empty");
    act(() => { result.current.setAnswer(4410, "tipped", true); });
    act(() => { result.current.saveMatch(); });
    const all = localScoutEntries("w1").filter((e) => e.team === 4410);
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.uuid === "cccccccccccc")?.data).toEqual({ cycles: 4 });
  });

  it("skips teams with nothing entered unless asked; untouched defaults are nothing", () => {
    const { result, rerender } = setup();
    act(() => { result.current.setAnswer(4410, "climb", "Partial"); result.current.setAnswer(18360, "cycles", 1); result.current.setAnswer(18360, "tipped", false); });
    expect(result.current.emptyTeams).toEqual([18360]);
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toMatchObject({ ok: true, saved: 1, skipped: [18360] });
    expect(localScoutEntries("w1").map((e) => e.team)).toEqual([4410]);
    // The page's list now has the saved entry (useScouting). The skipped team's draft stays; saving anyway
    // records it (with the counter's shown minimum), and the saved team isn't saved again.
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: wsTemplate, existing: localScoutEntries("w1"), author: 7 });
    expect(result.current.emptyTeams).toEqual([18360]);
    act(() => { r = result.current.saveMatch({ includeEmpty: true }); });
    expect(r).toMatchObject({ ok: true, saved: 1, unchanged: 1, skipped: [] });
    expect(localScoutEntries("w1").find((e) => e.team === 18360)?.data).toEqual({ cycles: 1, tipped: false });
  });

  it("Personal entries record no template and use the built-in fields", () => {
    const builtin = templateFor(2025, "match");
    const { result } = setup({ space: null, template: builtin, author: undefined });
    const f = builtin.fields.find((x) => x.type !== "text")!;
    act(() => { result.current.setAnswer(4410, f.id, f.type === "toggle" ? true : f.type === "choice" ? f.options![0] : 3); });
    act(() => { result.current.saveMatch(); });
    const [e] = localScoutEntries(null);
    expect(e).toMatchObject({ team: 4410, workspaceId: null, matchLabel: "Q14" });
    expect(e.templateId).toBeUndefined();
  });

  it("a read-only workspace keeps it in Personal, as new entries, with the workspace's answers in the notes", () => {
    const mine = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410 });
    const { result } = setup({ existing: [mine], readOnly: true, spaceName: "Robo Lions" });
    expect(result.current.toPersonal).toBe(true);
    act(() => { result.current.setAnswer(4410, "climb", "Full"); result.current.setNotes(4410, "solid"); });
    act(() => { result.current.saveMatch(); });
    expect(localScoutEntries("w1")).toEqual([mine]); // the workspace's copy is untouched
    const [p] = localScoutEntries(null);
    expect(p.uuid).not.toBe("aaaaaaaaaaaa");
    expect(p.templateId).toBeUndefined();
    expect(p.notes).toBe("solid\n\nAnswers from Robo Lions:\nClimb: Full\nCycles: 1");
  });

  it("a read-only save whose answers don't fit the notes saves nothing and says so", () => {
    const { result } = setup({ readOnly: true });
    act(() => { result.current.setAnswer(4410, "climb", "Full"); result.current.setNotes(4410, "x".repeat(4000)); });
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toMatchObject({ ok: false, saved: 0 });
    expect((r as { error: string }).error).toMatch(/^4410: .*Shorten its notes by \d+ characters/);
    expect(localScoutEntries(null)).toEqual([]);
  });

  it("drafts survive a remount (a locked phone, a reload), per match", () => {
    const first = setup();
    act(() => { first.result.current.setAnswer(4410, "climb", "Full"); first.result.current.setNotes(18360, "slow"); });
    first.unmount();
    const again = setup();
    expect(again.result.current.teams.map((t) => [t.data, t.notes, t.status])).toEqual([[{ climb: "Full" }, "", "started"], [{}, "slow", "started"]]);
    // Another match has its own drafts; coming back finds these again.
    again.rerender({ space: "w1", season: 2025, eventCode: "USNJQ1", match: { ...match, key: "qual:0:15", label: "Q15" }, teams: red, template: wsTemplate, existing: [], author: 7 });
    expect(again.result.current.teams.map((t) => t.status)).toEqual(["empty", "empty"]);
    again.rerender({ space: "w1", season: 2025, eventCode: "USNJQ1", match, teams: red, template: wsTemplate, existing: [], author: 7 });
    expect(again.result.current.teams[0].data).toEqual({ climb: "Full" });
  });

  it("a new entry keeps the template it was first answered with", () => {
    const { result, rerender } = setup();
    act(() => { result.current.setAnswer(4410, "climb", "Full"); });
    const v4: ScoutTemplate = { ...wsTemplate, version: 4, fields: wsTemplate.fields.filter((f) => f.id !== "climb") };
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: v4, existing: [], author: 7 });
    expect(result.current.teams[0].template.version).toBe(3);
    expect(result.current.teams[1].template.version).toBe(4);
    act(() => { result.current.saveMatch(); });
    expect(localScoutEntries("w1")[0]).toMatchObject({ templateVersion: 3, data: { climb: "Full" } });
  });

  it("a storage error says so like the old form and keeps the unsaved drafts", () => {
    const { result } = setup();
    act(() => { result.current.setAnswer(4410, "climb", "Full"); result.current.setAnswer(18360, "climb", "Partial"); });
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("cs-scout-ws:")) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    });
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toEqual({ ok: false, saved: 0, error: "This device couldn't save the entry (storage full or blocked). Nothing was lost from earlier entries." });
    expect(result.current.teams.map((t) => t.status)).toEqual(["started", "started"]);
  });

  it("a new draft stays new when your saved entry arrives meanwhile: that entry's answers are never replaced", () => {
    const { result, rerender } = setup();
    act(() => { result.current.setAnswer(4410, "climb", "Full"); });
    const arrived = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410, data: { cycles: 7 } });
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: wsTemplate, existing: [arrived], author: 7 });
    expect(result.current.teams[0]).toMatchObject({ status: "started", entry: null });
    act(() => { result.current.saveMatch(); });
    const all = localScoutEntries("w1").filter((e) => e.team === 4410);
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.uuid === "aaaaaaaaaaaa")?.data).toEqual({ cycles: 7 });
  });

  it("an edit whose entry was deleted meanwhile is saved as new, answers and template as they were", () => {
    const mine = serverEntry({ uuid: "aaaaaaaaaaaa", team: 4410, data: { cycles: 4, oldField: "x" } });
    const { result, rerender } = setup({ existing: [mine] });
    act(() => { result.current.setAnswer(4410, "cycles", 5); });
    const v4: ScoutTemplate = { ...wsTemplate, version: 4 };
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: v4, existing: [{ ...mine, deleted: true }], author: 7 });
    act(() => { result.current.saveMatch(); });
    const made = localScoutEntries("w1").find((e) => e.uuid !== "aaaaaaaaaaaa")!;
    expect(made).toMatchObject({ team: 4410, data: { cycles: 5, oldField: "x" }, templateId: "ws:w1:2025:match", templateVersion: 2 });
  });

  it("another account on the same device doesn't inherit a draft", () => {
    const a = setup();
    act(() => { a.result.current.setAnswer(4410, "climb", "Full"); });
    a.unmount();
    const b = setup({ author: 8 });
    expect(b.result.current.teams[0].status).toBe("empty");
    b.unmount();
    expect(setup().result.current.teams[0].data).toEqual({ climb: "Full" });
  });

  it("read-only: a team kept in Personal stays saved, so a retry after a storage error doesn't save it twice", () => {
    const { result } = setup({ readOnly: true });
    act(() => { result.current.setAnswer(4410, "climb", "Full"); result.current.setAnswer(18360, "climb", "Partial"); });
    const real = Storage.prototype.setItem;
    let writes = 0;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("cs-scout:") && ++writes === 2) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    });
    let r: ReturnType<typeof result.current.saveMatch> | undefined;
    act(() => { r = result.current.saveMatch(); });
    expect(r).toMatchObject({ ok: false, saved: 1 });
    expect(result.current.teams.map((t) => t.status)).toEqual(["done", "started"]);
    spy.mockRestore();
    act(() => { r = result.current.saveMatch({ includeEmpty: true }); });
    expect(r).toEqual({ ok: true, saved: 1, unchanged: 1, skipped: [] });
    expect(localScoutEntries(null).map((e) => e.team).sort((a, b) => a - b)).toEqual([4410, 18360]);
    // A later change updates that same Personal copy.
    act(() => { result.current.setNotes(4410, "late note"); });
    act(() => { result.current.saveMatch(); });
    expect(localScoutEntries(null).filter((e) => e.team === 4410)).toHaveLength(1);
  });

  it("a team kept in Personal while read-only goes to the workspace as a new entry, with its template, once writable", () => {
    const { result, rerender } = setup({ readOnly: true });
    act(() => { result.current.setAnswer(4410, "climb", "Full"); });
    act(() => { result.current.saveMatch(); });
    rerender({ space: "w1", season: 2025, eventCode: "usnjq1", match, teams: red, template: wsTemplate, existing: [], author: 7 });
    act(() => { result.current.setNotes(4410, "back online"); });
    act(() => { result.current.saveMatch(); });
    expect(localScoutEntries("w1")).toEqual([expect.objectContaining({ team: 4410, notes: "back online", templateId: "ws:w1:2025:match", templateVersion: 3, data: { climb: "Full", cycles: 1 } })]);
  });
});

describe("yourMatchEntry", () => {
  it("matches the event and the label however it was typed, and skips deleted and pit entries", () => {
    const e = (x: Partial<ScoutEntry>): ScoutEntry => ({ uuid: "u", workspaceId: null, season: 2025, team: 1, eventCode: "usnjq1", matchLabel: "q 014", kind: "match", data: {}, notes: "", updatedAt: 1, authorAccountId: 0, authorDisplayName: "", ...x });
    const o = { space: null, eventCode: "USNJQ1", label: "Q14", team: 1 };
    expect(yourMatchEntry([e({})], o)?.uuid).toBe("u");
    expect(yourMatchEntry([e({ deleted: true }), e({ kind: "pit" }), e({ matchLabel: "Q15" }), e({ eventCode: "X" })], o)).toBeNull();
    expect(yourMatchEntry([e({ uuid: "old" }), e({ uuid: "new", updatedAt: 5 })], o)?.uuid).toBe("new");
  });
});
