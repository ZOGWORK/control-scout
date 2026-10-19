// @vitest-environment jsdom
// Settings › Scouting › Import (audit E3): choosing a file opens a preview and writes nothing; the preview is a
// named dialog with the counts, the reasons tied to rows and what Import will do; Cancel (or Esc) leaves the
// device as it was and hands focus back to the Import button; a backup is offered before anything is replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../shared/personal";
import { TooltipProvider } from "../components/ui/overlay";
import { localScoutEntries, saveScoutEntry } from "../lib/scouting";

const h = vi.hoisted(() => ({ personal: {} as Record<string, unknown> }));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));

const { default: SettingsPage } = await import("./SettingsPage");

const good = (uuid: string, over: Record<string, unknown> = {}) => ({ uuid, team: 101, season: 2025, kind: "match", eventCode: "AUDIT1", matchLabel: "Q1", data: { auto: 3 }, notes: "fast", ...over });
const snapshot = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 })));
  localStorage.clear();
  h.personal = { user: null, providers: { email: true, google: false }, sync: "local", state: { ...EMPTY_STATE, settings: DEFAULT_SETTINGS }, update: vi.fn(), set: vi.fn(), refreshUser: vi.fn(async () => {}) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function show() {
  render(<TooltipProvider><MemoryRouter initialEntries={["/settings?section=scouting"]}><SettingsPage /></MemoryRouter></TooltipProvider>);
  const button = screen.getByRole("button", { name: "Import JSON" });
  const input = document.querySelector<HTMLInputElement>("input[data-scout-import]")!;
  return {
    button,
    /** Pick a file the way a scout does: the button has focus, then the file arrives. */
    choose: async (body: unknown, name = "scouting.json") => {
      button.focus();
      fireEvent.change(input, { target: { files: [new File([JSON.stringify(body)], name, { type: "application/json" })] } });
      return screen.findByRole("dialog", { name: "Review this import" });
    },
  };
}

describe("Settings: import preview", () => {
  it("shows counts and reasons tied to rows; Cancel writes nothing and returns focus to Import", async () => {
    saveScoutEntry({ ...good("here00000001"), kind: "match", workspaceId: null });
    const before = snapshot();
    const { button, choose } = show();
    const dialog = await choose({ format: "control-scout-scouting", version: 1, entries: [
      good("new000000001"), good("new000000002", { matchLabel: "Q2" }),
      good("badnotes0001", { notes: { invalid: "object" }, matchLabel: "Q3" }),
    ] }, "club.json");
    expect(snapshot()).toBe(before); // choosing a file writes nothing
    expect(within(dialog).getByText("club.json")).toBeTruthy();
    expect(within(dialog).getByText(/Nothing on this device has changed yet/)).toBeTruthy();
    const valid = within(dialog).getByText("Valid").closest("div")!;
    expect(valid.textContent).toContain("2");
    expect(within(dialog).getByText("Invalid").closest("div")!.textContent).toContain("1");
    expect(within(dialog).getByText("Row 3 · team 101 · Q3")).toBeTruthy();
    expect(within(dialog).getByText("notes not text")).toBeTruthy();
    const plan = within(dialog).getByRole("region", { name: "What Import will do" });
    expect(plan.textContent).toContain("Add 2 new entries");
    expect(plan.textContent).toContain("Update 0");
    expect(plan.textContent).toContain("Skip 1 (1 invalid)");
    expect(plan.textContent).toContain("Your 1 other entry on this device isn't in the file and stays as it is.");
    expect(within(dialog).queryByRole("button", { name: /Download a backup first/ })).toBeNull(); // nothing would be replaced

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(snapshot()).toBe(before);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("Esc cancels too, and the dialog traps focus inside while open", async () => {
    const before = snapshot();
    const { button, choose } = show();
    const dialog = await choose([good("esc000000001")]);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(snapshot()).toBe(before);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("duplicates: newer or older than the copy here; a backup is offered before replacing; Import applies the plan", async () => {
    const t = Date.now();
    saveScoutEntry({ ...good("dupnewer0001"), kind: "match", workspaceId: null });
    saveScoutEntry({ ...good("dupolder0001"), kind: "match", workspaceId: null });
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { choose } = show();
    const dialog = await choose([
      good("dupnewer0001", { notes: "theirs", updatedAt: t + 60_000 }),
      good("dupolder0001", { notes: "theirs", updatedAt: t - 60_000, matchLabel: "Q2" }),
      good("fresh0000001", { matchLabel: "Q3" }),
    ]);
    expect(within(dialog).getByText("file's copy is newer")).toBeTruthy();
    expect(within(dialog).getByText("file's copy is older")).toBeTruthy();
    expect(within(dialog).getByText("will update")).toBeTruthy();
    expect(within(dialog).getByText("kept as here")).toBeTruthy();
    expect(within(dialog).getByRole("radiogroup", { name: "Entries already on this device" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Download a backup first" }));
    expect(click).toHaveBeenCalledOnce();
    const backup = JSON.parse(await blobs[0].text());
    expect(backup.entries.map((e: { uuid: string; notes: string }) => [e.uuid, e.notes]).sort()).toEqual([["dupnewer0001", "fast"], ["dupolder0001", "fast"]]);
    expect(within(dialog).getByRole("button", { name: "Backup downloaded" })).toBeTruthy();

    // Taking the file's copy replaces both; the plan and the button follow the choice.
    fireEvent.click(within(dialog).getByRole("radio", { name: /Use the file's copy/ }));
    expect(within(dialog).getByRole("region", { name: "What Import will do" }).textContent).toContain("Update 2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Import 3 entries" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const notes = Object.fromEntries(localScoutEntries().map((e) => [e.uuid, e.notes]));
    expect(notes).toEqual({ dupnewer0001: "theirs", dupolder0001: "theirs", fresh0000001: "fast" });
  });

  it("many invalid rows: the first few show, the rest are behind a keyboard-operable disclosure", async () => {
    const { choose } = show();
    const dialog = await choose(Array.from({ length: 9 }, (_, i) => good(`bad${String(i).padStart(9, "0")}`, { team: "x", matchLabel: `Q${i + 1}` })));
    const list = within(dialog).getByRole("region", { name: /Invalid rows, left out/ });
    const more = within(list).getByText("Show 4 more").closest("summary")!;
    expect(more.closest("details")!.open).toBe(false);
    expect(within(list).getAllByRole("listitem")).toHaveLength(9); // in the DOM, collapsed
    expect(within(dialog).getByRole("button", { name: "Nothing to import" })).toHaveProperty("disabled", true);
  });

  it("an older bare-list export still opens and imports", async () => {
    const { choose } = show();
    const dialog = await choose([{ uuid: "oldformat001", team: 7, season: 2024, kind: "pit", eventCode: null, matchLabel: null, data: { drivetrain: "Tank" }, notes: "", updatedAt: 1_700_000_000_000 }]);
    expect(within(dialog).getByText("Add 1")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Import 1 entry" }));
    await waitFor(() => expect(localScoutEntries().map((e) => e.uuid)).toEqual(["oldformat001"]));
  });
});
