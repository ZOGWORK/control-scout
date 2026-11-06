// @vitest-environment jsdom
// The device's template cache: a version fetched for an old entry never replaces the current
// template (offline forms would use old fields), and templates travel with an account's stash.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { cachedWorkspaceTemplate, fetchWorkspaceTemplate, rememberWorkspaceTemplate, useWorkspaceTemplate } from "./scoutTemplates";
import { clearLocalScouting, exportLocalScouting, importLocalScouting } from "./scouting";
import type { WorkspaceTemplate } from "../shared/scoutTemplate";

const tpl = (version: number, settingsVersion: number, label: string): WorkspaceTemplate => ({
  workspaceId: "901", season: 2025, version, settingsVersion, match: [{ id: "a", label, type: "toggle", phase: "auto" }], pit: null, updatedAt: null, updatedBy: null,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("template cache", () => {
  it("a historical version (which carries today's settings version) never replaces the current template", async () => {
    rememberWorkspaceTemplate(tpl(2, 5, "current"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ template: tpl(1, 5, "old") }), { status: 200 })));
    await fetchWorkspaceTemplate("901", 2025, 1);
    expect(cachedWorkspaceTemplate("901", 2025)!.version).toBe(2);
    expect(JSON.parse(localStorage.getItem("cs-scout-tplv:901:2025:1")!).match[0].label).toBe("old");
  });

  it("an older reply for the current template doesn't replace a newer one", () => {
    rememberWorkspaceTemplate(tpl(3, 6, "newer"));
    rememberWorkspaceTemplate(tpl(2, 5, "older"));
    expect(cachedWorkspaceTemplate("901", 2025)!.version).toBe(3);
  });

  it("templates go into an account's stash and come back with it", () => {
    rememberWorkspaceTemplate(tpl(2, 5, "current"));
    rememberWorkspaceTemplate(tpl(1, 5, "old"), false);
    const stash = JSON.parse(JSON.stringify(exportLocalScouting()));
    clearLocalScouting();
    expect(cachedWorkspaceTemplate("901", 2025)).toBeNull();
    importLocalScouting(stash);
    expect(cachedWorkspaceTemplate("901", 2025)!.version).toBe(2);
    expect(localStorage.getItem("cs-scout-tplv:901:2025:1")).toBeTruthy();
    importLocalScouting({ entries: [], dirty: [], templates: { "not-a-template": "x" } });
    expect(localStorage.getItem("not-a-template")).toBeNull();
  });
});

describe("waiting for a template", () => {
  it("the stop-waiting timer is cleared when the form goes, never firing after it", async () => {
    // A request still out when the form goes, settled at the end so no other test shares it.
    let settle = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { settle = () => resolve(new Response(JSON.stringify({ template: tpl(1, 1, "x") }), { status: 200 })); })));
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useWorkspaceTemplate("901", 2025));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    settle();
    await fetchWorkspaceTemplate("901", 2025);
    // Its in-flight entry goes on the turn after it settles.
    await new Promise((r) => setTimeout(r, 0));
  });
});
