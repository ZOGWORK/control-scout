// @vitest-environment jsdom
// The slow-connection card: says what the app saw (how long this page has waited, or how many requests failed),
// what Lite changes, and offers two 44px actions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LiteCard, reasonText } from "./LiteSuggest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("slow-connection card", () => {
  it("says the evidence in plain words", () => {
    expect(reasonText({ kind: "failing", count: 3, at: 0 }, 4)).toBe("3 requests couldn't reach the server, the last one 4 s ago.");
    expect(reasonText({ kind: "loaded", took: 12 }, null)).toBe("This page took 12 s to load.");
    expect(reasonText({ kind: "waiting", since: 0 }, 9)).toBe("This page has been loading for 9 s.");
    expect(reasonText(null, null)).toBe("This page is taking a while to load.");
  });

  it("ticks the wait, links the Lite page, and dismisses", () => {
    const onDismiss = vi.fn();
    render(<LiteCard href="/lite/teams/4215" onDismiss={onDismiss} reason={{ kind: "waiting", since: Date.now() - 8000 }} />);
    expect(screen.getByText("This page has been loading for 8 s.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("This page has been loading for 10 s.")).toBeTruthy();
    const go = screen.getByRole("link", { name: /Switch to Lite/ });
    expect(go.getAttribute("href")).toBe("/lite/teams/4215");
    expect(go.className).toContain("h-11");
    const wait = screen.getByRole("button", { name: "Keep waiting" });
    expect(wait.className).toContain("h-11");
    expect(screen.getByRole("button", { name: "Dismiss" }).className).toContain("size-11");
    fireEvent.click(wait);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
