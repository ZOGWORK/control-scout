// @vitest-environment jsdom
// The device's kept pick list order changes (picklistOps.ts): per account, workspace, season and op id; another
// account's are never read; expired and unreadable records are dropped; writes are announced.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteKeptOp, KEPT_OP_MAX_AGE_MS, KEPT_OPS_CHANGED, keptOps, putKeptOp, resetKeptOps, TAB_ID, type KeptPickOp } from "./picklistOps";

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

  it("drops expired and unreadable records", async () => {
    await putKeptOp(rec({ opId: "old-op-1111", at: Date.now() - KEPT_OP_MAX_AGE_MS - 1 }));
    await putKeptOp({ ...rec({ opId: "bad-op-2222" }), op: { op: "explode" } as unknown as KeptPickOp["op"] });
    await putKeptOp(rec({ opId: "good-op-3333" }));
    expect((await keptOps(7)).map((r) => r.opId)).toEqual(["good-op-3333"]);
    // Removed, not just hidden: a later read with a clock set back doesn't bring them back.
    expect((await keptOps(7, Date.now() - KEPT_OP_MAX_AGE_MS)).map((r) => r.opId)).toEqual(["good-op-3333"]);
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
