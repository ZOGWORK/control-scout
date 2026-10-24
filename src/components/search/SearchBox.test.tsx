// @vitest-environment jsdom
// Tapping a result: the press must not take focus from the field, or the list closes
// (on blur) before the click lands and nothing opens. On an iPhone a tap still sends
// mousedown after a cancelled pointerdown, so rows and the "more below" button cancel both.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../../shared/api";

const HITS = [
  { kind: "team", ref: "19477", title: "19477 Bit by Bit", subtitle: "Tenafly, NJ, USA", season: 2026 },
  { kind: "team", ref: "16000", title: "16000 Team Two", subtitle: "Edison, NJ, USA", season: 2026 },
  { kind: "event", ref: "2026:USTXAMS", title: "Amarillo Scrimmage", subtitle: "Amarillo, TX", season: 2026 },
] as SearchHit[];
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: async () => ({ hits: HITS }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { SearchBox } = await import("./SearchBox");

// jsdom has no layout: give the list a 100px window over 3 rows 50px apart, so the last row is "below".
const props: [string, PropertyDescriptor][] = [
  ["clientHeight", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "listbox" ? 100 : 0; } }],
  ["scrollHeight", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "listbox" ? 150 : 0; } }],
  ["offsetTop", { configurable: true, get() { return Number((this as HTMLElement).id.split("-").at(-1) || 0) * 50; } }],
  ["offsetHeight", { configurable: true, get() { return 40; } }],
];
const saved = props.map(([k]) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
const scrollBy = vi.fn();
beforeEach(() => {
  for (const [k, d] of props) Object.defineProperty(HTMLElement.prototype, k, d);
  Element.prototype.scrollBy = scrollBy as unknown as Element["scrollBy"];
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  for (const [k, d] of saved) if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  scrollBy.mockReset();
});

async function openWith(onPick: (h: SearchHit) => void) {
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" />);
  const input = screen.getByLabelText("Search") as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "bit" } });
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
  return input;
}

describe("SearchBox taps", () => {
  it("a result row cancels pointerdown and mousedown, and its click picks the result", async () => {
    const onPick = vi.fn();
    const input = await openWith(onPick);
    const row = screen.getByRole("option", { name: /Bit by Bit/ });
    expect(fireEvent.pointerDown(row)).toBe(false);
    expect(fireEvent.mouseDown(row)).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(HITS[0]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the more-below button cancels both presses and scrolls without closing the list", async () => {
    const onPick = vi.fn();
    const input = await openWith(onPick);
    const more = await screen.findByRole("button", { name: /1 more below/ });
    expect(fireEvent.pointerDown(more)).toBe(false);
    expect(fireEvent.mouseDown(more)).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.click(more);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });
});
