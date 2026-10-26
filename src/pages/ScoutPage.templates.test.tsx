// @vitest-environment jsdom
// Workspace templates on the Scout page (Task 5): a member's new-entry form uses the workspace's
// template and records its id + version; Personal keeps the built-in defaults; an entry made with
// version 1 still renders its fields after the template moves to version 2; only admins get the
// Template editor, and a live template change reaches an open form.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { localScoutEntries, saveScoutEntry, templateFor } from "../lib/scouting";
import { announceTemplateChange, TEMPLATE_WAIT_MS } from "../lib/scoutTemplates";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";
import type { ScoutField, WorkspaceTemplate } from "../shared/scoutTemplate";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: false, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));
vi.mock("../components/TeamInput", async (orig) => ({ ...(await orig<typeof import("../components/TeamInput")>()), lookupTeamName: async () => "Test Team" }));

const { default: ScoutPage } = await import("./ScoutPage");

const WS = "901";
const user = (role: "admin" | "member"): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [{ id: WS, name: "Gearheads", role }] },
});

const v1Fields: ScoutField[] = [{ id: "cones", label: "Cones stacked", type: "counter", phase: "teleop", max: 30 }];
const v2Fields: ScoutField[] = [{ id: "climb", label: "Climbed the bar", type: "toggle", phase: "endgame" }];
const tpl = (version: number, match: ScoutField[] | null): WorkspaceTemplate => ({
  workspaceId: WS, season: 2025, version, settingsVersion: version, match, pit: null, updatedAt: null, updatedBy: "Coach",
});

/** The server: the current template, and every version by number. */
let current: WorkspaceTemplate;
let versions: Record<number, WorkspaceTemplate>;
const fetched: string[] = [];
function stubServer() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    const u = new URL(url, "http://x");
    if (u.pathname === `/api/scout/workspaces/${WS}/template`) {
      const v = u.searchParams.get("version");
      const t = v == null ? current : versions[Number(v)];
      return new Response(JSON.stringify(t ? { template: t } : { error: "No such template version." }), { status: t ? 200 : 404 });
    }
    return new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 });
  }));
}

/** A server whose template request hangs until the test answers it (other requests fail at once). */
const stall = (hold: (r: (res: Response) => void) => void) => vi.fn((url: string) => (url.includes("/template")
  ? new Promise<Response>((r) => hold(r))
  : Promise.resolve(new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 }))));

const show = (url = `/scout?season=2025&space=${WS}`) => render(<TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /></MemoryRouter></TooltipProvider>);
const listed = () => screen.queryAllByRole("listitem").map((li) => li.textContent ?? "");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  fetched.length = 0;
  current = tpl(1, v1Fields);
  versions = { 1: tpl(1, v1Fields) };
  h.personal = { user: user("member"), providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {} } };
  resetFlags({ ...DEFAULT_FLAGS });
  stubServer();
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

async function newEntry(team = "4444") {
  fireEvent.click(screen.getByRole("button", { name: /New entry/ }));
  fireEvent.change(screen.getByLabelText("Team"), { target: { value: team } });
}

describe("workspace templates on the Scout page", () => {
  it("a member's new-entry form uses the workspace template and the entry records its id and version", async () => {
    show();
    await newEntry();
    expect(await screen.findByText("Cones stacked")).toBeTruthy();
    expect(screen.queryByText("Artifacts classified (TeleOp)")).toBeNull(); // the built-in 2025 field
    fireEvent.click(screen.getByRole("button", { name: "Cones stacked plus one" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries(WS).some((e) => e.team === 4444)).toBe(true));
    const saved = localScoutEntries(WS).find((e) => e.team === 4444)!;
    expect(saved).toMatchObject({ templateId: `ws:${WS}:2025:match`, templateVersion: 1, data: { cones: 1 } });
  });

  it("Personal keeps the built-in defaults (and records nothing about templates)", async () => {
    show("/scout?season=2025&space=personal");
    await newEntry("5555");
    expect(screen.getByText("Artifacts classified (TeleOp)")).toBeTruthy();
    expect(screen.queryByText("Cones stacked")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries(null).some((e) => e.team === 5555)).toBe(true));
    const raw = Object.keys(localStorage).filter((k) => k.startsWith("cs-scout:")).map((k) => JSON.parse(localStorage.getItem(k)!));
    expect(raw.find((e) => e.team === 5555)).not.toHaveProperty("templateId");
    expect(fetched.some((u) => u.includes("/template"))).toBe(false);
  });

  it("a workspace that never customised uses the built-in defaults", async () => {
    current = tpl(0, null);
    show();
    await newEntry();
    await waitFor(() => expect(fetched.some((u) => u.includes("/template"))).toBe(true));
    expect(screen.getByText("Artifacts classified (TeleOp)")).toBeTruthy();
  });

  it("an entry made with version 1 still renders its fields after the template moves to version 2", async () => {
    saveScoutEntry({ uuid: "madewithv1aa", season: 2025, team: 2222, eventCode: null, matchLabel: "Q1", kind: "match", data: { cones: 7 }, notes: "", workspaceId: WS, templateId: `ws:${WS}:2025:match`, templateVersion: 1 });
    current = tpl(2, v2Fields);
    versions[2] = current;
    show();
    // The list shows the v1 field's label and value, fetched as version 1 (the current one is v2).
    await waitFor(() => expect(listed().join()).toContain("Cones stacked: 7"));
    expect(fetched.some((u) => u.includes("version=1"))).toBe(true);
    // And a new entry uses version 2.
    await newEntry();
    expect(await screen.findByText("Climbed the bar")).toBeTruthy();
    expect(screen.queryByText("Cones stacked")).toBeNull();
  });

  it("editing an old entry keeps the fields (and template) it was made with", async () => {
    saveScoutEntry({ uuid: "madewithv1bb", season: 2025, team: 2223, eventCode: null, matchLabel: "Q2", kind: "match", data: { cones: 3 }, notes: "", workspaceId: WS, templateId: `ws:${WS}:2025:match`, templateVersion: 1 });
    current = tpl(2, v2Fields);
    versions[2] = current;
    show(`/scout?season=2025&space=${WS}&entry=madewithv1bb`);
    expect(await screen.findByRole("button", { name: "Cones stacked plus one" })).toBeTruthy();
    expect(screen.queryByText("Climbed the bar")).toBeNull();
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "edited later" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries(WS).find((e) => e.uuid === "madewithv1bb")!.notes).toBe("edited later"));
    expect(localScoutEntries(WS).find((e) => e.uuid === "madewithv1bb")).toMatchObject({ templateId: `ws:${WS}:2025:match`, templateVersion: 1, data: { cones: 3 } });
  });

  it("a template change announced live (the stream's `template` event) reaches an open form", async () => {
    show();
    await newEntry();
    expect(await screen.findByText("Cones stacked")).toBeTruthy();
    current = tpl(2, v2Fields);
    act(() => announceTemplateChange({ space: WS, season: 2025, version: 2 }));
    expect(await screen.findByText("Climbed the bar")).toBeTruthy();
  });

  it("members don't get the Template editor; admins do", async () => {
    show(`/scout?season=2025&space=${WS}&tab=data`);
    expect(await screen.findByRole("button", { name: /Pick list/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Template/ })).toBeNull();
    cleanup();
    h.personal.user = user("admin");
    show(`/scout?season=2025&space=${WS}&tab=data`);
    fireEvent.click(await screen.findByRole("button", { name: /Template/ }));
    expect(await screen.findByRole("heading", { name: /Scout template/ })).toBeTruthy();
  });

  it("a member can't open the editor by URL", () => {
    show(`/scout?season=2025&space=${WS}&view=template`);
    expect(screen.queryByRole("heading", { name: /Scout template/ })).toBeNull();
  });

  it("an edit whose own template version can't be loaded keeps its answers and its template reference", async () => {
    saveScoutEntry({ uuid: "madewithv1cc", season: 2025, team: 2224, eventCode: null, matchLabel: "Q3", kind: "match", data: { cones: 4 }, notes: "", workspaceId: WS, templateId: `ws:${WS}:2025:match`, templateVersion: 1 });
    current = tpl(2, v2Fields);
    versions = {}; // version 1 can't be fetched (e.g. offline)
    show(`/scout?season=2025&space=${WS}&entry=madewithv1cc`);
    expect(await screen.findByText(/earlier version of the workspace's fields/)).toBeTruthy();
    expect(screen.queryByText("Climbed the bar")).toBeNull(); // no field edits against the stand-in
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "notes only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries(WS).find((e) => e.uuid === "madewithv1cc")!.notes).toBe("notes only"));
    expect(localScoutEntries(WS).find((e) => e.uuid === "madewithv1cc")).toMatchObject({ templateId: `ws:${WS}:2025:match`, templateVersion: 1, data: { cones: 4 } });
  });

  it("a workspace template never seen on this device: the new form waits for it (no saving built-in answers by accident)", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", stall((r) => { answer = r; }));
    show();
    await newEntry();
    expect(screen.getByRole("status", { name: /Loading the workspace's fields/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { answer(new Response(JSON.stringify({ template: current }), { status: 200 })); });
    expect(await screen.findByText("Cones stacked")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a stalled first template request doesn't block scouting: after a few seconds the built-in fields open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let answer: (r: Response) => void = () => {};
      vi.stubGlobal("fetch", stall((r) => { answer = r; }));
      show();
      await newEntry();
      expect(screen.getByRole("status", { name: /Loading the workspace's fields/ })).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(TEMPLATE_WAIT_MS + 10); });
      expect(await screen.findByText("Artifacts classified (TeleOp)")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
      // An answer given meanwhile keeps the questions it was given for, even when the template turns up late.
      fireEvent.click(screen.getByRole("button", { name: "Overflow artifacts plus one" }));
      await act(async () => { answer(new Response(JSON.stringify({ template: current }), { status: 200 })); });
      expect(screen.queryByText("Cones stacked")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(localScoutEntries(WS).find((e) => e.team === 4444)).toMatchObject({ templateId: "match-2025", templateVersion: 0, data: { overflow: 1 } }));
    } finally { vi.useRealTimers(); }
  });

  it("answers don't follow a new entry to another workspace: its questions and template are that workspace's", async () => {
    h.personal.user = { ...user("member"), controlPoint: { ...user("member").controlPoint!, workspaces: [{ id: WS, name: "Gearheads", role: "member" }, { id: "902", name: "Bolt Bots", role: "member" }] } };
    const bolt: WorkspaceTemplate = { ...tpl(4, v2Fields), workspaceId: "902" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const t = url.startsWith(`/api/scout/workspaces/${WS}/`) ? current : url.startsWith("/api/scout/workspaces/902/") ? bolt : null;
      return new Response(JSON.stringify(t ? { template: t } : { error: "x" }), { status: t ? 200 : 500 });
    }));
    show();
    await newEntry();
    fireEvent.click(await screen.findByRole("button", { name: "Cones stacked plus one" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bolt Bots/ }));
    expect(await screen.findByText("Climbed the bar")).toBeTruthy();
    expect(screen.queryByText("Cones stacked")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries("902").some((e) => e.team === 4444)).toBe(true));
    expect(localScoutEntries("902").find((e) => e.team === 4444)).toMatchObject({ templateId: "ws:902:2025:match", templateVersion: 4, data: {} });
    expect(localScoutEntries(WS).some((e) => e.team === 4444)).toBe(false);
  });

  it("opening a form checks for a newer template (a missed live notice doesn't leave old fields)", async () => {
    show();
    await waitFor(() => expect(fetched.filter((u) => u.includes("/template")).length).toBeGreaterThan(0));
    current = tpl(2, v2Fields); // changed meanwhile, no notice
    await newEntry();
    expect(await screen.findByText("Climbed the bar")).toBeTruthy();
  });

  it("an untouched counter with a lowest value saves that value", async () => {
    current = tpl(1, [{ id: "laps", label: "Laps", type: "counter", phase: "teleop", min: 2, max: 9 }]);
    show();
    await newEntry("6666");
    expect(await screen.findByText("Laps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries(WS).find((e) => e.team === 6666)?.data).toEqual({ laps: 2 }));
  });

  it("the built-in template is unchanged by all this (Personal's defaults)", () => {
    expect(templateFor(2025, "match")).toMatchObject({ id: "match-2025", version: 0 });
    expect(templateFor(2025, "pit")).toMatchObject({ id: "pit", version: 0 });
  });
});
