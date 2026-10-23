// @vitest-environment jsdom
// The saved-season update prompt asks when the server lists a newer release, even while navigator.onLine says
// offline: iOS can say so while online, and the prompt only ever runs on a pack list the server just gave.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const toast = vi.hoisted(() => vi.fn());
const UPDATE = { season: 2025, sha256: "new" };
vi.mock("../../components/ui/sonner", () => ({ toast }));
vi.mock("../personal", () => ({ usePersonal: () => ({ state: { settings: {} } }) }));
vi.mock("../flags", () => ({ useFlag: () => true }));
vi.mock("./saved", () => ({ useSavedSeasons: () => [{ season: 2025 }] }));
vi.mock("../packs", () => ({ fetchManifest: vi.fn(async () => ({ version: "2026-10-23.9", seasons: [] })) }));
vi.mock("./updatePolicy", async (orig) => ({ ...(await orig<typeof import("./updatePolicy")>()), updateQuestion: () => "Offline data for 2025–26 has an update." }));
vi.mock("./updateStore", () => ({
  applyUpdate: vi.fn(), setUpdate: vi.fn(), markLater: vi.fn(), markShown: vi.fn(), updateNow: vi.fn(),
  updateSnapshot: () => ({ updates: [UPDATE], rows: [] }), laterReleases: () => [], shownReleases: () => [],
  asked: () => ({ updates: [UPDATE] }),
}));

const { SeasonUpdateWatcher } = await import("./updateWatcher");

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); toast.mockClear(); });

describe("SeasonUpdateWatcher", () => {
  it("asks about a newer release even when the browser says it's offline", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<MemoryRouter initialEntries={["/"]}><SeasonUpdateWatcher /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/has an update\. Update now\?/), expect.objectContaining({ id: "season-update" }));
  });
});
