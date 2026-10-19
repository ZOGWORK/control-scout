// @vitest-environment jsdom
// Pick list note drafts on the device (audit PRIVATE-F03): kept per account, workspace, season and team;
// another account's never listed; expired or unreadable ones removed; blocked storage never throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNoteDraft, DRAFT_MAX_AGE_MS, noteDrafts, readNoteDraft, saveNoteDraft } from "./picklistDrafts";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("pick list note drafts", () => {
  it("are per account, workspace, season and team", () => {
    saveNoteDraft(1, "901", 2025, { team: 102, note: "mine", base: null, at: 1000 });
    saveNoteDraft(1, "901", 2025, { team: 101, note: "also mine", base: 50, at: 1000 });
    saveNoteDraft(2, "901", 2025, { team: 102, note: "Marcus's", base: null, at: 1000 });
    saveNoteDraft(1, "902", 2025, { team: 102, note: "other space", base: null, at: 1000 });
    saveNoteDraft(1, "901", 2024, { team: 102, note: "other season", base: null, at: 1000 });
    expect(noteDrafts(1, "901", 2025, 2000).map((d) => [d.team, d.note, d.base]).sort()).toEqual([[101, "also mine", 50], [102, "mine", null]]);
    expect(noteDrafts(2, "901", 2025, 2000).map((d) => d.note)).toEqual(["Marcus's"]);
    clearNoteDraft(1, "901", 2025, 102);
    expect(readNoteDraft(1, "901", 2025, 102)).toBeNull();
    expect(readNoteDraft(2, "901", 2025, 102)?.note).toBe("Marcus's");
  });

  it("an expired or unreadable draft is removed when listed", () => {
    saveNoteDraft(1, "901", 2025, { team: 102, note: "old", base: null, at: 0 });
    localStorage.setItem("cs-picknote:1:901:2025:103", "{not json");
    expect(noteDrafts(1, "901", 2025, DRAFT_MAX_AGE_MS + 1)).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("blocked storage: nothing kept, nothing thrown", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(saveNoteDraft(1, "901", 2025, { team: 102, note: "x", base: null, at: 1 })).toBe(false); // says so, never throws
    expect(readNoteDraft(1, "901", 2025, 102)).toBeNull();
    expect(noteDrafts(1, "901", 2025)).toEqual([]);
  });
});
