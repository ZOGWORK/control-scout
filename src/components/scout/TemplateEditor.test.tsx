// @vitest-environment jsdom
// The admin's template editor: add a field (type picker), edit it, reorder, remove, preview, and save
// (the PUT carries both kinds, with an untouched built-in kind sent as null and the version edited).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const toasts = vi.hoisted(() => ({ last: null as { action?: { onClick: () => void } } | null }));
vi.mock("../ui/sonner", () => {
  const toast = Object.assign((_m: string, o?: { action?: { onClick: () => void } }) => { toasts.last = o ?? null; }, {});
  return { toast: Object.assign(toast, { success: toast, error: toast, warning: toast }) };
});
import { TooltipProvider } from "../ui/overlay";
import { TemplateEditor } from "./TemplateEditor";
import { templateFor } from "../../lib/scouting";
import type { WorkspaceTemplate } from "../../shared/scoutTemplate";

const sent: any[] = [];
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    const template: WorkspaceTemplate = { workspaceId: "901", season: 2025, version: 1, settingsVersion: 1, match: body.match, pit: body.pit, updatedAt: null, updatedBy: "Coach" };
    return new Response(JSON.stringify({ changed: true, template, dropped: [] }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (template: WorkspaceTemplate | null = null) => render(<TooltipProvider><TemplateEditor workspaceId="901" workspaceName="Gearheads" season={2025} template={template} onClose={() => {}} /></TooltipProvider>);

describe("TemplateEditor", () => {
  it("starts from the built-in fields; Save is off until something changes", () => {
    show();
    expect(screen.getByText("Artifacts classified (TeleOp)")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save template/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds a counter to Endgame, edits it, and saves: match goes as a list, the untouched pit kind as null", async () => {
    show();
    const endgame = screen.getByRole("group", { name: "Endgame" });
    fireEvent.click(within(endgame).getByRole("button", { name: /Add field/ }));
    fireEvent.click(within(endgame).getByRole("button", { name: "Counter" }));
    const label = screen.getByLabelText("Label");
    fireEvent.change(label, { target: { value: "Hang attempts" } });
    fireEvent.change(screen.getByLabelText("Highest"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Save template/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].season).toBe(2025);
    expect(sent[0].baseVersion).toBe(0);
    expect(sent[0].pit).toBeNull();
    const added = sent[0].match.find((f: any) => f.label === "Hang attempts");
    expect(added).toMatchObject({ type: "counter", phase: "endgame", max: 5 });
    expect(sent[0].match).toHaveLength(templateFor(2025, "match").fields.length + 1);
  });

  it("reorders within a phase and removes a field", async () => {
    show();
    const auto = screen.getByRole("group", { name: "Auto" });
    const names = () => within(auto).getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent);
    const before = names();
    fireEvent.click(within(auto).getByRole("button", { name: `Move ${before[1]} up` }));
    expect(names()).toEqual([before[1], before[0], ...before.slice(2)]);
    fireEvent.click(within(auto).getByRole("button", { name: `Remove ${before[2]}` }));
    expect(names()).toEqual([before[1], before[0]]);
    fireEvent.click(screen.getByRole("button", { name: /Save template/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].match.filter((f: any) => f.phase === "auto").map((f: any) => f.label)).toEqual([before[1], before[0]]);
  });

  it("undoing a removal puts the field back where it was", async () => {
    show();
    const auto = screen.getByRole("group", { name: "Auto" });
    const names = () => within(auto).getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent);
    const before = names();
    fireEvent.click(within(auto).getByRole("button", { name: `Remove ${before[0]}` }));
    expect(names()).toEqual(before.slice(1));
    act(() => toasts.last!.action!.onClick());
    expect(names()).toEqual(before);
    expect((screen.getByRole("button", { name: /Save template/ }) as HTMLButtonElement).disabled).toBe(true); // nothing changed after all
  });

  it("the preview shows the options as they'll be saved (repeats merged)", () => {
    const fields = [{ id: "park", label: "Park", type: "choice" as const, phase: "endgame" as const, options: ["A", "a", "B"] }];
    show({ workspaceId: "901", season: 2025, version: 1, settingsVersion: 1, match: fields, pit: null, updatedAt: null, updatedBy: null });
    fireEvent.click(screen.getByRole("radio", { name: /Preview/ }));
    const group = screen.getByText("Park").parentElement!;
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["A", "B"]);
  });

  it("a field that can't be saved blocks Save and says why", () => {
    show();
    const overall = screen.getByRole("group", { name: "Overall" });
    fireEvent.click(within(overall).getByRole("button", { name: /Add field/ }));
    fireEvent.click(within(overall).getByRole("button", { name: "Text" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "" } });
    expect(screen.getByText(/Can't be saved: no label/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save template/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preview shows the form members will see", () => {
    const fields = [{ id: "climb", label: "Climbed the bar", type: "toggle" as const, phase: "endgame" as const }];
    show({ workspaceId: "901", season: 2025, version: 3, settingsVersion: 3, match: fields, pit: null, updatedAt: null, updatedBy: "Coach" });
    fireEvent.click(screen.getByRole("radio", { name: /Preview/ }));
    expect(screen.getByRole("switch", { name: "Climbed the bar" })).toBeTruthy();
    expect(screen.getByText(/Version 3 · saved by Coach/)).toBeTruthy();
  });
});
