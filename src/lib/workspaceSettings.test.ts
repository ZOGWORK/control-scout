// @vitest-environment jsdom
// Workspace settings on the device: a notice for a newer version than a request already in flight
// gets that version (a fresh request follows), and a copy on the device is never replaced by an older one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedWorkspaceSettings, fetchWorkspaceSettings, rememberWorkspaceSettings } from "./workspaceSettings";
import { ENTRY_POLICY, type WorkspaceSettings } from "../shared/workspaceSettings";

const at = (v: number): WorkspaceSettings => ({ workspaceId: "77", settingsVersion: v, defaults: { season: 2024, eventCode: `EV${v}` }, entryPolicy: ENTRY_POLICY, updatedAt: null, updatedBy: null });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("fetchWorkspaceSettings", () => {
  it("a request in flight that answers an older version than asked for is followed by a fresh one", async () => {
    const answers: ((v: number) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answers.push((v) => resolve(new Response(JSON.stringify({ settings: at(v) }), { status: 200 }))); }));
    vi.stubGlobal("fetch", fetchMock);
    const first = fetchWorkspaceSettings("77");
    const newer = fetchWorkspaceSettings("77", 2); // a notice for version 2 while version 1's request is out
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    answers[0](1);
    expect((await first).settingsVersion).toBe(1);
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1](2);
    expect((await newer).settingsVersion).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedWorkspaceSettings("77")?.defaults.eventCode).toBe("EV2");
  });

  it("an in-flight answer new enough is shared (one request)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ settings: at(3) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([fetchWorkspaceSettings("77"), fetchWorkspaceSettings("77", 3)]);
    expect([a.settingsVersion, b.settingsVersion]).toEqual([3, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the device's copy never goes back to an older version", () => {
    rememberWorkspaceSettings(at(5));
    rememberWorkspaceSettings(at(4));
    expect(cachedWorkspaceSettings("77")?.settingsVersion).toBe(5);
  });
});
