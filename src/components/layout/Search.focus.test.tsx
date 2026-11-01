// @vitest-environment jsdom
// Ctrl+K into a search field, then Escape out of it: focus goes back to where it was, not to the page body. For the
// top-bar field, the phone's search button (hidden while the field is open), and a page's own search box.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: async () => ({ hits: [] }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { GlobalSearch, SearchProvider } = await import("./Search");
const { NotFoundView } = await import("../NotFoundView");

// jsdom has no scrollIntoView (a page's own box is scrolled to before it takes focus).
Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);
const shortcut = () => act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
const field = () => screen.getByRole("combobox", { name: "Search teams, events and matches" });
// Escape closes the list, then (empty and closed) leaves the field.
const escapeOut = () => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); fireEvent.keyDown(document.activeElement!, { key: "Escape" }); };

describe("search focus", () => {
  it("Escape on the empty top-bar field returns focus to the control it was opened from", async () => {
    render(<MemoryRouter><SearchProvider><button type="button">Filters</button><GlobalSearch part="field" /></SearchProvider></MemoryRouter>);
    const from = screen.getByRole("button", { name: "Filters" });
    from.focus();
    shortcut();
    await waitFor(() => expect(document.activeElement).toBe(field()));
    escapeOut();
    await waitFor(() => expect(document.activeElement).toBe(from));
  });

  it("the shortcut again while in the field keeps the first opener", async () => {
    render(<MemoryRouter><SearchProvider><button type="button">Filters</button><GlobalSearch part="field" /></SearchProvider></MemoryRouter>);
    const from = screen.getByRole("button", { name: "Filters" });
    from.focus();
    shortcut();
    await waitFor(() => expect(document.activeElement).toBe(field()));
    shortcut();
    escapeOut();
    await waitFor(() => expect(document.activeElement).toBe(from));
  });

  it("the phone's search button gets focus back once it shows again", async () => {
    render(<MemoryRouter><SearchProvider><GlobalSearch /></SearchProvider></MemoryRouter>);
    const button = screen.getByRole("button", { name: "Search" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(button.className).toContain("invisible");
    escapeOut();
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(button.className).not.toContain("invisible");
  });

  it("a page's own search box (the not-found page) returns focus too", async () => {
    render(<MemoryRouter><SearchProvider><button type="button">Back</button><NotFoundView /></SearchProvider></MemoryRouter>);
    const from = screen.getByRole("button", { name: "Back" });
    from.focus();
    shortcut();
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("combobox"));
    escapeOut();
    await waitFor(() => expect(document.activeElement).toBe(from));
  });
});
