// @vitest-environment jsdom
// Owner console › Moderation › Scouting commons: the report queue (grouped by entry, with each reason), a takedown that
// asks for a reason first and sends it, restoring a taken-down entry, and the events and workspaces lists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CommonsModeration, CommonsWorkspaceRow } from "../../shared/commons";

const MOD: CommonsModeration = {
  reports: [{
    entryId: "2:pitowls0001", source: { id: 2, name: "Robo Owls" }, season: 2025, eventCode: "USCMQ1", team: 18360,
    notes: "Two-stage lift", scoutedAt: Date.now() - 36e5, status: "published",
    data: { drivetrain: "Tank" }, fields: [{ id: "drivetrain", label: "Drivetrain", type: "choice", phase: "pit", options: ["Mecanum", "Tank"] }], photos: [{ id: "p1", createdAt: 1, expired: false }],
    reports: [{ id: 1, reason: "outdated", note: "New claw since", createdAt: new Date().toISOString() }, { id: 2, reason: "wrong", note: "", createdAt: new Date().toISOString() }],
  }],
  removed: [{ entryId: "3:old", source: { id: 3, name: "Gear Gang" }, season: 2025, eventCode: "USCMQ1", team: 101, removedAt: new Date().toISOString(), removedBy: "owner@example.com", reason: "Spam" }],
  removedMore: false,
};
const WS: CommonsWorkspaceRow[] = [{ source: { id: 2, name: "Robo Owls" }, optedIn: true, shared: 3, removed: 0, suspended: null }];
const sent: { path: string; json: unknown }[] = [];
const stale: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string) => ({
    data: path.endsWith("/reports") ? MOD : path.endsWith("/workspaces") ? { workspaces: WS } : { events: [{ season: 2025, code: "USCMQ1", name: "Commons Qualifier", start: "2025-11-08", end: "2025-11-08", enabled: true, updatedAt: "", updatedBy: "", shared: 3 }] },
    error: undefined, loading: false, reload: () => {},
  }),
  prime: () => {},
  markStale: (p: string) => { stale.push(p); },
  apiFetch: async (path: string, init: { json: unknown }) => { sent.push({ path, json: init.json }); return path.includes("/workspaces/") ? { workspaces: WS } : MOD; },
}));
vi.mock("../ui/sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { CommonsPanel } = await import("./CommonsPanel");

beforeEach(() => { sent.length = 0; stale.length = 0; });
afterEach(cleanup);
const show = () => render(<MemoryRouter><CommonsPanel /></MemoryRouter>);

describe("CommonsPanel", () => {
  it("lists a reported entry once with every reason, the open events and the workspaces", () => {
    show();
    const report = screen.getByTestId("commons-report");
    expect(within(report).getByText("Out of date: the robot changed")).toBeTruthy();
    expect(within(report).getByText("Wrong about this robot")).toBeTruthy();
    expect(within(report).getByText("“New claw since”")).toBeTruthy();
    expect(within(report).getByText("Tank")).toBeTruthy(); // what was reported: its answers and photos
    expect(within(report).getByRole("img").getAttribute("src")).toBe("/api/owner/commons/photos/p1");
    expect(screen.getByText("Commons Qualifier")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Commons open at USCMQ1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Suspend/ })).toBeTruthy();
  });

  it("taking an entry down asks for a reason first, then sends it", async () => {
    show();
    fireEvent.click(within(screen.getByTestId("commons-report")).getByRole("button", { name: /Take down/ }));
    expect(sent).toEqual([]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Not scouting" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Take down" }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/commons/entries/2%3Apitowls0001", json: { removed: true, reason: "Not scouting" } }]));
    await waitFor(() => expect(stale).toEqual(["/api/owner/commons/", "/api/owner/overview"])); // counts and badges read again
  });

  it("restores a taken-down entry and dismisses reports", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(false)); // one action at a time
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(sent.map((x) => x.path)).toEqual(["/api/owner/commons/entries/3%3Aold", "/api/owner/commons/entries/2%3Apitowls0001/dismiss"]));
  });
});
