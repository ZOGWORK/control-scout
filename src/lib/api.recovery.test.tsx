// @vitest-environment jsdom
// Recovering from a bad answer (audit PUB-F02) and seeing an answer that lands
// before the hook subscribes (PUB-F03).
// - A 200 whose body can't be read is an error, never a cached `null`: the page
//   shows its error state, and "Try again" fetches afresh once the server is fixed.
// - The route boundary's "Try again" asks the server again for what the page read,
//   instead of re-rendering the same cached answer.
// - A value primed between the hook's first render and its subscription shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, apiFetch, peek, prime, useApi } from "./api";
import { Async } from "../components/states";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";

/** What the fake server answers per path (the body text and status), and every path asked for. */
const answers = new Map<string, { body: string; status?: number }>();
const asked: string[] = [];

beforeEach(() => {
  answers.clear();
  asked.length = 0;
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    asked.push(path);
    const a = answers.get(path) ?? { body: "{}" };
    return new Response(a.body || null, { status: a.status ?? 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("apiFetch: a successful answer it can't read", () => {
  it("a truncated JSON body is an ApiError, not null", async () => {
    answers.set("/api/t/truncated", { body: '{"season":2026,' });
    const err = await apiFetch("/api/t/truncated").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).offline).toBe(false);
  });

  it("an empty 204 and an explicit JSON null still answer null", async () => {
    answers.set("/api/t/empty", { body: "", status: 204 });
    answers.set("/api/t/null", { body: "null" });
    expect(await apiFetch("/api/t/empty")).toBeNull();
    expect(await apiFetch("/api/t/null")).toBeNull();
  });
});

type Ev = { event: { name: string } };
function EventLike({ path }: { path: string }) {
  const state = useApi<Ev>(path);
  return <Async state={state}>{(d) => <p>Event {d.event.name}</p>}</Async>;
}

describe("useApi: recovering once the server is fixed", () => {
  it("a truncated body shows the error state (nothing cached), and Try again renders the repaired data", async () => {
    const path = "/api/events/2025/TRUNC";
    answers.set(path, { body: '{"event":' });
    render(<MemoryRouter><EventLike path={path} /></MemoryRouter>);
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.queryByText("This page hit a problem")).toBeNull();
    expect(peek(path)).toBeUndefined();
    answers.set(path, { body: JSON.stringify({ event: { name: "Repaired" } }) });
    fireEvent.click(retry);
    expect(await screen.findByText("Event Repaired")).toBeTruthy();
  });

  it("the route boundary's Try again fetches the page's data afresh instead of reusing the answer it crashed on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = "/api/events/2025/SHAPE";
    answers.set(path, { body: "{}" }); // readable, but not what the page expects: it throws while rendering
    render(<MemoryRouter><RouteErrorBoundary><EventLike path={path} /></RouteErrorBoundary></MemoryRouter>);
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByText("This page hit a problem")).toBeTruthy();
    const before = asked.filter((p) => p === path).length;
    answers.set(path, { body: JSON.stringify({ event: { name: "Fixed" } }) });
    fireEvent.click(retry);
    expect(await screen.findByText("Event Fixed")).toBeTruthy();
    expect(asked.filter((p) => p === path).length).toBe(before + 1);
  });
});

describe("useApi: an answer that lands before the subscription", () => {
  it("a value primed between the first render and the passive subscription is shown", async () => {
    const path = "/api/t/subscription-gap";
    function Child() {
      const s = useApi<{ v: string }>(path);
      return <p>{s.loading ? "loading" : s.data?.v}</p>;
    }
    function Parent() {
      // Runs after the child's render, before its passive effects (where the old hook subscribed).
      useLayoutEffect(() => { prime(path, { v: "arrived early" }); }, []);
      return <Child />;
    }
    await act(async () => { render(<Parent />); });
    await waitFor(() => expect(screen.getByText("arrived early")).toBeTruthy());
    expect(asked).not.toContain(path); // fresh in the cache: no request needed
  });
});
