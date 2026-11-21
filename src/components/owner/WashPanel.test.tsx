// @vitest-environment jsdom
// Owner console › Wash: three colour fields, Brightness and Spread, the real Wash as a live preview that follows the
// fields, Save sending the cleaned wash (only when it changed and is valid), and Reset asking first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_WASH, WASH_STYLE_ID, type OwnerWash } from "../../shared/wash";

const DATA: OwnerWash = { wash: { ...DEFAULT_WASH }, custom: false, defaults: { ...DEFAULT_WASH }, updatedAt: null, updatedBy: null };
const SAVED: OwnerWash = { ...DATA, wash: { ...DEFAULT_WASH, a: "#ff0000" }, custom: true, updatedAt: "2026-11-18T00:00:00Z", updatedBy: "owner@example.com" };
const sent: { path: string; json: unknown }[] = [];
const toasts: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: DATA, error: undefined, loading: false, reload: () => {} }),
  prime: () => {},
  markStale: () => {},
  apiFetch: async (path: string, init: { json: unknown }) => { sent.push({ path, json: init.json }); return path.endsWith("/reset") ? DATA : SAVED; },
}));
vi.mock("../ui/sonner", () => ({ toast: { success: (m: string) => toasts.push(m), error: (m: string) => toasts.push(m) } }));
// jsdom has no ResizeObserver; Radix's Slider measures its thumbs with one.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const { WashPanel } = await import("./WashPanel");

beforeEach(() => { sent.length = 0; toasts.length = 0; document.getElementById(WASH_STYLE_ID)?.remove(); });
afterEach(cleanup);

const preview = () => screen.getByTestId("wash-preview");

describe("WashPanel", () => {
  it("draws the real Wash with the saved colours, and the fields for colours, brightness and spread", () => {
    render(<WashPanel />);
    expect(screen.getByRole("heading", { name: "Wash" })).toBeTruthy();
    expect(preview().querySelector("[data-wash]")).toBeTruthy();
    expect(preview().style.getPropertyValue("--wash-a")).toBe("#5a76ad");
    for (const l of ["Left", "Middle", "Right"]) expect((screen.getByLabelText(l) as HTMLInputElement).value).toBe(DEFAULT_WASH[({ Left: "a", Middle: "b", Right: "c" } as const)[l as "Left"]]);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    // Nothing changed yet: nothing to save, and it's already the default.
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Reset to default/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the preview follows the fields as they change; a colour still being typed keeps the saved one and blocks Save", () => {
    render(<WashPanel />);
    fireEvent.change(screen.getByLabelText("Middle"), { target: { value: "#00FF00" } });
    expect(preview().style.getPropertyValue("--wash-b")).toBe("#00ff00");
    fireEvent.change(screen.getByLabelText("Right colour picker"), { target: { value: "#0000ff" } });
    expect(preview().style.getPropertyValue("--wash-c")).toBe("#0000ff");
    fireEvent.change(screen.getByLabelText("Left"), { target: { value: "#12" } });
    expect(preview().style.getPropertyValue("--wash-a")).toBe("#5a76ad");
    expect(screen.getByText(/Use a hex colour/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("brightness above 1 brightens the preview's colours; a keyboard step on Spread moves it", () => {
    render(<WashPanel />);
    const [bright, spread] = screen.getAllByRole("slider");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(bright, { key: "ArrowRight" });
    expect(preview().style.getPropertyValue("--wash-strength")).toBe("1");
    expect(preview().style.getPropertyValue("--wash-a")).not.toBe("#5a76ad");
    fireEvent.keyDown(spread, { key: "ArrowLeft" });
    expect(preview().style.getPropertyValue("--wash-spread")).toBe("0.95");
  });

  it("Save sends the cleaned wash and puts it on the open page", async () => {
    render(<WashPanel />);
    fireEvent.change(screen.getByLabelText("Left"), { target: { value: "FF0000" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/wash", json: { wash: { ...DEFAULT_WASH, a: "#ff0000" } } }]));
    await waitFor(() => expect(toasts[0]).toMatch(/Wash saved/));
    expect(document.getElementById(WASH_STYLE_ID)?.textContent).toContain("--wash-a:#ff0000");
  });

  it("Reset to default asks first, then sends confirm and takes the owner's wash off the page", async () => {
    render(<WashPanel />);
    fireEvent.change(screen.getByLabelText("Left"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Reset to default/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/wash/reset", json: { confirm: true } }]));
    expect(document.getElementById(WASH_STYLE_ID)).toBeNull();
  });
});
