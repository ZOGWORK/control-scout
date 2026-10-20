// @vitest-environment jsdom
// A page whose code didn't download (audit PUB3-F02). React.lazy keeps a failed import, so the boundary's
// "Try again" could only fail again: these errors get their own state, whose button reloads Control Scout
// (only when pressed). Before reloading, work that exists only on this page is named and the reload waits for a
// second press; work kept on this device (comment attempts, here) comes back after the reload.
import { lazy } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { appReload, isChunkLoadError } from "../lib/chunkError";
import { publishPending, type PendingItem } from "../lib/pendingWork";
import { commentAttempt, loadCommentAttempts, resetCommentAttempts, sendComment } from "../lib/commentAttempts";

let reloads = 0;
beforeEach(() => {
  reloads = 0;
  vi.spyOn(appReload, "run").mockImplementation(() => { reloads++; });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); publishPending("test", []); resetCommentAttempts(); localStorage.clear(); });

const mount = (Page: React.ComponentType) => render(<MemoryRouter><RouteErrorBoundary><Page /></RouteErrorBoundary></MemoryRouter>);

describe("RouteErrorBoundary: a page chunk that didn't download", () => {
  it("offers Reload Control Scout (not Try again), and reloads only when it's pressed", async () => {
    const EventsPage = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: http://localhost/assets/EventsPage-BE-7_bIA.js")));
    mount(EventsPage);
    const button = await screen.findByRole("button", { name: /Reload Control Scout/ });
    expect(screen.getByText("This page didn't finish downloading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(reloads).toBe(0); // never automatic
    fireEvent.click(button);
    expect(reloads).toBe(1);
  });

  it("a page that throws while rendering keeps Try again", async () => {
    const Broken = () => { throw new Error("Cannot read properties of undefined (reading 'name')"); };
    mount(Broken);
    expect(await screen.findByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.getByText("This page hit a problem")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reload Control Scout/ })).toBeNull();
  });

  it("names work that only this page holds, and reloads on the second press", async () => {
    const item: PendingItem = { key: "order:1:901:2025:1", account: 1, kind: "order", workspaceId: "901", season: 2025, team: 7, label: "Move 7 up", status: "attention", message: "Not saved.", volatile: true };
    publishPending("test", [item, { ...item, key: "kept", volatile: undefined }]);
    mount(lazy(() => Promise.reject(new TypeError("Importing a module script failed."))));
    fireEvent.click(await screen.findByRole("button", { name: /Reload Control Scout/ }));
    expect(reloads).toBe(0);
    expect(screen.getByRole("alert").textContent).toMatch(/1 change .* a reload now loses it/);
    fireEvent.click(screen.getByRole("button", { name: /Reload anyway/ }));
    expect(reloads).toBe(1);
  });
});

describe("isChunkLoadError", () => {
  it("knows each browser's and bundler's failed-download errors, and nothing else", () => {
    for (const m of ["Failed to fetch dynamically imported module: /assets/a.js", "error loading dynamically imported module: /assets/a.js", "Importing a module script failed.", "Unable to preload CSS for /assets/a.css", "Loading chunk 42 failed."]) {
      expect(isChunkLoadError(new TypeError(m))).toBe(true);
    }
    expect(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
    for (const e of [new Error("Cannot read properties of undefined"), new TypeError("Failed to fetch"), null, "Failed to fetch dynamically imported module"]) {
      expect(isChunkLoadError(e)).toBe(false);
    }
  });

  it("an error Vite announced through vite:preloadError counts, whatever its message", () => {
    const err = new Error("something odd");
    expect(isChunkLoadError(err)).toBe(false);
    window.dispatchEvent(Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: err }));
    expect(isChunkLoadError(err)).toBe(true);
  });
});

describe("unsent work and a reload", () => {
  const place = { account: 1, space: "901", uuid: "e-1", season: 2025, team: 7 };
  const refuse = () => Promise.reject(new Error("Couldn't post"));

  it("a comment that didn't go is kept on this device and comes back after a reload", async () => {
    await sendComment(place, "Fast intake", "op-1", refuse);
    resetCommentAttempts(); // the reload: memory is gone, storage stays
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ comments: [] }), { status: 200 })));
    loadCommentAttempts(1);
    expect(commentAttempt(1, "901", "e-1")?.body).toBe("Fast intake");
    vi.unstubAllGlobals();
  });

  it("one this device couldn't store is marked as only on this page, so the reload asks first", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await sendComment(place, "Fast intake", "op-2", refuse);
    vi.mocked(Storage.prototype.setItem).mockRestore();
    mount(lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))));
    fireEvent.click(await screen.findByRole("button", { name: /Reload Control Scout/ }));
    expect(reloads).toBe(0);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("one still on its way that this device couldn't store counts too (its answer hasn't come)", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    let answer!: () => void;
    const sent = sendComment(place, "Fast intake", "op-3", () => new Promise<void>((r) => { answer = r; }));
    vi.mocked(Storage.prototype.setItem).mockRestore();
    mount(lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))));
    fireEvent.click(await screen.findByRole("button", { name: /Reload Control Scout/ }));
    expect(reloads).toBe(0);
    expect(screen.getByRole("alert").textContent).toMatch(/1 change/);
    answer();
    await sent;
    cleanup();
    // Confirmed: nothing is left that a reload could lose.
    mount(lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))));
    fireEvent.click(await screen.findByRole("button", { name: /Reload Control Scout/ }));
    expect(reloads).toBe(1);
  });
});
