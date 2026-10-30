// @vitest-environment jsdom
// The rules quick reference page: the revision stamp and the "unofficial, check the manual" note with its link
// are always there; the section browser lists the manual's sections; search narrows the rules in the browser
// (no fetch at all) and says when nothing matches.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ruleReference } from "../shared/rules";

vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
const { default: RulesPage } = await import("./RulesPage");
const mount = (url = "/rules") => render(<MemoryRouter initialEntries={[url]}><RulesPage /></MemoryRouter>);
const ref = ruleReference(2026);
const fetchSpy = vi.fn();
beforeEach(() => { fetchSpy.mockReset(); vi.stubGlobal("fetch", fetchSpy); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Rules page", () => {
  it("shows the revision stamp and the unofficial note linking the official manual", () => {
    mount();
    const stamp = document.querySelector("[data-rules-stamp]") as HTMLElement;
    expect(within(stamp).getByText(ref.manual.revision)).toBeTruthy();
    expect(stamp.textContent).toContain("Oct 29, 2026");
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/Unofficial summaries: check the official manual/);
    expect(within(note).getByRole("link", { name: /Official manual/ }).getAttribute("href")).toBe(ref.manual.url);
  });

  it("lists every section in the browser and every rule and ruling", () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "Manual sections" });
    for (const s of ref.sections.filter((x) => ref.rules.some((r) => r.section === x.id))) expect(within(nav).getAllByText(s.title).length).toBeGreaterThan(0);
    expect(document.querySelectorAll("li[id]").length).toBe(ref.rules.length + ref.rulings.length);
    expect(screen.getAllByText("Unofficial guidance").length).toBe(ref.rulings.length);
  });

  it("search narrows the list locally, with no request", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search the rules"), { target: { value: "pin" } });
    expect(document.getElementById("G421")).toBeTruthy();
    expect(document.getElementById("R601")).toBeNull();
    expect(screen.getByText(/matches?:/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says when nothing matches and offers the official manual", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search the rules"), { target: { value: "zzqx" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the manual/ }).getAttribute("href")).toBe(ref.manual.htmlUrl);
  });

  it("an unknown season says so and shows the newest reference", () => {
    mount("/rules?season=2019");
    expect(screen.getByText(/No quick reference for that season yet/)).toBeTruthy();
  });
});
