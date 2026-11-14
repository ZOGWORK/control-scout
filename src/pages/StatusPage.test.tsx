// @vitest-environment jsdom
// /status: the banner and a card per part from GET /api/status, and fresh results while the page stays open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { StatusResponse } from "../shared/status";

vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
const { default: StatusPage } = await import("./StatusPage");
const { invalidate } = await import("../lib/api");

const answer = (up: boolean): StatusResponse => ({
  overall: up ? "up" : "partial", checkedAt: Date.now(), everyMinutes: 2,
  services: [
    { key: "site", label: "Website", about: "The pages you browse", up: true, uptime24h: 100, uptime30d: 99.9, bars: [] },
    { key: "bot", label: "Discord bot", about: "Answers and alerts in Discord", up, uptime24h: 100, uptime30d: 100, bars: [] },
  ],
});

let calls = 0;
let up = true;
beforeEach(() => {
  calls = 0; up = true;
  invalidate("/api/status");
  vi.stubGlobal("fetch", async (path: string) => {
    if (!path.startsWith("/api/status")) throw new Error(`unexpected ${path}`);
    calls++;
    return new Response(JSON.stringify(answer(up)), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("StatusPage", () => {
  it("shows the banner and each part, and asks again every check while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MemoryRouter><StatusPage /></MemoryRouter>);
    expect(await screen.findByText("Everything is running")).toBeTruthy();
    expect(screen.getByText("Discord bot")).toBeTruthy();
    const before = calls;
    up = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000 + 10); });
    expect(calls).toBeGreaterThan(before);
    expect(await screen.findByText("Some parts are down")).toBeTruthy();
  });
});
