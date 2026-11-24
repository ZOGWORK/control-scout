// @vitest-environment jsdom
// The bug report form's code loads on first use (S14). When it can't (no connection, a deploy replaced the chunk),
// the dialog says so with a try again, never the page's error screen, and nothing goes unhandled.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ palette: "dark", theme: "dark" }) }));

const { BugReportButton, formChunk } = await import("./BugReport");
const real = formChunk.load;
let fail = true;
// The chunk's download failing, as lazy() sees it: the import's promise rejects.
formChunk.load = () => (fail ? Promise.reject(new Error("Failed to fetch dynamically imported module")) : real());

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the bug report form loading on first use", () => {
  it("a failed load is said in the dialog, with a try again, and the rest of the page stays", async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MemoryRouter><main><h1>Rankings</h1><BugReportButton /></main></MemoryRouter>);
    const button = screen.getByTestId("bug-report-button");
    fireEvent.pointerEnter(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(await screen.findByText(/couldn't load/)).toBeTruthy();
    expect(screen.getByText("Rankings")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejections).toEqual([]);
    window.removeEventListener("unhandledrejection", onRejection);
    // Back: try again loads it afresh (lazy keeps a failed load for good).
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Send report/ })).toBeTruthy();
    expect(screen.queryByText(/couldn.t load/)).toBeNull();
  });
});
