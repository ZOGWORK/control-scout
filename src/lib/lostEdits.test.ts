// @vitest-environment jsdom
// Task 16 on the device: telling when this device is the last-write-wins loser
// (an offline edit, then a newer edit from someone else arrives by stream, pull
// or push answer), keeping the losing version once, and restoring it as an
// ordinary save that goes up with a restore marker. Personal entries never conflict.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLiveEntries, clearLocalScouting, exportLocalScouting, importLocalScouting, localScoutEntries, pendingScoutCounts, pullScouting, restoreScoutVersion, saveScoutEntry, scoutDraftBase, setScoutViewer, syncScouting, type ScoutEntry,
} from "./scouting";
import { dropLostEdit, lostEdits, markLostSeen, SCOUT_LOST_UNSAVED, SCOUT_OVERWRITTEN, type LostEdit } from "./lostEdits";
import { entryDiff, formatAnswer } from "./entryDiff";
import { builtinTemplate } from "../shared/scoutDefaults";

const ME = 8, PRIYA = 7;
beforeEach(() => { localStorage.clear(); setScoutViewer(ME); });
afterEach(() => { vi.unstubAllGlobals(); setScoutViewer(null); });

const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: { autoHive: 2 }, notes: "steady" };
/** What the server holds: written by `by`. */
const server = (over: Partial<ScoutEntry> & { updatedAt: number }, by = PRIYA, name = "Priya"): ScoutEntry => ({
  uuid: "conflict0001", workspaceId: "w1", ...base, authorAccountId: PRIYA, authorDisplayName: "Priya", editorAccountId: by, editorDisplayName: name, ...over,
});

function answer(fn: (path: string, body: any) => unknown) {
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    return new Response(JSON.stringify(fn(path, body)), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

/** The device has the server's copy (synced), then edits it offline. */
function offlineEdit(notes = "my offline notes") {
  applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000 }), seq: 1 }]);
  return saveScoutEntry({ ...localScoutEntries("w1")[0], notes, data: { autoHive: 5 } });
}

describe("detecting the last-write-wins loser", () => {
  it("an offline edit, then a newer edit from someone else arrives live: one notice, the losing version kept", () => {
    const heard: LostEdit[] = [];
    const on = (e: Event) => { const d = (e as CustomEvent<LostEdit>).detail; if (d) heard.push(d); };
    window.addEventListener(SCOUT_OVERWRITTEN, on);
    const mine = offlineEdit();
    expect(mine.baseUpdatedAt).toBe(1000); // based on the copy it had
    const theirs = server({ updatedAt: mine.updatedAt + 5000, notes: "Priya's notes", baseUpdatedAt: 1000 });
    applyLiveEntries("w1", [{ entry: theirs, seq: 2 }]);
    // Seen again by a pull: still one record, one notice.
    applyLiveEntries("w1", [{ entry: theirs, seq: 2 }]);
    window.removeEventListener(SCOUT_OVERWRITTEN, on);
    expect(heard).toHaveLength(1);
    const lost = lostEdits("w1");
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ uuid: "conflict0001", by: { accountId: PRIYA, name: "Priya" }, seen: false, mine: { notes: "my offline notes", data: { autoHive: 5 }, updatedAt: mine.updatedAt } });
    // The device now shows their version, and has nothing left to send for it.
    expect(localScoutEntries("w1")[0].notes).toBe("Priya's notes");
    expect(pendingScoutCounts().workspaces.w1).toBeUndefined();
    markLostSeen("w1", lost[0].id);
    expect(lostEdits("w1")[0].seen).toBe(true);
  });

  it("a tie: the push answer has our timestamp but someone else's text (theirs landed first): kept too", async () => {
    const mine = offlineEdit();
    answer((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: server({ updatedAt: mine.updatedAt, notes: "same instant" }) })) }));
    await syncScouting("w1");
    expect(lostEdits("w1").map((l) => [l.mine.notes, l.by.name])).toEqual([["my offline notes", "Priya"]]);
    expect(localScoutEntries("w1")[0].notes).toBe("same instant");
  });

  it("the push answer says a newer edit beat ours: kept too", async () => {
    const mine = offlineEdit();
    answer((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: server({ updatedAt: mine.updatedAt + 10, notes: "won", baseUpdatedAt: 1000 }) })) }));
    await syncScouting("w1");
    expect(lostEdits("w1").map((l) => [l.mine.notes, l.by.name])).toEqual([["my offline notes", "Priya"]]);
    expect(localScoutEntries("w1")[0].notes).toBe("won");
  });

  it("an offline edit refused because the entry was deleted meanwhile is kept too (the server never stored it)", async () => {
    const mine = offlineEdit();
    const gone = server({ updatedAt: mine.updatedAt - 10, deleted: true, data: {}, notes: "" }, PRIYA, "Priya");
    answer((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: false, error: "forbidden", entry: gone })) }));
    await syncScouting("w1");
    expect(localScoutEntries("w1")[0].deleted).toBe(true);
    expect(pendingScoutCounts().workspaces.w1).toBeUndefined();
    expect(lostEdits("w1").map((l) => [l.mine.notes, l.by.name])).toEqual([["my offline notes", "Priya"]]);
  });

  it("the same answers under another template version are a different version: a loss, not a match", () => {
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000, templateId: "ws:w1:2025:match", templateVersion: 1 }), seq: 1 }]);
    const mine = saveScoutEntry({ ...localScoutEntries("w1")[0], templateVersion: 2 });
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 1000, templateId: "ws:w1:2025:match", templateVersion: 3 }), seq: 2 }]);
    expect(lostEdits("w1")).toHaveLength(1);
  });

  it("no notice for your own edit from another device, for a newer copy that says the same, or for personal entries", async () => {
    let mine = offlineEdit();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 1, notes: "from my phone" }, ME, "Me"), seq: 2 }]);
    mine = saveScoutEntry({ ...localScoutEntries("w1")[0], notes: "same words" });
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 1, notes: "same words" }), seq: 3 }]);
    expect(lostEdits("w1")).toEqual([]);
    // Personal: a newer copy from the account simply wins.
    saveScoutEntry({ uuid: "personal0001", ...base, notes: "local" });
    answer(() => ({ entries: [{ uuid: "personal0001", ...base, notes: "other device", updatedAt: Date.now() + 1000 }] }));
    await pullScouting(null);
    expect(localScoutEntries()[0].notes).toBe("other device");
    expect(Object.keys(localStorage).filter((k) => k.startsWith("cs-scout-lost:"))).toEqual([]);
  });

  it("a synced edit of yours replaced by someone who never saw it is a loss; by someone who did, it isn't", () => {
    // Your edit, synced: the server's copy says you wrote it.
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 2000, notes: "mine, synced" }, ME, "Me"), seq: 1 }]);
    // Priya edits after seeing it (based on 2000): normal teamwork.
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 3000, notes: "Priya builds on it", baseUpdatedAt: 2000 }), seq: 2 }]);
    expect(lostEdits("w1")).toEqual([]);
    // You edit again and sync; then Marcus's offline edit, based on the 1000 copy, lands on top.
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 4000, notes: "mine again" }, ME, "Me"), seq: 3 }]);
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 5000, notes: "Marcus offline", baseUpdatedAt: 1000 }, 9, "Marcus"), seq: 4 }]);
    expect(lostEdits("w1").map((l) => [l.mine.notes, l.by.name])).toEqual([["mine again", "Marcus"]]);
  });
});

describe("the base of an edit", () => {
  it("a form keeps the version it opened with: a newer one that arrived while it was open isn't claimed as seen", () => {
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000 }), seq: 1 }]);
    const opened = localScoutEntries("w1")[0];
    const base = scoutDraftBase(opened);
    expect(base).toBe(1000);
    // Marcus's edit arrives while the form is open.
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 2000, notes: "Marcus" }, 9, "Marcus"), seq: 2 }]);
    const saved = saveScoutEntry({ ...opened, notes: "from the open form" }, { base });
    expect(saved.baseUpdatedAt).toBe(1000);
    expect(saved.updatedAt).toBeGreaterThan(2000);
    // Without a draft base, the copy on the device now is the base.
    expect(saveScoutEntry({ ...opened, notes: "x" }).baseUpdatedAt).toBe(1000); // still queued: keeps its own base
  });
});

describe("when the device can't keep the losing version", () => {
  const full = () => {
    const real = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("cs-scout-lost:")) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    });
  };
  afterEach(() => { vi.restoreAllMocks(); });

  it("a merge leaves the queued edit in place (still queued) and says so, instead of losing it", () => {
    const mine = offlineEdit();
    const heard: string[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener(SCOUT_LOST_UNSAVED, on);
    full();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 5000, notes: "Priya's notes" }), seq: 2 }]);
    window.removeEventListener(SCOUT_LOST_UNSAVED, on);
    expect(heard).toEqual(["w1"]);
    expect(localScoutEntries("w1")[0].notes).toBe("my offline notes");
    expect(pendingScoutCounts().workspaces.w1).toBe(1);
  });

  it("an account's stashed lost edits: merged back with any already here; the ones the device can't store are handed back", () => {
    const mine = offlineEdit();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 5000, notes: "Priya's notes" }), seq: 2 }]);
    const stash = exportLocalScouting();
    expect(Object.keys(stash.lost ?? {})).toEqual(["cs-scout-lost:w1"]);
    // Merged with what's here (no duplicate of the same version), and open notices hear about it.
    let heard = 0;
    const on = () => { heard++; };
    window.addEventListener(SCOUT_OVERWRITTEN, on);
    expect(importLocalScouting({ entries: [], dirty: [], lost: stash.lost }).failed).toBeNull();
    window.removeEventListener(SCOUT_OVERWRITTEN, on);
    expect(heard).toBe(1);
    expect(lostEdits("w1")).toHaveLength(1);
    // A full device: handed back, so the caller keeps its stash.
    clearLocalScouting();
    full();
    expect(importLocalScouting({ entries: [], dirty: [], lost: stash.lost }).failed?.lost).toEqual(stash.lost);
  });

  it("putting a stash back never replaces a newer copy on the device; its queue marker still merges", () => {
    const old = saveScoutEntry({ uuid: "stashed00002", ...base, workspaceId: "w1", notes: "old" });
    const stash = exportLocalScouting();
    const newer = saveScoutEntry({ ...old, notes: "edited since" });
    importLocalScouting(stash);
    expect(localScoutEntries("w1")[0]).toMatchObject({ notes: "edited since", updatedAt: newer.updatedAt });
    expect(pendingScoutCounts().workspaces.w1).toBe(1);
  });

  it("queued entries that can't be put back are handed back too (with their queue)", () => {
    const queued = saveScoutEntry({ uuid: "stashed00001", ...base, workspaceId: "w1" });
    const stash = exportLocalScouting();
    clearLocalScouting();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    const { failed } = importLocalScouting(stash);
    expect(failed?.spaces.w1.entries.map((e) => e.uuid)).toEqual([queued.uuid]);
    expect(failed?.spaces.w1.dirty).toEqual([queued.uuid]);
  });

  it("a push answer does the same: the edit stays queued until it can be kept", async () => {
    const mine = offlineEdit();
    full();
    answer((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: server({ updatedAt: mine.updatedAt + 10, notes: "won" }) })) }));
    await syncScouting("w1");
    expect(localScoutEntries("w1")[0].notes).toBe("my offline notes");
    expect(pendingScoutCounts().workspaces.w1).toBe(1);
    vi.restoreAllMocks();
    await syncScouting("w1");
    expect(localScoutEntries("w1")[0].notes).toBe("won");
    expect(lostEdits("w1").map((l) => l.mine.notes)).toEqual(["my offline notes"]);
  });
});

describe("restoring a lost version", () => {
  it("saves it as a new edit with a restore marker; once the server has it, the lost record goes", async () => {
    const mine = offlineEdit();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 5000, notes: "Priya's notes" }), seq: 2 }]);
    const [lost] = lostEdits("w1");
    const restored = restoreScoutVersion(localScoutEntries("w1")[0], lost.mine);
    expect(restored).toMatchObject({ notes: "my offline notes", data: { autoHive: 5 }, restoredFrom: mine.updatedAt, deleted: false });
    // Newer than their version (here stamped ahead of this device's clock), so it wins.
    expect(restored.updatedAt).toBeGreaterThan(mine.updatedAt + 5000);
    const calls = answer((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: { ...x, editorAccountId: ME, editorDisplayName: "Me", restoredFrom: undefined } })) }));
    await syncScouting("w1");
    expect(calls[0].body.entries[0]).toMatchObject({ restoredFrom: mine.updatedAt, notes: "my offline notes" });
    expect(lostEdits("w1")).toEqual([]);
    expect(localScoutEntries("w1")[0].restoredFrom).toBeUndefined();
  });

  it("an edit or delete after a restore stays newer than it, even when the version restored over came from a clock running ahead", () => {
    const mine = offlineEdit();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 60_000, notes: "ahead" }), seq: 2 }]);
    const restored = restoreScoutVersion(localScoutEntries("w1")[0], lostEdits("w1")[0].mine);
    const { restoredFrom: _r, ...rest } = restored;
    const edited = saveScoutEntry({ ...rest, notes: "and one more change" });
    const gone = saveScoutEntry({ ...edited, deleted: true });
    expect(gone.updatedAt).toBeGreaterThan(edited.updatedAt);
    expect(edited.updatedAt).toBeGreaterThan(restored.updatedAt);
  });

  it("restoring a version made before templates names the built-in template, so the entry's newer one doesn't stay", () => {
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000, kind: "pit", templateId: "ws:w1:2025:pit", templateVersion: 3 }), seq: 1 }]);
    const r = restoreScoutVersion(localScoutEntries("w1")[0], { ...base, updatedAt: 500 });
    expect(r).toMatchObject({ kind: "match", templateId: "match-2025", templateVersion: 0 });
  });

  it("keeping their version forgets yours", () => {
    const mine = offlineEdit();
    applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 5000 }), seq: 2 }]);
    dropLostEdit("w1", lostEdits("w1")[0].id);
    expect(lostEdits("w1")).toEqual([]);
  });
});

describe("field-level diffs", () => {
  const fields = builtinTemplate(2025, "match").fields;
  it("labels each changed answer with the template's label and shows values as the form does", () => {
    const toggle = fields.find((f) => f.type === "toggle")!, counter = fields.find((f) => f.type === "counter")!, rating = fields.find((f) => f.type === "rating")!;
    const before = { ...base, data: { [counter.id]: 2, [toggle.id]: true, [rating.id]: 3 }, notes: "steady" };
    const after = { ...base, matchLabel: "Q2", data: { [counter.id]: 4, [rating.id]: 3 }, notes: "fast" };
    const rows = entryDiff(before, after, fields);
    expect(rows[0]).toEqual({ key: "match", label: "Match", before: "Q1", after: "Q2" });
    expect(rows.slice(1, -1)).toEqual(expect.arrayContaining([
      { key: `f:${toggle.id}`, label: toggle.label, before: "Yes", after: "No" },
      { key: `f:${counter.id}`, label: counter.label, before: "2", after: "4" },
    ]));
    expect(rows).toHaveLength(4); // the unchanged rating isn't a difference
    expect(rows.at(-1)).toEqual({ key: "notes", label: "Notes", before: "steady", after: "fast" });
  });
  it("an answer no template names keeps its id; a deleted version shows as a status change", () => {
    expect(entryDiff({ ...base, data: { custom1: "x" } }, { ...base, data: { custom1: "y" } }, fields)).toEqual([{ key: "f:custom1", label: "custom1", before: "x", after: "y" }]);
    // Each side reads with its own template: a rating whose scale changed from 5 to 10 keeps "of 5" on the old side.
    const r5 = { id: "drive", label: "Driving", type: "rating" as const, phase: "overall" as const, max: 5 };
    expect(entryDiff({ ...base, data: { drive: 4 } }, { ...base, data: { drive: 4 } }, [r5], [{ ...r5, max: 10, label: "Driving (1-10)" }]))
      .toEqual([{ key: "f:drive", label: "Driving (1-10)", before: "4 / 5", after: "4 / 10" }]);
    // A deleted side reads empty, so the live side's answers and notes still show (what a restore brings back).
    expect(entryDiff(base, { ...base, deleted: true, data: {}, notes: "" }, fields)).toEqual([
      { key: "deleted", label: "Status", before: "Live", after: "Deleted" },
      { key: "f:autoHive", label: "autoHive", before: "2", after: "—" },
      { key: "notes", label: "Notes", before: "steady", after: "—" },
    ]);
    expect(formatAnswer(undefined, { type: "counter", min: 1 })).toBe("1");
    expect(formatAnswer(4, { type: "rating", max: 5 })).toBe("4 / 5");
  });
});
