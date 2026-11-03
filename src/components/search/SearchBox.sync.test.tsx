// @vitest-environment jsdom
// On the full results page the top bar holds the query (Requirement 17.4): it shows /search's ?q, follows it when
// it changes, isn't searched again until edited (the page already shows its results), and refines from there.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS } = await import("./SearchBox");
const { GlobalSearch, SearchProvider } = await import("../layout/Search");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; localStorage.clear(); });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });

describe("a box holding the page's query (syncQuery)", () => {
  it("shows it, asks nothing for it, opens no list for it; follows it when it changes", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<SearchBox onPick={onPick} placeholder="Search" label="Search" syncQuery="meets in New Jersey" />);
    const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
    expect(input.value).toBe("meets in New Jersey");
    act(() => input.focus());
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    expect(pending).toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<SearchBox onPick={onPick} placeholder="Search" label="Search" syncQuery="4215 vs 6980" />);
    expect(input.value).toBe("4215 vs 6980");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("refines from there: an edit searches, Enter opens /search for the new text; Enter unedited runs it again", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} placeholder="Search" label="Search" syncQuery="meets in New Jersey" />);
    const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "Enter" });
    // Pressed, the page's query is asked for (it might name one team), with no typing pause.
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=meets%20in%20New%20Jersey")]);
    await act(async () => { pending.splice(0, 1)[0].resolve({ q: "meets in New Jersey", hits: [], pages: [], step: "deterministic", weak: false }); });
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=meets%20in%20New%20Jersey" }));
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    expect(pending).toHaveLength(0); // back to holding the page's query: not asked again
    expect(input.value).toBe("meets in New Jersey"); // kept: the page it lands on is the same query
    fireEvent.change(input, { target: { value: "upcoming meets in New Jersey" } });
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    expect(pending.map((p) => p.url)).toEqual([expect.stringContaining("q=upcoming%20meets%20in%20New%20Jersey")]);
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => { pending.splice(0, 1)[0].resolve({ q: "upcoming meets in New Jersey", hits: [], pages: [], step: "deterministic", weak: false }); });
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ href: "/search?q=upcoming%20meets%20in%20New%20Jersey" }));
  });
});

describe("the top bar", () => {
  function Go({ to }: { to: string }) { const nav = useNavigate(); return <button type="button" onClick={() => nav(to)}>go {to}</button>; }
  const mount = (at: string) => render(
    <MemoryRouter initialEntries={[at]}>
      <SearchProvider>
        <GlobalSearch part="field" />
        <Routes><Route path="*" element={<><Go to="/search?q=4215%20record" /><Go to="/teams/4215" /></>} /></Routes>
      </SearchProvider>
    </MemoryRouter>,
  );
  it("holds /search's query, follows it, and lets it go on other pages", () => {
    mount("/search?q=meets%20in%20New%20Jersey");
    const input = screen.getByRole("combobox", { name: "Search teams, events and matches" }) as HTMLInputElement;
    expect(input.value).toBe("meets in New Jersey");
    fireEvent.click(screen.getByRole("button", { name: "go /search?q=4215%20record" }));
    expect(input.value).toBe("4215 record");
    fireEvent.click(screen.getByRole("button", { name: "go /teams/4215" }));
    expect(input.value).toBe("");
  });
  it("holds it on any spelling of the path the router serves (/Search/)", () => {
    mount("/Search/?q=4215");
    expect((screen.getByRole("combobox", { name: "Search teams, events and matches" }) as HTMLInputElement).value).toBe("4215");
  });
  it("is empty on other pages", () => {
    mount("/teams/4215");
    expect((screen.getByRole("combobox", { name: "Search teams, events and matches" }) as HTMLInputElement).value).toBe("");
  });
});
