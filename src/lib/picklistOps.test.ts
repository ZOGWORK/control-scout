// @vitest-environment jsdom
// The device's kept pick list order changes (picklistOps.ts): per account, workspace, season and op id; another
// account's are never read; expired and unreadable records are dropped; writes are announced.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDamagedOp, deleteKeptOp, KEPT_OP_MAX_AGE_MS, KEPT_OPS_CHANGED, keptOps, putKeptOp, readKeptOps, resetKeptOps, TAB_ID, type KeptPickOp } from "./picklistOps";

const rec = (o: Partial<KeptPickOp> = {}): KeptPickOp => ({
  account: 7, space: "ws-1", season: 2025, opId: "op-aaaa-1111", op: { op: "remove", team: 101 }, at: Date.now(),
  base: [101, 102], baseVersion: 3, state: "kept", tab: TAB_ID, ...o,
});

afterEach(async () => { await resetKeptOps(); });

describe("kept pick list changes (IndexedDB)", () => {
  it("keeps, updates and forgets a change; oldest first", async () => {
    expect(await putKeptOp(rec({ opId: "op-later-2222", at: Date.now() }))).toBe(true);
    expect(await putKeptOp(rec({ opId: "op-first-1111", at: Date.now() - 1000, op: { op: "move", team: 102, beforeTeam: 101 } }))).toBe(true);
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["op-first-1111", "op-later-2222"]);
    // Same key: replaced, not added.
    await putKeptOp(rec({ opId: "op-later-2222", state: "kept", message: "Not saved: offline" }));
    const all = await keptOps(7);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ message: "Not saved: offline", op: { op: "remove", team: 101 }, base: [101, 102], baseVersion: 3 });
    await deleteKeptOp(7, "ws-1", 2025, "op-first-1111");
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["op-later-2222"]);
  });

  it("the same op id in two workspaces or seasons is two changes", async () => {
    await putKeptOp(rec());
    await putKeptOp(rec({ space: "ws-2" }));
    await putKeptOp(rec({ season: 2024 }));
    expect((await keptOps(7)).map((r) => `${r.space}:${r.season}`).sort()).toEqual(["ws-1:2024", "ws-1:2025", "ws-2:2025"]);
  });

  it("never reads another account's changes (signed out, someone else signs in on the same device)", async () => {
    await putKeptOp(rec({ account: 7, opId: "mine-op-1111" }));
    await putKeptOp(rec({ account: 8, opId: "theirs-op-2222" }));
    await putKeptOp(rec({ account: 70, opId: "prefix-op-3333" })); // 70 starts with "7": still another account
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["mine-op-1111"]);
    expect((await keptOps(8)).map((r) => r.opId)).toEqual(["theirs-op-2222"]);
    // Deleting one account's change leaves the other's alone.
    await deleteKeptOp(8, "ws-1", 2025, "mine-op-1111");
    expect(await keptOps(7)).toHaveLength(1);
  });

  it("drops expired records; never applies unreadable ones, and keeps them (as damaged) for the member to discard", async () => {
    await putKeptOp(rec({ opId: "old-op-1111", at: Date.now() - KEPT_OP_MAX_AGE_MS - 1 }));
    await putKeptOp({ ...rec({ opId: "bad-op-2222" }), op: { op: "explode" } as unknown as KeptPickOp["op"] });
    await putKeptOp(rec({ opId: "good-op-3333" }));
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["good-op-3333"]);
    // Expired: removed, not just hidden: a later read with a clock set back doesn't bring it back.
    expect((await keptOps(7, Date.now() - KEPT_OP_MAX_AGE_MS)).map((r) => r.opId)).toEqual(["good-op-3333"]);
    // Unreadable: not dropped silently.
    expect((await readKeptOps(7)).damaged.map((d) => d.opId)).toEqual(["bad-op-2222"]);
  });
});

/** Store a record as damaged storage might hold it (bypassing the type). */
const raw = (o: Record<string, unknown>) => putKeptOp({ ...rec(), ...o } as unknown as KeptPickOp);
const damagedIds = async (account = 7) => (await readKeptOps(account)).damaged.map((d) => d.opId).sort();

describe("kept records are checked in full when read (audit V4-PRIVATE-001)", () => {
  it("the audit's exact row: a base with an object in it is damaged, never a change to apply", async () => {
    await putKeptOp({
      account: 7101, space: "audit-ws-a", season: 2025, opId: "v4-corrupt-stored-base", op: { op: "move", team: 104, beforeTeam: 101 },
      at: Date.now() - 60_000, base: [101, { legacy: "malformed team object" }, 104] as unknown as number[], baseVersion: 38, state: "kept",
      tab: "oldclosedtab", message: "AUDIT malformed persisted base",
    });
    expect(await keptOps(7101)).toEqual([]);
    const { damaged } = await readKeptOps(7101);
    expect(damaged).toHaveLength(1);
    // Only what identifies it comes back: its key, scope and (well-formed) change; nothing of the damaged order.
    expect(damaged[0]).toMatchObject({ account: 7101, space: "audit-ws-a", season: 2025, opId: "v4-corrupt-stored-base", op: { op: "move", team: 104, beforeTeam: 101 } });
    expect(damaged[0]).not.toHaveProperty("base");
  });

  it.each([
    ["a string team", [101, "104"]], ["team 0", [0, 101]], ["a negative team", [101, -5]], ["a fraction", [101, 1.5]], ["null", [101, null]],
    ["NaN", [101, NaN]], ["an array", [101, [102]]], ["the same team twice", [101, 101]], ["more teams than a list holds", Array.from({ length: 101 }, (_, i) => i + 1)],
  ])("a base order with %s is damaged", async (_what, base) => {
    await raw({ opId: "bad-base-0001", base });
    expect(await keptOps(7)).toEqual([]);
    expect(await damagedIds()).toEqual(["bad-base-0001"]);
  });

  it("a base that isn't a list is damaged", async () => {
    await raw({ opId: "bad-base-0002", base: { 0: 101 } });
    await raw({ opId: "bad-base-0003", base: "101,102" });
    await raw({ opId: "bad-base-0004", base: undefined });
    expect(await keptOps(7)).toEqual([]);
    expect(await damagedIds()).toEqual(["bad-base-0002", "bad-base-0003", "bad-base-0004"]);
  });

  it.each([
    ["a move of a string team", { op: "move", team: "104", beforeTeam: 101 }],
    ["a move before an object", { op: "move", team: 104, beforeTeam: { legacy: 1 } }],
    ["a move with no anchor at all", { op: "move", team: 104 }],
    ["a move both before and after", { op: "move", team: 104, beforeTeam: 101, afterTeam: 102 }],
    ["a move after a string", { op: "move", team: 104, beforeTeam: null, afterTeam: "102" }],
    ["a move before itself", { op: "move", team: 104, beforeTeam: 104 }],
    ["an add whose restore isn't true or false", { op: "add", team: 104, restore: "yes" }],
    ["a remove of team 0", { op: "remove", team: 0 }],
    ["a copy with an object in it", { op: "import", teams: [101, { team: 102 }] }],
    ["a copy of nothing", { op: "import", teams: [] }],
    ["a copy naming a team twice", { op: "import", teams: [101, 101] }],
    ["a note (never an order change)", { op: "note", team: 101, note: "x" }],
    ["an unknown kind", { op: "explode", team: 101 }],
    ["no op", null],
  ])("%s is damaged", async (_what, op) => {
    await raw({ opId: "bad-op-0001", op });
    expect(await keptOps(7)).toEqual([]);
    expect(await damagedIds()).toEqual(["bad-op-0001"]);
  });

  it.each([
    ["an op id that's too short", { opId: "x1" }], ["an op id with a space", { opId: "op id 0001" }], ["a numeric op id", { opId: 12345678 }],
    ["a time that's text", { at: "yesterday" }], ["no time", { at: undefined }], ["a time far in the future", { at: Date.now() + 2 * KEPT_OP_MAX_AGE_MS }],
    ["a negative version", { baseVersion: -1 }], ["a version that's text", { baseVersion: "3" }], ["an unknown state", { state: "done" }],
    ["a message that's an object", { message: { text: "hi" } }], ["uncertain that's text", { uncertain: "yes" }], ["a page id that's a number", { tab: 5 }],
    ["an empty workspace id", { space: "" }],
  ])("%s is damaged", async (_what, o) => {
    await raw({ opId: "bad-field-0001", ...o });
    expect(await keptOps(7)).toEqual([]);
    expect((await readKeptOps(7)).damaged).toHaveLength(1);
  });

  it("an old row with nothing but its key is damaged (no time, so it isn't expired either)", async () => {
    await putKeptOp({ account: 7, space: "ws-1", season: 2025, opId: "old-row-0001" } as unknown as KeptPickOp);
    expect(await keptOps(7)).toEqual([]);
    expect((await readKeptOps(7)).damaged[0]).toMatchObject({ opId: "old-row-0001", space: "ws-1", season: 2025, at: null, op: null });
  });

  it("valid rows, older shapes included, load whole and untouched", async () => {
    const at = Date.now() - 10_000;
    const rows: KeptPickOp[] = [
      rec({ opId: "legacy-no-tab-01", at }),
      rec({ opId: "empty-base-0001", at: at + 1, base: [], baseVersion: 0 }),
      rec({ opId: "add-no-anchor-01", at: at + 2, op: { op: "add", team: 104 } }),
      rec({ opId: "add-restore-0001", at: at + 3, op: { op: "add", team: 104, beforeTeam: null, restore: true } }),
      rec({ opId: "move-after-00001", at: at + 4, op: { op: "move", team: 101, beforeTeam: null, afterTeam: 102 } }),
      rec({ opId: "move-to-end-0001", at: at + 5, op: { op: "move", team: 101, beforeTeam: null } }),
      rec({ opId: "copy-teams-00001", at: at + 6, op: { op: "import", teams: [103, 104] } }),
      rec({ opId: "sending-0000001", at: at + 7, state: "sending", message: undefined }),
      rec({ opId: "uncertain-000001", at: at + 8, message: "Couldn't confirm", uncertain: true }),
    ];
    const { tab: _tab, ...noTab } = rows[0];
    rows[0] = noTab as KeptPickOp;
    for (const r of rows) await putKeptOp(r);
    const { ops, damaged } = await readKeptOps(7);
    expect(damaged).toEqual([]);
    expect(ops).toEqual(rows);
  });

  it("discarding a damaged record removes that one only, and only for its own account", async () => {
    await raw({ opId: "bad-base-0001", base: [101, { legacy: "x" }] });
    await raw({ opId: "bad-base-0001", account: 8, base: [101, { legacy: "x" }] });
    await putKeptOp(rec({ opId: "good-op-0001" }));
    const [d] = (await readKeptOps(7)).damaged;
    // Another account can't remove it by naming its key.
    expect(await deleteDamagedOp({ account: 8, key: d.key })).toBe(false);
    expect(await deleteDamagedOp(d)).toBe(true);
    expect(await readKeptOps(7)).toMatchObject({ damaged: [], ops: [{ opId: "good-op-0001" }] });
    expect(await damagedIds(8)).toEqual(["bad-base-0001"]);
  });

  it("another account's damaged records are never read", async () => {
    await raw({ opId: "theirs-bad-0001", account: 8, base: [101, {}] });
    expect(await readKeptOps(7)).toEqual({ ops: [], damaged: [] });
  });
});

describe("kept pick list changes: a damaged record never disturbs the rest", () => {
  it("the good ones still come back in order around a damaged one", async () => {
    await putKeptOp(rec({ opId: "first-op-0001", at: Date.now() - 3000 }));
    await raw({ opId: "bad-mid-00001", at: Date.now() - 2000, base: [101, { legacy: "malformed team object" }, 104] });
    await putKeptOp(rec({ opId: "third-op-0001", at: Date.now() - 1000 }));
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["first-op-0001", "third-op-0001"]);
  });

  it("announces each write and removal for the account", async () => {
    const heard: number[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<{ account: number }>).detail.account);
    window.addEventListener(KEPT_OPS_CHANGED, on);
    try {
      await putKeptOp(rec());
      await deleteKeptOp(7, "ws-1", 2025, "op-aaaa-1111");
      expect(heard).toEqual([7, 7]);
    } finally { window.removeEventListener(KEPT_OPS_CHANGED, on); }
  });
});
