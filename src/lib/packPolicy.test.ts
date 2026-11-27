import { describe, expect, it } from "vitest";
import { LITE_RECHECK_MS, SEEN_KEY, SESSION_KEY, constrained, followsTeams, liteRecheckDue, noteVisit, shouldSyncLite, type SyncSignals } from "./packPolicy";

class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const blocked = { getItem(): string | null { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };

describe("noteVisit", () => {
  it("first session is new, a later session (new tab, next day) is returning", () => {
    const local = new Mem();
    expect(noteVisit(local, new Mem(), 1)).toBe(false);
    expect(local.getItem(SEEN_KEY)).toBe("1");
    expect(noteVisit(local, new Mem(), 2)).toBe(true);
  });
  it("the verdict holds for the whole session: more pages and reloads in the first session stay new", () => {
    const local = new Mem(), session = new Mem();
    expect(noteVisit(local, session)).toBe(false);
    expect(noteVisit(local, session)).toBe(false);
    expect(session.getItem(SESSION_KEY)).toBe("new");
  });
  it("a returning session stays returning", () => {
    const local = new Mem(), session = new Mem();
    local.setItem(SEEN_KEY, "1");
    expect(noteVisit(local, session)).toBe(true);
    expect(noteVisit(local, session)).toBe(true);
  });
  it("blocked or missing storage counts as a first visit", () => {
    expect(noteVisit(blocked, blocked)).toBe(false);
    expect(noteVisit(null, null)).toBe(false);
  });
});

describe("followsTeams", () => {
  const none = { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] };
  it("nothing set: no", () => expect(followsTeams(none)).toBe(false));
  it("My team, a tracked team or event, or a shortlist: yes", () => {
    expect(followsTeams({ ...none, myTeam: 4215 })).toBe(true);
    expect(followsTeams({ ...none, tracked: { teams: [18360], events: [] } })).toBe(true);
    expect(followsTeams({ ...none, tracked: { teams: [], events: ["2025:USNJCMP"] } })).toBe(true);
    expect(followsTeams({ ...none, bookmarks: [14380] })).toBe(true);
  });
});

describe("constrained", () => {
  it("Save-Data or slow-2g/2g/3g", () => {
    expect(constrained({ saveData: true, effectiveType: "4g" })).toBe(true);
    for (const t of ["slow-2g", "2g", "3g"]) expect(constrained({ effectiveType: t })).toBe(true);
  });
  it("4g, or no Network Information API (Safari, Firefox): not constrained", () => {
    expect(constrained({ saveData: false, effectiveType: "4g" })).toBe(false);
    expect(constrained(undefined)).toBe(false);
    expect(constrained({})).toBe(false);
  });
});

describe("shouldSyncLite", () => {
  const base: SyncSignals = { online: true, returning: false, follows: false, hasPack: false, connection: { effectiveType: "4g" } };
  it("a first visit with nothing set never downloads the pack", () => expect(shouldSyncLite(base)).toBe(false));
  it("a returning visitor, someone following teams, or a device with a pack to update: yes", () => {
    expect(shouldSyncLite({ ...base, returning: true })).toBe(true);
    expect(shouldSyncLite({ ...base, follows: true })).toBe(true);
    expect(shouldSyncLite({ ...base, hasPack: true })).toBe(true);
  });
  it("never on Save-Data or a slow connection, even for a returning visitor with a pack", () => {
    const keen = { ...base, returning: true, follows: true, hasPack: true };
    expect(shouldSyncLite({ ...keen, connection: { saveData: true } })).toBe(false);
    expect(shouldSyncLite({ ...keen, connection: { effectiveType: "3g" } })).toBe(false);
    expect(shouldSyncLite({ ...keen, connection: { effectiveType: "slow-2g" } })).toBe(false);
  });
  it("never offline", () => expect(shouldSyncLite({ ...base, returning: true, online: false })).toBe(false));
  it("no connection info at all: decided by the visit alone", () => {
    expect(shouldSyncLite({ ...base, connection: undefined, returning: true })).toBe(true);
    expect(shouldSyncLite({ ...base, connection: undefined })).toBe(false);
  });
});

describe("liteRecheckDue", () => {
  const t = Date.parse("2026-11-28T15:00:00Z");
  it("a tab open at a venue asks again every ten minutes, so a midday build is picked up without a reload", () => {
    expect(liteRecheckDue(t, t + LITE_RECHECK_MS - 1, true)).toBe(false);
    expect(liteRecheckDue(t, t + LITE_RECHECK_MS, true)).toBe(true);
    expect(liteRecheckDue(t, t + 3 * LITE_RECHECK_MS, true)).toBe(true);
  });
  it("a hidden tab asks nothing; it asks when it comes back (if the ten minutes are up)", () => {
    expect(liteRecheckDue(t, t + 60 * 60_000, false)).toBe(false);
    expect(liteRecheckDue(t, t + 60 * 60_000, true)).toBe(true);
  });
  it("the first check of a session is never held back by the rule", () => {
    expect(liteRecheckDue(0, t, true)).toBe(true);
  });
});
