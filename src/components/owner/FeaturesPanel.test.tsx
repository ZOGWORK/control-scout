// @vitest-environment jsdom
// Owner console › Features: exactly the seven v1 toggles as cards (label, on/off, scope), the kill switches below,
// a global flip that asks first (saying what turns off and that nothing is deleted) and sends {confirm: true}, and
// a workspace's own setting that applies at once with a toast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FEATURE_FLAGS, FLAGS, FLAG_INFO, FLAG_META } from "../../shared/flags";
import type { OwnerFlags } from "../../shared/owner";

const DATA: OwnerFlags = {
  flags: FLAGS.map((name) => ({ name, enabled: name !== "coinFlips", updatedAt: null, updatedBy: null, ...FLAG_META[name] })),
  overrides: [{ workspaceId: "ws-b", flag: "workspaceScouting", enabled: false, updatedAt: "2026-10-28T00:00:00Z", updatedBy: "owner@example.com" }],
  workspaces: [{ id: "ws-a", name: "Alpha Robotics" }, { id: "ws-b", name: "Beta Bots" }],
};
const sent: { path: string; json: unknown }[] = [];
const toasts: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: DATA, error: undefined, loading: false, reload: () => {} }),
  prime: () => {},
  apiFetch: async (path: string, init: { json: unknown }) => { sent.push({ path, json: init.json }); return DATA; },
}));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), refreshFlags: async () => ({}) }));
vi.mock("../ui/sonner", () => ({ toast: { success: (m: string) => toasts.push(m), error: (m: string) => toasts.push(m) } }));
const { FeaturesPanel } = await import("./FeaturesPanel");

beforeEach(() => { sent.length = 0; toasts.length = 0; });
afterEach(cleanup);

describe("FeaturesPanel", () => {
  it("shows the seven v1 toggles as cards with their state and scope, then the kill switches", () => {
    const { container } = render(<FeaturesPanel />);
    const cards = [...container.querySelectorAll("li[data-flag]")].map((li) => li.getAttribute("data-flag"));
    expect(cards.slice(0, 7)).toEqual([...FEATURE_FLAGS]);
    expect(cards.slice(7)).toEqual(FLAGS.filter((f) => FLAG_META[f].group === "kill"));
    const coin = container.querySelector('li[data-flag="coinFlips"]') as HTMLElement;
    expect(within(coin).getByText("Coin flips")).toBeTruthy();
    expect(within(coin).getByText("Off")).toBeTruthy();
    expect(within(coin).getByText("Global")).toBeTruthy();
    const ws = container.querySelector('li[data-flag="workspaceScouting"]') as HTMLElement;
    expect(within(ws).getByText("Per workspace", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kill switches" })).toBeTruthy();
    expect(screen.getByText(/1 of 7 off right now/)).toBeTruthy();
  });

  it("a global flip asks first, says what turns off and that nothing is deleted, then sends confirm", async () => {
    render(<FeaturesPanel />);
    fireEvent.click(screen.getByRole("switch", { name: /Live predictions for everyone: on/ }));
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Turn live predictions off for everyone\?/)).toBeTruthy();
    expect(within(dialog).getByText(FLAG_INFO.livePredictions.off)).toBeTruthy();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Yes, turn it off/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/flags/livePredictions", json: { enabled: false, confirm: true } }]));
    await waitFor(() => expect(toasts[0]).toMatch(/Live predictions off everywhere/));
  });

  it("cancelling the dialog changes nothing", () => {
    render(<FeaturesPanel />);
    fireEvent.click(screen.getByRole("switch", { name: /Coin flips for everyone: off/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(sent).toEqual([]);
  });

  it("a workspace's own setting applies at once (no dialog), with a toast; Global clears it", async () => {
    const { container } = render(<FeaturesPanel />);
    const a = container.querySelector('li[data-workspace="ws-a"]') as HTMLElement;
    expect(within(a).getByText(/On \(follows global\)/)).toBeTruthy();
    fireEvent.click(within(a).getByRole("radio", { name: "Off" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/flags/workspaceScouting/workspaces/ws-a", json: { enabled: false } }]));
    await waitFor(() => expect(toasts[0]).toMatch(/Workspace scouting off for Alpha Robotics/));
    const b = container.querySelector('li[data-workspace="ws-b"]') as HTMLElement;
    expect(within(b).getByText(/Off \(its own setting\)/)).toBeTruthy();
    fireEvent.click(within(b).getByRole("radio", { name: "Global" }));
    await waitFor(() => expect(sent[1]).toEqual({ path: "/api/owner/flags/workspaceScouting/workspaces/ws-b", json: { enabled: null } }));
  });

  it("searches the workspaces", () => {
    const { container } = render(<FeaturesPanel />);
    fireEvent.change(screen.getByPlaceholderText("Search workspaces"), { target: { value: "beta" } });
    expect([...container.querySelectorAll("li[data-workspace]")].map((li) => li.getAttribute("data-workspace"))).toEqual(["ws-b"]);
    fireEvent.change(screen.getByPlaceholderText("Search workspaces"), { target: { value: "zzz" } });
    expect(screen.getByText(/No workspace matches/)).toBeTruthy();
  });
});
