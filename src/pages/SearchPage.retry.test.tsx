// @vitest-environment jsdom
// A failed search offers Try again, which repeats the search; while that retry is on its way the button is off,
// so a second press can't send the same search twice.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const hits = vi.hoisted(() => ({ busy: false, retry: vi.fn(), searchNow: vi.fn() }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: [], answer: undefined, busy: hits.busy, error: "Can't reach the server right now.", retry: hits.retry, searchNow: hits.searchNow, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null }));

const { default: SearchPage } = await import("./SearchPage");

afterEach(() => { cleanup(); hits.retry.mockReset(); hits.searchNow.mockReset(); hits.busy = false; });
const show = () => render(<MemoryRouter initialEntries={["/search?q=4215"]}><SearchPage /></MemoryRouter>);

describe("search results page, server not answering", () => {
  it("offers Try again, which repeats the search", () => {
    show();
    expect(screen.getByText("Can't reach the server right now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(hits.retry).toHaveBeenCalledTimes(1);
  });

  it("turns Try again off while the retry is on its way", () => {
    hits.busy = true;
    show();
    const again = screen.getByRole("button", { name: /Try again/ }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    fireEvent.click(again);
    expect(hits.retry).not.toHaveBeenCalled();
  });

  it("Enter searches now and closes the keyboard", () => {
    show();
    const input = screen.getByRole("searchbox", { name: "Search teams, events and matches" }) as HTMLInputElement;
    input.focus();
    fireEvent.submit(input.form!);
    expect(hits.searchNow).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });
});
