// @vitest-environment jsdom
// The error a page shows when its data can't load: "offline" only when the device has no network; a server that
// doesn't answer says so, and both offer Try again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "./states";
import { ApiError } from "../lib/api";

vi.mock("./layout/Search", () => ({ useSearch: () => ({ open: () => {} }) }));

const online = (v: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(v);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ErrorState", () => {
  it("says you're offline when the device has no network", () => {
    online(false);
    render(<ErrorState error={new ApiError(0, "You're offline.", true)} onRetry={() => {}} />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText(/This page needs a connection/)).toBeTruthy();
  });

  it("blames the server, not your connection, when the device is online but nothing answers", () => {
    online(true);
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(0, "Can't reach the server right now.", true)} onRetry={retry} />);
    expect(screen.queryByText("You're offline")).toBeNull();
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
