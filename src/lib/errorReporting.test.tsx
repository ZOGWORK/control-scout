// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  buildReport, captureError, clearPrompt, disableReporting, installErrorReporting, isNoise, lastError, manualReport, resetErrorReporting, SEND_TIMEOUT_MS, sendReport, usePendingReport,
} from "./errorReporting";
import { ErrorReportPrompt } from "../components/layout/ErrorReportPrompt";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";

let fetchMock: ReturnType<typeof vi.fn>;
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  resetErrorReporting();
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Pending() {
  const p = usePendingReport();
  return <p data-testid="pending">{p ? p.message : "none"}</p>;
}

describe("building a report", () => {
  it("holds only the six fields, sanitized, and reads nothing from storage", () => {
    localStorage.setItem("cs-scout-123e4567-e89b-12d3-a456-426614174000", JSON.stringify({ notes: "Their intake jams" }));
    const r = buildReport(new TypeError("no user ada@example.com"));
    expect(Object.keys(r).sort()).toEqual(["appVersion", "message", "route", "stack", "timestamp", "userAgent"]);
    expect(r.message).toBe("TypeError: no user [redacted]");
    expect(JSON.stringify(r)).not.toMatch(/intake|ada@example/);
  });

  it("never serialises a thrown object", () => {
    expect(buildReport({ notes: "private", team: 1 }).message).toBe("Non-error thrown (object)");
  });

  it("filters browser noise", () => {
    expect(isNoise(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isNoise("Script error.")).toBe(true);
    expect(isNoise(new Error("ResizeObserver loop completed with undelivered notifications."))).toBe(true);
    expect(isNoise(new TypeError("x is undefined"))).toBe(false);
  });

  it("a Settings report carries the visitor's words, sanitized, and the last error's stack", () => {
    captureError(new Error("boom"));
    const r = manualReport("The odds tab is blank, email me at coach@example.com");
    expect(r.message).toBe("Bug report: The odds tab is blank, email me at [redacted]");
    expect(r.stack).toContain("After: Error: boom");
    expect(lastError()?.message).toBe("Error: boom");
  });
});

describe("the prompt", () => {
  it("offers to report a caught error; Report sends it once", async () => {
    render(<ErrorReportPrompt />);
    act(() => captureError(new TypeError("Cannot read properties of undefined (reading 'opr')")));
    expect(screen.getByText("Something broke — report it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    await screen.findByText("Thanks, it's reported.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/error");
    expect(sentBodies()[0].message).toBe("TypeError: Cannot read properties of undefined (reading 'opr')");
  });

  it("Dismiss sends nothing, and the same error isn't offered twice", () => {
    render(<><ErrorReportPrompt /><Pending /></>);
    act(() => captureError(new Error("same thing 1")));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByTestId("pending").textContent).toBe("none");
    act(() => captureError(new Error("same thing 2"))); // only the number differs
    expect(screen.getByTestId("pending").textContent).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listens for uncaught errors and unhandled rejections", () => {
    installErrorReporting();
    render(<Pending />);
    act(() => { window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("bad index"), message: "bad index" })); });
    expect(screen.getByTestId("pending").textContent).toBe("RangeError: bad index");
    act(() => resetErrorReporting());
    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new Error("sync failed");
    act(() => { window.dispatchEvent(ev); });
    expect(screen.getByTestId("pending").textContent).toBe("Error: sync failed");
  });

  it("the route boundary shows a calm fallback and offers the report", () => {
    const Boom = () => { throw new Error("render exploded"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><RouteErrorBoundary><Boom /></RouteErrorBoundary><Pending /></MemoryRouter>);
    expect(screen.getByText("This page hit a problem")).toBeTruthy();
    expect(screen.getByTestId("pending").textContent).toBe("Error: render exploded");
  });
});

describe("recursion guard (browser)", () => {
  it("errors raised while a report is being sent are ignored", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    render(<Pending />);
    const sending = sendReport(buildReport(new Error("first")));
    act(() => captureError(new Error("thrown by the reporting path")));
    expect(screen.getByTestId("pending").textContent).toBe("none");
    finish(new Response("{}", { status: 202 }));
    expect(await sending).toBe("sent");
  });

  it("a stalled send times out and frees the pipeline", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      fetchMock.mockImplementation((_u: unknown, init?: RequestInit) => new Promise<Response>(() => { init?.signal?.addEventListener("abort", () => { aborted = true; }); }));
      const sending = sendReport(buildReport(new Error("x")));
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      expect(await sending).toBe("failed");
      expect(aborted).toBe(true);
      captureError(new Error("after the stall"));
      expect(lastError()?.message).toBe("Error: after the stall");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a send that finishes after its prompt was closed never closes the next prompt", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    render(<><ErrorReportPrompt /><Pending /></>);
    act(() => captureError(new Error("first problem")));
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => { finish(new Response("{}", { status: 202 })); await Promise.resolve(); });
    act(() => captureError(new Error("second problem")));
    expect(screen.getByTestId("pending").textContent).toBe("Error: second problem");
    await act(() => new Promise((r) => setTimeout(r, 2700)));
    expect(screen.getByTestId("pending").textContent).toBe("Error: second problem");
    expect(screen.getByText("Something broke — report it?")).toBeTruthy();
  });

  it("a failing send never throws, rejects or reports itself", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const onRejection = vi.fn();
    window.addEventListener("unhandledrejection", onRejection);
    render(<Pending />);
    await expect(sendReport(buildReport(new Error("x")))).resolves.toBe("failed");
    expect(screen.getByTestId("pending").textContent).toBe("none");
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(sendReport(buildReport(new Error("x")))).resolves.toBe("failed");
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(sendReport(buildReport(new Error("x")))).resolves.toBe("limited");
    await new Promise((r) => setTimeout(r, 0));
    expect(onRejection).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onRejection);
  });

  it("a failure inside the pipeline itself is swallowed", () => {
    const hostile = { get message(): string { throw new Error("getter blew up"); }, get stack(): string { throw new Error("nope"); } };
    expect(() => captureError(hostile)).not.toThrow();
    render(<Pending />);
    expect(screen.getByTestId("pending").textContent).toBe("none");
  });

  it("the prompt failing to render switches reporting off for the page load", async () => {
    render(<><ErrorReportPrompt /><Pending /></>);
    act(() => disableReporting());
    act(() => captureError(new Error("after the prompt broke")));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("none"));
  });

  it("asks at most three times per page load", () => {
    render(<Pending />);
    let prompted = 0;
    for (const word of ["alpha", "bravo", "charlie", "delta", "echo"]) {
      act(() => captureError(new Error(`distinct ${word}`)));
      if (screen.getByTestId("pending").textContent !== "none") prompted++;
      act(() => clearPrompt());
    }
    expect(prompted).toBe(3);
  });
});
