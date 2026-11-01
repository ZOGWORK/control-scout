// @vitest-environment jsdom
// The Shortlist's add box: suggestions from the site's team search, a pick or Enter adds the team once, an exact
// number adds on Enter or the button (even while its search is still on its way), and a listed team is never added twice.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../../shared/api";

const t = (ref: string, name: string): SearchHit => ({ kind: "team", ref, title: `${ref} ${name}`, subtitle: "Oradell, NJ, USA", season: 2026 });

const pending: { url: string; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));

const { AddTeamBox, exactNumber } = await import("./AddTeamBox");
const { SEARCH_DEBOUNCE_MS } = await import("../search/SearchBox");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });

function mount(listed: number[] = [6980]) {
  const onAdd = vi.fn();
  render(<AddTeamBox listed={listed} onAdd={onAdd} />);
  const input = screen.getByRole("combobox", { name: "Add a team to your shortlist" }) as HTMLInputElement;
  act(() => input.focus());
  return { input, onAdd };
}
const type = async (input: HTMLInputElement, v: string) => { fireEvent.change(input, { target: { value: v } }); await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); }); };
const reply = async (body: unknown) => { const p = pending.shift()!; await act(async () => { p.resolve(body); }); };

describe("AddTeamBox", () => {
  it("asks the team search only for teams, and adds a picked suggestion, then empties for the next", async () => {
    const { input, onAdd } = mount();
    await type(input, "hypno");
    expect(pending[0].url).toMatch(/q=hypno&limit=8&kinds=team/);
    await reply({ hits: [t("4215", "Hypnotic Robotics")] });
    fireEvent.click(screen.getByRole("option", { name: /4215 Hypnotic Robotics/ }));
    expect(onAdd).toHaveBeenCalledWith(4215, expect.objectContaining({ ref: "4215" }));
    expect(input.value).toBe("");
  });

  it("walks the suggestions with the arrow keys and adds the highlighted one on Enter", async () => {
    const { input, onAdd } = mount();
    await type(input, "ro");
    await reply({ hits: [t("4215", "Hypnotic Robotics"), t("31255", "ctrl+r")] });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-1$/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(31255, expect.objectContaining({ ref: "31255" }));
  });

  it("shows a listed team as added and never adds it twice", async () => {
    const { input, onAdd } = mount([6980]);
    await type(input, "6980");
    await reply({ hits: [t("6980", "Bad Wolf")] });
    const row = screen.getByRole("option", { name: /6980 Bad Wolf/ });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toMatch(/Added/);
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: /Add team/ }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("6980 Bad Wolf is already on your shortlist.");
    // The suggestions close so the reason shows (not only to a screen reader).
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").className).not.toMatch(/sr-only/);
  });

  it("adds an exact number with the button, waiting for its search if it's still on its way", async () => {
    const { input, onAdd } = mount();
    fireEvent.change(input, { target: { value: "33950" } });
    fireEvent.click(screen.getByRole("button", { name: /Add team/ }));
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
    await reply({ hits: [t("3395", "Other"), t("33950", "First Street Kids")] });
    expect(onAdd).toHaveBeenCalledWith(33950, expect.objectContaining({ ref: "33950" }));
  });

  it("says when no team has that number, and takes the number as typed when search can't answer", async () => {
    const { input, onAdd } = mount();
    await type(input, "99999");
    await reply({ hits: [] });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("No team 99999 found.");
    await type(input, "12345");
    await act(async () => { pending.shift()!.reject(new Error("offline")); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(12345, null);
  });

  it("says the list is full instead of adding past its limit", async () => {
    const { input, onAdd } = mount(Array.from({ length: 500 }, (_, i) => i + 1));
    await type(input, "4215");
    await reply({ hits: [t("4215", "Hypnotic Robotics")] });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/full \(500 teams\)/);
  });

  it("reads a plain team number", () => {
    expect(exactNumber(" 4215 ")).toBe(4215);
    expect(exactNumber("4215 hyp")).toBeNull();
    expect(exactNumber("")).toBeNull();
    expect(exactNumber("0")).toBeNull();
    expect(exactNumber("000")).toBeNull();
  });
});
