// @vitest-environment jsdom
// Task 6, the three tiers on the device (docs/settings.md):
// - Tier 1: an existing cs-personal:settings blob keeps working byte for byte (read as is, never
//   rewritten on load, and synced exactly as stored).
// - Tier 3: device-only keys (active space, list/grid view, the dirty queue) never appear in any
//   sync payload; the queue's entries go up as entries, the queue itself never does.
// - Precedence: a workspace can't change theme, density, ambient or notifications.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PersonalProvider, usePersonal } from "./personal";
import { saveScoutEntry, syncScouting } from "./scouting";
import { rememberSpace } from "./scoutSpace";
import { saveView } from "./shortlist";
import { cleanValue, DEFAULT_SETTINGS, type Settings } from "../shared/personal";
import { endTour } from "./tour";
import { cleanSettingsPatch, DEVICE_ONLY_KEYS, ENTRY_POLICY, scoutSpaceSettings, type WorkspaceSettings } from "../shared/workspaceSettings";
import { newEntryEventCode } from "./workspaceSettings";

/** A settings blob exactly as an older build wrote it (every field set, so nothing to fill in). */
const RAW = '{"value":{"theme":"light","density":"compact","ambient":false,"notify":{"myTeamMatches":false,"trackedTeams":true,"upsets":true,"eventStart":false}},"updatedAt":1750000000000}';
const USER = { id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "" };

type Sent = { url: string; method: string; body: string };
/** A server: /api/auth/me answers `user`; personal state and scout pushes are accepted as sent. */
function server(user: typeof USER | null) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url: String(url), method: init?.method ?? "GET", body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
    const path = new URL(String(url), "http://x").pathname;
    if (path === "/api/auth/me") return json({ user, providers: { email: true, google: false } });
    if (path === "/api/me/migrate") return json({ state: JSON.parse(body).state });
    if (path === "/api/me/state") return json({ state: {} });
    if (path.startsWith("/api/me/state/")) return json({ stored: JSON.parse(body) });
    if (path === "/api/me/scout/sync") return json({ results: JSON.parse(body).entries.map((e: { uuid: string }) => ({ uuid: e.uuid, ok: true })) });
    if (path === "/api/me/scout") return json({ entries: [] });
    return new Response(JSON.stringify({ error: "not in this test" }), { status: 404 });
  }));
  return sent;
}

let seen: Settings | null = null;
function Probe() { seen = usePersonal().state.settings; return null; }
const mount = async () => { render(<PersonalProvider><Probe /></PersonalProvider>); await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

beforeEach(() => { localStorage.clear(); seen = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Tier 1: cs-personal:settings stays byte-compatible", () => {
  it("an existing blob is read as is and never rewritten on load (signed out)", async () => {
    server(null);
    localStorage.setItem("cs-personal:settings", RAW);
    await mount();
    expect(localStorage.getItem("cs-personal:settings")).toBe(RAW);
    expect(seen).toEqual(JSON.parse(RAW).value);
  });

  it("validation round-trips it unchanged, and a sign-in syncs exactly those bytes", async () => {
    const parsed = JSON.parse(RAW);
    expect(JSON.stringify({ value: cleanValue("settings", parsed.value), updatedAt: parsed.updatedAt })).toBe(RAW);
    localStorage.setItem("cs-personal:settings", RAW);
    localStorage.setItem("cs-personal-owner", "1"); // this account's own copy: a pull, then the newer local value goes up
    const sent = server(USER);
    await mount();
    await vi.waitFor(() => expect(sent.some((s) => s.url.endsWith("/api/me/state/settings"))).toBe(true));
    expect(sent.find((s) => s.url.endsWith("/api/me/state/settings"))!.body).toBe(RAW);
    expect(localStorage.getItem("cs-personal:settings")).toBe(RAW);
  });
});

describe("Tier 3: device-only state never leaves the device", () => {
  it("no personal sync, migration or scout push carries the active space, the view or the queue", async () => {
    // Anonymous data on the device (so sign-in migrates it), plus every Tier 3 key.
    localStorage.setItem("cs-personal:settings", RAW);
    localStorage.setItem("cs-personal-owner", "");
    rememberSpace("77", "Secret Space", 1);
    saveView("grid");
    endTour("done", 4);
    saveScoutEntry({ uuid: "pppppppppppp", season: 2025, team: 18360, eventCode: null, matchLabel: "Q1", kind: "match", data: {}, notes: "" });
    saveScoutEntry({ uuid: "wwwwwwwwwwww", season: 2025, team: 18360, eventCode: null, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: "77" });
    const sent = server(USER);
    await mount();
    await vi.waitFor(() => expect(sent.some((s) => s.url.endsWith("/api/me/migrate"))).toBe(true));
    await act(async () => { await syncScouting(null); await syncScouting("77"); });
    // Everything that went up: the queue's entries did (that's its job)…
    const all = sent.map((s) => `${s.url} ${s.body}`).join("\n");
    expect(all).toContain("pppppppppppp");
    expect(all).toContain("wwwwwwwwwwww");
    // …but never a Tier 3 key or its value.
    for (const k of DEVICE_ONLY_KEYS) expect(all).not.toContain(k);
    expect(all).not.toContain("Secret Space");
    expect(all).not.toMatch(/"(view|space)"\s*:/);
    expect(all).not.toContain('"grid"');
    expect(all).not.toContain('"outcome"');
    // The keys are still on the device.
    expect(localStorage.getItem("cs-scout-space")).toContain("Secret Space");
    expect(localStorage.getItem("cs-shortlist-view")).toBe("grid");
    expect(localStorage.getItem("cs-tour")).toContain('"done"');
  });
});

describe("precedence: a workspace never sets the person's view", () => {
  const ws = (extra: Record<string, unknown>): WorkspaceSettings => ({
    workspaceId: "77", settingsVersion: 3, defaults: { season: 2024, eventCode: "USNYQ1" }, entryPolicy: ENTRY_POLICY, updatedAt: null, updatedBy: null, ...extra,
  });

  it("inside a workspace's scout space the view is the personal one, the defaults the workspace's", () => {
    const mine: Settings = { ...DEFAULT_SETTINGS, theme: "light", density: "compact" };
    // Even a workspace object that somehow carries view settings changes nothing.
    const r = scoutSpaceSettings(mine, ws({ theme: "dark", density: "comfortable", notify: { upsets: true }, ambient: false }));
    expect(r.view).toBe(mine);
    expect(r.defaults).toEqual({ season: 2024, eventCode: "USNYQ1" });
    expect(scoutSpaceSettings(mine, null)).toEqual({ view: mine, defaults: { season: null, eventCode: null } });
  });

  it("a workspace write can't carry theme, density, ambient or notifications", () => {
    const { defaults, dropped } = cleanSettingsPatch({ theme: "light", density: "compact", ambient: false, notify: {}, defaults: { season: 2025 } });
    expect(defaults).toEqual({ season: 2025 });
    expect(dropped.map((d) => d.field).sort()).toEqual(["ambient", "density", "notify", "theme"]);
  });

  it("the default event applies in a workspace for its season; Personal never gets one", () => {
    const d = { season: 2024, eventCode: "USNYQ1" };
    expect(newEntryEventCode("77", d, 2024)).toBe("USNYQ1");
    expect(newEntryEventCode("77", d, 2025)).toBe("");
    expect(newEntryEventCode("77", { season: null, eventCode: "USNYQ1" }, 2025)).toBe("USNYQ1");
    expect(newEntryEventCode(null, d, 2024)).toBe("");
  });
});
