// sharedFlags reads one snapshot: a flag write landing while it reads (an override added just after "none") leaves
// nothing to share, so a page drawn then never carries flags some workspace no longer gets.
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: 0, during: null as null | (() => void) }));
vi.mock("./flags.js", () => ({
  flagWrites: () => state.writes,
  hasWorkspaceOverrides: async () => false,
  allFlags: async () => { state.during?.(); return { photos: false, push: false } as never; },
}));
vi.mock("./push/push.js", () => ({ vapidReady: () => false }));
vi.mock("./scout/r2.js", () => ({ r2: () => null }));
const { sharedFlags } = await import("./publicFlags");

describe("sharedFlags", () => {
  it("shares the flags when nothing was written while they were read", async () => {
    expect(await sharedFlags()).not.toBeNull();
  });
  it("shares none when a write landed while they were read", async () => {
    state.during = () => { state.writes++; };
    expect(await sharedFlags()).toBeNull();
  });
});
