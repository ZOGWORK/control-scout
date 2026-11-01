// @vitest-environment jsdom
// The saved-season update prompt asks when the server lists a newer release, even while navigator.onLine says
// offline: iOS can say so while online, and the prompt only ever runs on a pack list the server just gave.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const toast = vi.hoisted(() => vi.fn());
const UPDATE = { season: 2025, sha256: "new" };
vi.mock("../../components/ui/sonner", () => ({ toast }));
const settings = vi.hoisted(() => ({ current: {} as Record<string, string> }));
// Signed out with /api/auth/me answered, unless a test says otherwise.
const account = vi.hoisted(() => ({ current: { user: null as null | { id: string }, providers: {} as object | null, syncReady: false } }));
vi.mock("../personal", () => ({ usePersonal: () => ({ state: { settings: settings.current }, ...account.current }) }));
vi.mock("../flags", () => ({ useFlag: () => true }));
vi.mock("./saved", () => ({ useSavedSeasons: () => [{ season: 2025 }] }));
vi.mock("../packs", () => ({ fetchManifest: vi.fn(async () => ({ version: "2026-10-23.9", seasons: [] })) }));
vi.mock("./updatePolicy", async (orig) => ({ ...(await orig<typeof import("./updatePolicy")>()), updateQuestion: () => "Offline data for 2025–26 has an update." }));
vi.mock("./updateStore", () => ({
  applyUpdate: vi.fn(async () => null), setUpdate: vi.fn(), markLater: vi.fn(), markShown: vi.fn(), updateNow: vi.fn(),
  updateSnapshot: () => ({ updates: [UPDATE], rows: [{ season: 2025, file: { sha256: "new" } }] }), laterReleases: () => [], shownReleases: () => [],
  asked: () => ({ updates: [UPDATE] }),
}));

const { SeasonUpdateWatcher } = await import("./updateWatcher");
const { applyUpdate } = await import("./updateStore");

afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); toast.mockClear(); vi.mocked(applyUpdate).mockClear();
  settings.current = {}; account.current = { user: null, providers: {}, syncReady: false };
});

describe("SeasonUpdateWatcher", () => {
  it("by default never asks: the update downloads by itself", async () => {
    vi.useFakeTimers();
    render(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Update now\?/), expect.anything());
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("signed in, waits for the account's settings before downloading or asking", async () => {
    account.current = { user: { id: "u1" }, providers: {}, syncReady: false };
    vi.useFakeTimers();
    const view = render(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    // The account's settings arrive and say Ask me: a question, still no download.
    account.current = { user: { id: "u1" }, providers: {}, syncReady: true };
    settings.current = { offlineUpdates: "ask" };
    view.rerender(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Update now\?/), expect.anything());
  });

  it("before /api/auth/me answers, does nothing yet", async () => {
    account.current = { user: null, providers: null, syncReady: false };
    vi.useFakeTimers();
    render(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("with Ask me chosen, asks about a newer release even when the browser says it's offline", async () => {
    settings.current = { offlineUpdates: "ask" };
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/has an update\. Update now\?/), expect.objectContaining({ id: "season-update" }));
  });
});
