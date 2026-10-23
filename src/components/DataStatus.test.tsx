// @vitest-environment jsdom
// Check again shows it's working: "Checking…" until the reload settles (and at least a moment), one request at a time.
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataStatus } from "./DataStatus";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("DataStatus Check again", () => {
  it("shows Checking… while the reload is out, ignores repeat clicks, then returns", async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { settle = r; }));
    render(<DataStatus readiness={{ state: "preparing", resultsAt: "2026-10-17T10:00:00Z", statsAt: null }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    const busy = screen.getByRole("button", { name: /Checking…/ });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The answer is in, but the moment hasn't passed: still checking.
    await act(async () => { settle(); });
    expect(screen.getByRole("button", { name: /Checking…/ })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole("button", { name: /Check again/ }).getAttribute("aria-busy")).toBe("false");
  });

  it("comes back from Checking… under StrictMode (effects run twice in development)", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn(async () => {});
    render(<StrictMode><DataStatus readiness={{ state: "preparing", resultsAt: "2026-10-17T10:00:00Z", statsAt: null }} onRetry={onRetry} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole("button", { name: /Check again/ }).getAttribute("aria-busy")).toBe("false");
  });
});
