// @vitest-environment jsdom
// Owner Storage on a phone: Run cleanup now sits below the Photo storage copy (not beside it, squeezing it), the
// per-event table's action column is named, and both destructive actions still ask before doing anything.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { OwnerStorage } from "../../shared/photos";

const STORAGE: OwnerStorage = {
  configured: true, enabled: true, usedBytes: 2000, photos: 1, limitBytes: 10e9, noticeBytes: 7e9, warningBytes: 9e9, softCapBytes: 9.5e9, level: "ok",
  events: [{ season: 2025, eventCode: "TESTQ1", eventName: "Local test qualifier", eventEnd: "2026-10-18", photos: 1, bytes: 2000, expiresAt: null }],
  lastRun: null, alert: null,
};
const fetched = vi.fn();
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: STORAGE, error: undefined, loading: false, reload: () => {} }),
  apiFetch: (...a: unknown[]) => { fetched(...a); return new Promise(() => {}); },
}));
const { StoragePanel } = await import("./StoragePanel");

afterEach(cleanup);

describe("StoragePanel", () => {
  it("stacks Run cleanup now below the Photo storage copy on phones", () => {
    render(<StoragePanel />);
    const heading = screen.getByRole("heading", { name: "Photo storage" });
    const header = heading.parentElement!.parentElement!;
    expect(header.className).toMatch(/max-sm:flex-col/);
    expect(header.className).toMatch(/max-sm:items-start/);
    const cta = within(header).getByRole("button", { name: /Run cleanup now/ });
    expect(heading.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the per-event action column", () => {
    render(<StoragePanel />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Event", "Photos", "Size", "Event ends", "Deleted from", "Actions"]);
  });

  it("asks before running the cleanup or purging an event", () => {
    render(<StoragePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run cleanup now/ }));
    expect(screen.getByRole("dialog", { name: "Run the photo cleanup now?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Purge/ }));
    expect(screen.getByRole("dialog", { name: "Purge TESTQ1 (2025)?" })).toBeTruthy();
    expect(fetched).not.toHaveBeenCalled();
  });
});
