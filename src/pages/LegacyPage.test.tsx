// @vitest-environment jsdom
// /legacy: the owner picks the new look or the classic one; the choice is stored ("1" or "0") so it holds after the
// default flips. Anyone else is sent Home (src/lib/ownerLook.tsx), and nothing shows before the server has answered.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const who = vi.hoisted(() => ({ user: { isOwner: true } as { isOwner?: true } | null, accountAnswered: true, offlineAccount: false }));
vi.mock("../lib/personal", () => ({ usePersonal: () => who }));
const { default: LegacyPage } = await import("./LegacyPage");
import { V8_KEY } from "../lib/v8";

const assign = vi.fn();
vi.stubGlobal("location", { ...window.location, assign, reload: vi.fn() });
afterEach(() => { cleanup(); localStorage.clear(); assign.mockClear(); document.documentElement.removeAttribute("data-v8"); Object.assign(who, { user: { isOwner: true }, accountAnswered: true, offlineAccount: false }); });
const page = () => render(<MemoryRouter initialEntries={["/legacy"]}><Routes><Route path="/legacy" element={<LegacyPage />} /><Route path="/" element={<p>home</p>} /></Routes></MemoryRouter>);

describe("LegacyPage", () => {
  it("in the classic look, offers the new one and stores the choice", () => {
    page();
    expect(screen.getByText("In use").closest("[data-look]")!.getAttribute("data-look")).toBe("classic");
    fireEvent.click(screen.getByRole("button", { name: "Use new look" }));
    expect(localStorage.getItem(V8_KEY)).toBe("1");
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("in the new look, offers the classic one and stores it as an explicit choice", () => {
    document.documentElement.setAttribute("data-v8", "");
    page();
    fireEvent.click(screen.getByRole("button", { name: "Use classic look" }));
    expect(localStorage.getItem(V8_KEY)).toBe("0");
  });

  it("with storage blocked, still switches for the next load through ?v8=", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    page();
    fireEvent.click(screen.getByRole("button", { name: "Use new look" }));
    expect(assign).toHaveBeenCalledWith("/?v8=1");
    set.mockRestore();
  });

  it("sends anyone but the owner Home, signed in or not", () => {
    for (const user of [null, {}]) {
      Object.assign(who, { user });
      page();
      expect(screen.getByText("home")).toBeTruthy();
      expect(screen.queryByText("Pick a look")).toBeNull();
      cleanup();
    }
  });

  it("shows nothing until the server has said who's here, or while the account is the offline copy", () => {
    Object.assign(who, { accountAnswered: false });
    page();
    expect(screen.queryByText("Pick a look")).toBeNull();
    expect(screen.queryByText("home")).toBeNull();
    cleanup();
    Object.assign(who, { accountAnswered: true, offlineAccount: true });
    page();
    expect(screen.queryByText("Pick a look")).toBeNull();
    expect(screen.queryByText("home")).toBeNull();
  });
});
