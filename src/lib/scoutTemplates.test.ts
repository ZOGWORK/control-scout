// @vitest-environment jsdom
// The device's template cache: a version fetched for an old entry never replaces the current
// template (offline forms would use old fields), and templates travel with an account's stash.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedWorkspaceTemplate, fetchWorkspaceTemplate, rememberWorkspaceTemplate } from "./scoutTemplates";
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
