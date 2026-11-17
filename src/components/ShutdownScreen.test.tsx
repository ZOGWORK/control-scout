// @vitest-environment jsdom
// The shutdown message in the app (src/lib/shutdown.ts): an installed app's cached shell shows a visitor who isn't
// signed in only the two lines while the owner has publicAccess off, learnt from the flags with /api/auth/me signed
// out, or from an API answer of 503 {error: "unavailable"} (never retried). Signed-in accounts see the app; nothing
// on the device is cleared.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "../lib/api";
import { isUnavailableAnswer, resetUnavailable } from "../lib/shutdown";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { ShutdownGate } from "./ShutdownScreen";

const personal = vi.hoisted(() => ({ user: null as null | { id: number }, providers: null as null | object }));
vi.mock("../lib/personal", () => ({ usePersonal: () => personal }));

const LINE_1 = "Control Scout is temporarily unavailable.";
const LINE_2 = "We'll be back in a couple of days.";
const app = () => render(<ShutdownGate><p>The app</p></ShutdownGate>);

beforeEach(() => {
  personal.user = null;
  personal.providers = null;
  resetUnavailable();
  resetFlags();
  localStorage.setItem("cs-personal:bookmarks", JSON.stringify({ value: [18360], updatedAt: 1 }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("ShutdownGate", () => {
  it("shows only the message to a signed-out visitor once the flags say publicAccess is off", () => {
    personal.providers = { email: true, google: false };
    app();
    expect(screen.getByText("The app")).toBeTruthy();
    act(() => resetFlags({ ...DEFAULT_FLAGS, publicAccess: false }, true));
    expect(screen.queryByText("The app")).toBeNull();
    expect(screen.getByText(LINE_1)).toBeTruthy();
    expect(screen.getByText(LINE_2)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(document.title).toBe(LINE_1);
    expect(localStorage.getItem("cs-personal:bookmarks")).not.toBeNull();
  });

  it("waits for /api/auth/me before deciding (no flash for a signed-in account)", () => {
    resetFlags({ ...DEFAULT_FLAGS, publicAccess: false }, true);
    app();
    expect(screen.getByText("The app")).toBeTruthy();
  });

  it("leaves a signed-in account's app alone", () => {
    personal.user = { id: 1 };
    personal.providers = { email: true, google: false };
    resetFlags({ ...DEFAULT_FLAGS, publicAccess: false }, true);
    app();
    expect(screen.getByText("The app")).toBeTruthy();
    expect(screen.queryByText(LINE_1)).toBeNull();
  });

  it("shows the message when an API answer says the site is unavailable", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "unavailable", message: `${LINE_1} ${LINE_2}` }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "172800" } }));
    vi.stubGlobal("fetch", fetch);
    app();
    const e = await act(() => apiFetch("/api/teams/123").catch((x: unknown) => x));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 503, code: "unavailable", message: `${LINE_1} ${LINE_2}` });
    expect(fetch).toHaveBeenCalledTimes(1); // never waits out a two-day Retry-After
    expect(screen.getByText(LINE_1)).toBeTruthy();
    expect(screen.queryByText("The app")).toBeNull();
  });

  it("tells the gate's answer from the server's own starting-up 503", () => {
    expect(isUnavailableAnswer(503, { error: "unavailable" })).toBe(true);
    expect(isUnavailableAnswer(503, { error: "Control Scout is starting up. Try again in a few seconds." })).toBe(false);
    expect(isUnavailableAnswer(403, { error: "unavailable" })).toBe(false);
  });
});
