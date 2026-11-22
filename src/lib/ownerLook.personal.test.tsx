// @vitest-environment jsdom
// The owner's look with the real account state (src/lib/personal.tsx): a failed /api/auth/me (a 5xx, no signal with no
// saved account) is no answer, so a classic-look device is left alone (it may be the owner's); only /me answering that
// the visitor isn't the owner turns it back into the new look.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const look = vi.hoisted(() => ({ setV8: vi.fn() }));
vi.mock("./v8", async (orig) => ({ ...(await orig<typeof import("./v8")>()), isV8: () => false, setV8: look.setV8 }));
const { PersonalProvider, usePersonal } = await import("./personal");
const { OwnerOnlyClassicLook } = await import("./ownerLook");

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
let answered: boolean | null = null;
function Probe() { answered = usePersonal().accountAnswered; return null; }
const mount = async () => {
  render(<MemoryRouter><PersonalProvider><Probe /><OwnerOnlyClassicLook /></PersonalProvider></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const me = (answer: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(async (url: string) => (new URL(String(url), "http://x").pathname === "/api/auth/me" ? answer() : json({ error: "not in this test" }, 404))));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); answered = null; look.setV8.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the owner's look against /api/auth/me", () => {
  it("leaves the classic look alone when /me fails with a server error", async () => {
    me(async () => json({ error: "boom" }, 500));
    await mount();
    expect(answered).toBe(false);
    expect(look.setV8).not.toHaveBeenCalled();
  });

  it("leaves it alone with no signal and no saved account", async () => {
    me(async () => { throw new TypeError("Failed to fetch"); });
    await mount();
    expect(answered).toBe(false);
    expect(look.setV8).not.toHaveBeenCalled();
  });

  it("turns it back into the new look once /me answers that nobody (or not the owner) is signed in", async () => {
    me(async () => json({ user: null, providers: { email: true, google: false } }));
    await mount();
    expect(answered).toBe(true);
    expect(look.setV8).toHaveBeenCalledWith(true, "/");
  });
});
