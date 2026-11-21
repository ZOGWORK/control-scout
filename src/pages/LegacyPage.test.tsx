// @vitest-environment jsdom
// /legacy: pick the new look or the classic one; the choice is stored ("1" or "0") so it holds after the default flips.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LegacyPage from "./LegacyPage";
import { V8_KEY } from "../lib/v8";

const assign = vi.fn();
vi.stubGlobal("location", { ...window.location, assign, reload: vi.fn() });
afterEach(() => { cleanup(); localStorage.clear(); assign.mockClear(); document.documentElement.removeAttribute("data-v8"); });
const page = () => render(<MemoryRouter><LegacyPage /></MemoryRouter>);

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
});
