// @vitest-environment jsdom
// The trigger: when the connection check finds internet again, a download the person started and a dropped
// connection paused picks up by itself, without waiting for a tap on Resume. Connection events are faked.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn() }));
vi.mock("../../components/ui/sonner", () => ({ toast }));
const settings = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("../personal", () => ({ usePersonal: () => ({ state: { settings: settings.current }, user: null, providers: {}, syncReady: false }) }));
vi.mock("../flags", () => ({ useFlag: () => true }));

// The connection check, faked: tests flip `internet` and fire the listeners the watcher registered.
const conn = vi.hoisted(() => ({
  internet: "no" as string,
  change: new Set<(now: string, before: string) => void>(),
  confirmed: new Set<() => void>(),
}));
vi.mock("../connection", () => ({
  connection: () => ({ internet: conn.internet }),
  onInternetChange: (f: (now: string, before: string) => void) => { conn.change.add(f); return () => conn.change.delete(f); },
  onInternetConfirmed: (f: () => void) => { conn.confirmed.add(f); return () => conn.confirmed.delete(f); },
}));
const resumePaused = vi.hoisted(() => vi.fn(async (_allowed: () => boolean) => [{ key: "season:2026", saved: true }]));
const nextTryIn = vi.hoisted(() => vi.fn((): number | null => null));
vi.mock("./resume", async (orig) => ({ ...(await orig<typeof import("./resume")>()), resumePaused, nextTryIn }));

const { DownloadResumer } = await import("./resumeWatcher");
const { clearResume, wantResume } = await import("./resumeMarks");

/** navigator.connection, settable, with a change event. */
const netConn = Object.assign(new EventTarget(), { type: "wifi" as string | undefined });
Object.defineProperty(navigator, "connection", { configurable: true, get: () => netConn });

async function back(online = "yes") {
  const before = conn.internet;
  conn.internet = online;
  await act(async () => {
    for (const f of [...conn.change]) f(online, before);
    if (online === "yes") for (const f of [...conn.confirmed]) f();
    await new Promise((r) => setTimeout(r, 150));
  });
}

beforeEach(() => { localStorage.clear(); conn.internet = "no"; netConn.type = "wifi"; settings.current = {}; });
afterEach(() => { resumePaused.mockClear(); toast.success.mockClear(); conn.change.clear(); conn.confirmed.clear(); });

describe("DownloadResumer", () => {
  it("picks up a paused download the moment the check finds internet again, and says it's saved", async () => {
    wantResume("season", "2026");
    render(<DownloadResumer />);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(resumePaused).not.toHaveBeenCalled(); // still no internet
    await back("yes");
    await vi.waitFor(() => expect(resumePaused).toHaveBeenCalled(), { timeout: 5000 });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("2026–27 season saved on this device", expect.anything()));
  });

  it("a check that finds no internet, or a sign-in page, doesn't try", async () => {
    wantResume("season", "2026");
    render(<DownloadResumer />);
    await back("portal");
    await back("no");
    expect(resumePaused).not.toHaveBeenCalled();
  });

  it("nothing the person started (or they deleted it): nothing happens", async () => {
    wantResume("season", "2026");
    clearResume("season:2026");
    render(<DownloadResumer />);
    await back("yes");
    expect(resumePaused).not.toHaveBeenCalled();
  });

  it("Wi-Fi only on mobile data waits; moving onto Wi-Fi picks it up", async () => {
    settings.current = { offlineNetwork: "wifi" };
    netConn.type = "cellular";
    wantResume("season", "2026");
    render(<DownloadResumer />);
    await back("yes");
    expect(resumePaused).not.toHaveBeenCalled();
    netConn.type = "wifi";
    await act(async () => { netConn.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 150)); });
    await vi.waitFor(() => expect(resumePaused).toHaveBeenCalledTimes(1), { timeout: 5000 });
    // What it asks before each download says yes on Wi-Fi, no if the phone moves back to mobile data.
    const allowed = resumePaused.mock.calls[0][0];
    expect(allowed()).toBe(true);
    netConn.type = "cellular";
    expect(allowed()).toBe(false);
  });

  it("one tried moments ago (paused again) is tried again once the gap is over, with no new check", async () => {
    wantResume("season", "2026");
    resumePaused.mockResolvedValueOnce([{ key: "season:2026", saved: false }]);
    nextTryIn.mockReturnValueOnce(200);
    conn.internet = "yes";
    render(<DownloadResumer />);
    await vi.waitFor(() => expect(resumePaused).toHaveBeenCalledTimes(1), { timeout: 5000 });
    // No check fires again (with internet they're minutes apart): the gap's own timer tries it.
    await vi.waitFor(() => expect(resumePaused).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("2026–27 season saved on this device", expect.anything()));
  });

  it("Wi-Fi and mobile data: picks up on mobile data too", async () => {
    settings.current = { offlineNetwork: "any" };
    netConn.type = "cellular";
    wantResume("season", "2026");
    render(<DownloadResumer />);
    await back("yes");
    await vi.waitFor(() => expect(resumePaused).toHaveBeenCalled(), { timeout: 5000 });
  });
});
