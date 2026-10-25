// @vitest-environment jsdom
// The overlay in an ordinary browser tab is a preview with a way back and the link for OBS; in OBS (window.obsstudio)
// or with ?clean=1 it's the bare overlay, nothing else on the page.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../lib/api", () => ({ useApi: () => ({ data: undefined, error: undefined, loading: true, reload: async () => {} }) }));
vi.mock("../lib/pitPoll", () => ({ useDisplayPoll: () => "ok" }));
vi.mock("../lib/meta", () => ({ useTitle: () => {} }));
vi.mock("../components/ui/sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { default: EventOverlayPage } = await import("./EventOverlayPage");

let search = "";
function Probe() { search = useLocation().search; return null; }
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/events/:season/:code/overlay" element={<><EventOverlayPage /><Probe /></>} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); delete (window as unknown as { obsstudio?: unknown }).obsstudio; });

describe("stream overlay page", () => {
  it("in a browser tab: a preview with Back to event, the options, and a link for OBS that's always bare", async () => {
    const writes: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => { writes.push(t); } } });
    mount("/events/2025/FTCCMP1EDIS/overlay?bg=green");
    expect(document.querySelector("[data-overlay-preview]")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to event/ }).getAttribute("href")).toBe("/events/2025/FTCCMP1EDIS");
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(search).toBe("?bg=green&pos=top");
    fireEvent.click(screen.getByRole("button", { name: /Copy link for OBS/ }));
    expect(await screen.findByRole("button", { name: /Copied/ })).toBeTruthy();
    expect(writes[0]).toBe(`${window.location.origin}/events/2025/FTCCMP1EDIS/overlay?bg=green&pos=top&clean=1`);
  });
  it("when the browser won't copy, the link shows to select by hand", async () => {
    Object.assign(navigator, { clipboard: { writeText: async () => { throw new Error("denied"); } } });
    mount("/events/2025/FTCCMP1EDIS/overlay");
    fireEvent.click(screen.getByRole("button", { name: /Copy link for OBS/ }));
    const box = await screen.findByRole("textbox");
    expect((box as HTMLInputElement).value).toBe(`${window.location.origin}/events/2025/FTCCMP1EDIS/overlay?clean=1`);
  });
  it("in OBS, or with ?clean=1: the bare overlay only", () => {
    (window as unknown as { obsstudio: unknown }).obsstudio = { pluginVersion: "2.24" };
    mount("/events/2025/FTCCMP1EDIS/overlay");
    expect(document.querySelector("[data-overlay-preview]")).toBeNull();
    expect(document.querySelector("[data-overlay]")).toBeTruthy();
    cleanup();
    delete (window as unknown as { obsstudio?: unknown }).obsstudio;
    mount("/events/2025/FTCCMP1EDIS/overlay?clean=1");
    expect(document.querySelector("[data-overlay-preview]")).toBeNull();
    expect(screen.queryByRole("link", { name: /Back to event/ })).toBeNull();
  });
});
