// @vitest-environment jsdom
// Settings › Notifications › Push notifications: "Turn off" stays available whenever this browser holds a
// subscription, even while push is unavailable (switched off, or the server can't be reached), and the dormant
// states explain themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PushStatus } from "../../lib/push";

const push = vi.hoisted(() => ({
  status: "unavailable" as PushStatus,
  local: true,
  disablePush: vi.fn(async () => "off" as PushStatus),
  enablePush: vi.fn(async () => "on" as PushStatus),
}));
vi.mock("../../lib/push", () => ({
  readPushStatus: vi.fn(async () => push.status),
  hasLocalSubscription: vi.fn(async () => push.local),
  disablePush: push.disablePush,
  enablePush: push.enablePush,
}));

const { PushDevice } = await import("./PushDevice");

const show = async () => {
  render(<MemoryRouter><PushDevice signedIn onPermission={() => {}} /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => { push.status = "unavailable"; push.local = true; push.disablePush.mockClear(); push.enablePush.mockClear(); });
afterEach(() => cleanup());

describe("PushDevice", () => {
  it("keeps Turn off while push is unavailable but this browser is subscribed, and removes it", async () => {
    await show();
    expect(screen.getByText(/aren't available on this server right now/)).toBeTruthy();
    const off = screen.getByRole("button", { name: "Turn off" });
    // Once removed, the browser has no subscription left: the button goes.
    push.local = false;
    await act(async () => { fireEvent.click(off); await new Promise((r) => setTimeout(r, 0)); });
    expect(push.disablePush).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
    expect(screen.getByText(/aren't available on this server right now/)).toBeTruthy();
  });

  it("offers Turn off when signed out with a subscription left behind, and nothing to remove without one", async () => {
    push.status = "signed-out";
    await show();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
    cleanup();
    push.local = false;
    await show();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Turn on/ })).toBeNull();
  });

  it("shows Turn on when off, and Turn off when on", async () => {
    push.status = "off"; push.local = false;
    await show();
    expect(screen.getByRole("button", { name: /Turn on notifications/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
    cleanup();
    push.status = "on"; push.local = true;
    await show();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  });
});
