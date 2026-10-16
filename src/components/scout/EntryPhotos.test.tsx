// @vitest-environment jsdom
// The photo strip: nothing at all until the server says photos are on (R2 configured and the switch on),
// never on personal entries; thumbnails load lazily through the members-only route; expired photos say so.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resetFlags } from "../../lib/flags";
import { DEFAULT_FLAGS } from "../../shared/flags";
import type { ScoutEntry } from "../../lib/scouting";

vi.mock("../../lib/personal", () => ({
  usePersonal: () => ({ user: { id: 1, controlPoint: { accountId: 8, workspaces: [{ id: "w1", name: "Team", role: "member" }] } } }),
}));
const { EntryPhotos } = await import("./EntryPhotos");

afterEach(() => { cleanup(); resetFlags(); });

const photo = (id: string, over = {}) => ({ id, bytes: 100, addedByAccountId: 8, addedByName: "Ben", createdAt: Date.now(), expired: false, ...over });
const entry = (over: Partial<ScoutEntry> = {}): ScoutEntry => ({
  uuid: "pit000000001", workspaceId: "w1", season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: null, kind: "pit", data: {}, notes: "", updatedAt: 1,
  authorAccountId: 7, authorDisplayName: "Ada", photos: [photo("a"), photo("b")], photosRev: 2, ...over,
});

describe("EntryPhotos", () => {
  it("renders nothing before the server has answered, or when it says photos are off (R2 unset)", () => {
    const { container, rerender } = render(<EntryPhotos entry={entry()} editable />);
    expect(container.innerHTML).toBe(""); // flags not confirmed yet: hidden, not flashed in
    resetFlags({ ...DEFAULT_FLAGS, photos: false }, true);
    rerender(<EntryPhotos entry={entry()} editable />);
    expect(container.innerHTML).toBe("");
  });

  it("never shows on a personal entry", () => {
    resetFlags({ ...DEFAULT_FLAGS }, true);
    const { container } = render(<EntryPhotos entry={entry({ workspaceId: null })} editable />);
    expect(container.innerHTML).toBe("");
  });

  it("shows lazy thumbnails from the members-only route, opens a fullscreen viewer, and says when photos expired", () => {
    resetFlags({ ...DEFAULT_FLAGS }, true);
    const { container } = render(<EntryPhotos entry={entry({ photos: [photo("a"), photo("b"), photo("c", { expired: true })], photoExpired: true })} editable />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => [i.getAttribute("src"), i.getAttribute("loading")])).toEqual([["/api/scout/photos/a?workspaceId=w1", "lazy"], ["/api/scout/photos/b?workspaceId=w1", "lazy"]]);
    expect(screen.getByText(/Photo expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add photo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open photo 2 of 2/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/2 \/ 2/)).toBeTruthy();
    // Ben (account 8) added it: he may remove it.
    expect(screen.getByRole("button", { name: /Remove photo/ })).toBeTruthy();
  });

  it("no Remove for a member on someone else's photo on someone else's entry", () => {
    resetFlags({ ...DEFAULT_FLAGS }, true);
    render(<EntryPhotos entry={entry({ photos: [photo("a", { addedByAccountId: 7 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Open photo 1 of 1/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove photo/ })).toBeNull();
  });

  it("a list view with no photos shows nothing; an unsynced entry in the form asks to sync first", () => {
    resetFlags({ ...DEFAULT_FLAGS }, true);
    const { container } = render(<EntryPhotos entry={entry({ photos: [] })} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    render(<EntryPhotos entry={entry({ photos: [], authorAccountId: 0 })} editable />);
    expect(screen.getByText(/sync this entry, then add photos/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add photo/ })).toBeNull();
  });
});
