// @vitest-environment jsdom
// The share switch under a suspension: the notice says why, and an entry that's still shared can be unshared. The
// switch moves at once and goes back, saying it didn't save, when the server refuses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceCommons } from "../../shared/commons";
import type { ScoutEntry } from "../../lib/scouting";

const h = vi.hoisted(() => ({ calls: [] as unknown[][], commons: null as WorkspaceCommons | null, refuse: null as Error | null }));
const SUSPENDED: WorkspaceCommons = {
  workspaceId: "ws1", optedIn: true, updatedAt: null, updatedBy: null, suspended: { at: "2026-10-30T00:00:00Z", reason: "Spam" },
  shares: [
    { uuid: "e1", status: "published", publishedAt: 1, eventCode: "USCMQ1", team: 18360, removedReason: null, sharedIfRestored: null },
    { uuid: "e2", status: "removed", publishedAt: 1, eventCode: "USCMQ1", team: 18360, removedReason: "Not scouting", sharedIfRestored: true },
  ],
};
vi.mock("../../lib/commons", async (orig) => ({
  ...(await orig<typeof import("../../lib/commons")>()),
  useWorkspaceCommons: () => h.commons ?? SUSPENDED,
  setShare: async (...args: unknown[]) => { h.calls.push(args); if (h.refuse) throw h.refuse; return h.commons ?? SUSPENDED; },
}));
const { CommonsShare } = await import("./CommonsShare");
afterEach(() => { cleanup(); h.calls.length = 0; h.commons = null; h.refuse = null; });

describe("CommonsShare", () => {
  it("suspended: says why, and a shared entry can still be unshared", async () => {
    const e = { uuid: "e1", kind: "pit", workspaceId: "ws1", eventCode: "USCMQ1", team: 18360 } as unknown as ScoutEntry;
    render(<CommonsShare e={e} />);
    expect(screen.getByText(/suspended from the scouting commons/)).toBeTruthy();
    expect(screen.getByText(/\(Spam\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(h.calls).toEqual([["ws1", "e1", false]]));
  });

  it("taken down: says why, and the workspace can still withdraw it so a restore won't share it", async () => {
    h.commons = { ...SUSPENDED, suspended: null };
    const e = { uuid: "e2", kind: "pit", workspaceId: "ws1", eventCode: "USCMQ1", team: 18360 } as unknown as ScoutEntry;
    render(<CommonsShare e={e} />);
    expect(screen.getByText(/Taken down from the scouting commons/)).toBeTruthy();
    expect(screen.getByText(/\(Not scouting\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Share it again if it's restored/ }));
    // Off at once, with what that means, before the server answers.
    expect(screen.getByRole("switch", { name: /Share it again if it's restored/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/stays out of the commons even if it's restored/)).toBeTruthy();
    await waitFor(() => expect(h.calls).toEqual([["ws1", "e2", false]]));
  });

  it("moves the switch at once, and puts it back saying it didn't save when the server refuses", async () => {
    h.commons = { ...SUSPENDED, suspended: null, shares: [] };
    h.refuse = new Error("This event's commons is closed");
    const e = { uuid: "e3", kind: "pit", workspaceId: "ws1", eventCode: "USCMQ1", team: 18360 } as unknown as ScoutEntry;
    render(<CommonsShare e={e} />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"); // before any answer
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Didn't save: shared in the scouting commons. This event's commons is closed. It's back as it was."));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });
});
