// @vitest-environment jsdom
// The error a page shows when its data can't load: "offline" only when the connection check found no internet (never
// navigator.onLine alone: iOS says offline while online); a server that doesn't answer says so, and both offer Try
// again; a read that is only slow says so.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "./states";
import { ApiError, SLOW_CODE } from "../lib/api";
import { checkInternet, resetConnection } from "../lib/connection";

vi.mock("./layout/Search", () => ({ useSearch: () => ({ open: () => {} }) }));

const online = (v: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(v);

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetConnection(); });

describe("ErrorState", () => {
  it("says you're offline when the connection check found no internet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await checkInternet();
    render(<ErrorState error={new ApiError(0, "You're offline.", true)} onRetry={() => {}} />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText(/This page needs a connection/)).toBeTruthy();
  });

  it("blames the server, not your connection, when nothing answers, whatever navigator.onLine says (iOS)", () => {
    online(false);
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(0, "Can't reach the server right now.", true)} onRetry={retry} />);
    expect(screen.queryByText("You're offline")).toBeNull();
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorState: slow", () => {
  it("a read that is only slow says Slow connection, never offline", () => {
    render(<ErrorState error={new ApiError(0, "Slow connection: still waiting for the server.", true, SLOW_CODE)} />);
    expect(screen.getByText("Slow connection")).toBeTruthy();
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});
