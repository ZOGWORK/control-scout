// @vitest-environment jsdom
// Ctrl+K into the top-bar search, then Escape out of it: focus goes back to where it was, not to the page body.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: async () => ({ hits: [] }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { GlobalSearch, SearchProvider } = await import("./Search");

afterEach(cleanup);

describe("top-bar search focus", () => {
  it("Escape on the empty field returns focus to the control it was opened from", async () => {
    render(<MemoryRouter><SearchProvider><button type="button">Filters</button><GlobalSearch part="field" /></SearchProvider></MemoryRouter>);
    const from = screen.getByRole("button", { name: "Filters" });
    from.focus();
    act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
    const field = screen.getByRole("combobox", { name: "Search teams, events and matches" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" }); // closes the list
    fireEvent.keyDown(field, { key: "Escape" }); // empty and closed: leaves the field
    expect(document.activeElement).toBe(from);
  });
});
