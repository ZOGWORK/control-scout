// @vitest-environment jsdom
// Owner console › Appearance › Gradients: six ready-made gradients that only change the preview until Save, a Dark /
// Light preview of a page with the real wash and page-end glow, fine-tuning (top and glow colours, Brightness and
// Spread) that the preview follows, Save sending the cleaned wash (only when it changed and is valid), and Reset asking first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_WASH, WASH_PRESETS, WASH_STYLE_ID, type OwnerWash } from "../../shared/wash";

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
const tune = () => fireEvent.click(screen.getByRole("button", { name: /Fine-tune/ }));

describe("WashPanel", () => {
  it("draws the real wash and page-end glow with the saved colours, and the fields for colours, brightness and spread", () => {
    render(<WashPanel />);
    expect(screen.getByRole("heading", { name: "Gradients" })).toBeTruthy();
    expect(preview().querySelector("[data-wash]")).toBeTruthy();
    expect(preview().querySelector("[data-page-end-glow]")).toBeTruthy();
    expect(preview().style.getPropertyValue("--wash-a")).toBe("#5a76ad");
    expect(preview().style.getPropertyValue("--glow-a")).toBe("#be6937");
    tune();
    const keys = { "Top left": "a", "Top middle": "b", "Top right": "c", "Glow left": "ga", "Glow middle": "gb", "Glow right": "gc" } as const;
    for (const [l, k] of Object.entries(keys)) expect((screen.getByLabelText(l) as HTMLInputElement).value).toBe(DEFAULT_WASH[k]);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    // Nothing changed yet: nothing to save, and it's already the default.
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Reset to default/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the preview follows the fields as they change; a colour still being typed keeps the saved one and blocks Save", () => {
    render(<WashPanel />);
    tune();
    fireEvent.change(screen.getByLabelText("Top middle"), { target: { value: "#00FF00" } });
    expect(preview().style.getPropertyValue("--wash-b")).toBe("#00ff00");
    fireEvent.change(screen.getByLabelText("Glow right colour picker"), { target: { value: "#0000ff" } });
    expect(preview().style.getPropertyValue("--glow-c")).toBe("#0000ff");
    fireEvent.change(screen.getByLabelText("Top left"), { target: { value: "#12" } });
    expect(preview().style.getPropertyValue("--wash-a")).toBe("#5a76ad");
    expect(screen.getByText(/Use a hex colour/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("brightness above 1 brightens the preview's colours; a keyboard step on Spread moves it", () => {
    render(<WashPanel />);
    tune();
    const [bright, spread] = screen.getAllByRole("slider");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(bright, { key: "ArrowRight" });
    expect(preview().style.getPropertyValue("--wash-strength")).toBe("1");
    expect(preview().style.getPropertyValue("--wash-a")).not.toBe("#5a76ad");
    fireEvent.keyDown(spread, { key: "ArrowLeft" });
    expect(preview().style.getPropertyValue("--wash-spread")).toBe("0.95");
  });

  it("Save sends the cleaned wash and puts it on the open page", async () => {
    render(<WashPanel />);
    tune();
    fireEvent.change(screen.getByLabelText("Top left"), { target: { value: "FF0000" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/wash", json: { wash: { ...DEFAULT_WASH, a: "#ff0000" } } }]));
    await waitFor(() => expect(toasts[0]).toMatch(/Your gradient is live/));
    expect(document.getElementById(WASH_STYLE_ID)?.textContent).toContain("--wash-a:#ff0000");
  });

  it("Reset to default asks first, then sends confirm and takes the owner's wash off the page", async () => {
    render(<WashPanel />);
    tune();
    fireEvent.change(screen.getByLabelText("Top left"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
    expect(sent).toEqual([]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Reset to default/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/wash/reset", json: { confirm: true } }]));
    expect(document.getElementById(WASH_STYLE_ID)).toBeNull();
  });

  it("a preset only changes the preview until Save, which sends it whole; Dusk is marked live", async () => {
    render(<WashPanel />);
    const ocean = WASH_PRESETS.find((p) => p.id === "ocean")!;
    expect(screen.getAllByRole("button", { pressed: true }).map((b) => b.getAttribute("data-preset"))).toEqual(["dusk"]);
    expect(document.querySelector("[data-preset='dusk']")!.textContent).toContain("Live");
    fireEvent.click(document.querySelector("[data-preset='ocean']")!);
    expect(preview().style.getPropertyValue("--wash-a")).toBe(ocean.wash.a);
    expect(preview().style.getPropertyValue("--glow-b")).toBe(ocean.wash.gb);
    expect(sent).toEqual([]);
    expect(document.getElementById(WASH_STYLE_ID)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save Ocean/ }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/owner/wash", json: { wash: ocean.wash } }]));
  });

  it("previews in Light: the pale mix on a near-white page", () => {
    render(<WashPanel />);
    expect(preview().dataset.mode).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(preview().dataset.mode).toBe("light");
    expect(preview().style.getPropertyValue("--wash-mix")).toBe("42%");
  });
});
