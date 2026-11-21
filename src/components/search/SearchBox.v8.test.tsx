// @vitest-environment jsdom
// The search box in v8 (docs/design/v8-revamp-brief.md §4.2, §5): the field on surface-3 with the line-strong
// hairline; the dropdown on the menu surface, grown from the field only when it opens on typed results (opening
// search, an empty field's list, shows at once); no bouncing "more below" icon. v8 off keeps Motion's drop and the bounce.
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

// jsdom has no layout: a 100px list over rows 50px apart, so "more below" shows.
const props: [string, PropertyDescriptor][] = [
  ["clientHeight", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "listbox" ? 100 : 0; } }],
  ["scrollHeight", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "listbox" ? 150 : 0; } }],
  ["offsetTop", { configurable: true, get() { return Number((this as HTMLElement).id.split("-").at(-1) || 0) * 50; } }],
  ["offsetHeight", { configurable: true, get() { return 40; } }],
];
const saved = props.map(([k]) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
beforeEach(() => {
  for (const [k, d] of props) Object.defineProperty(HTMLElement.prototype, k, d);
  Element.prototype.scrollBy = (() => {}) as unknown as Element["scrollBy"];
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  for (const [k, d] of saved) if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
});

async function typed() {
  const { container } = render(<SearchBox onPick={() => {}} placeholder="Search" label="Search" />);
  const input = screen.getByLabelText("Search") as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "bit" } });
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4), { timeout: 4000 });
  return container;
}

describe("search box, v8 on", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => document.documentElement.removeAttribute("data-v8"));

  it("puts the field on surface-3 with the line-strong hairline", () => {
    const { container } = render(<SearchBox onPick={() => {}} placeholder="Search" label="Search" />);
    const field = container.querySelector("[data-search-box] > div")!;
    expect(field.className).toContain("v8:bg-muted");
    expect(field.className).toContain("v8:border-input");
  });

  it("grows the dropdown from the field on typed results: 0.97, 180ms, ease-out, a fade only under reduced motion", async () => {
    const container = await typed();
    const panel = container.querySelector("[data-drop-panel]")!;
    expect(panel).toBeTruthy();
    expect(panel.hasAttribute("data-grow")).toBe(true);
    for (const c of ["animate-in", "fade-in-0", "[--tw-enter-scale:0.97]", "duration-[180ms]", "ease-out", "motion-reduce:[--tw-enter-scale:1]", "v8:origin-top", "bg-popover"]) expect(panel.className).toContain(c);
  });

  it("highlights the top hit as soon as results are in, clearly, and Enter goes straight to it", async () => {
    const onPick = vi.fn();
    render(<SearchBox onPick={onPick} placeholder="Search" label="Search" />);
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "bit" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4), { timeout: 4000 });
    const top = screen.getByRole("option", { name: /Bit by Bit/ });
    await waitFor(() => expect(top.getAttribute("aria-selected")).toBe("true"));
    expect(top.className).toContain("v8:shadow-[inset_2px_0_0_var(--color-accent)]");
    expect(input.getAttribute("aria-activedescendant")).toBe(top.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(HITS[0]);
  });

  it("drops the bouncing more-below icon", async () => {
    const container = await typed();
    await screen.findByRole("button", { name: /more below/ });
    const chevron = container.querySelector("[data-more-chevron]")!;
    expect(chevron.getAttribute("class")).not.toContain("animate-bounce");
  });

  it("opens search with no animation: the empty field's list shows at once", async () => {
    const { container } = render(<SearchBox onPick={() => {}} placeholder="Search" label="Search" discover examples />);
    const input = screen.getByLabelText("Search");
    act(() => input.focus());
    const panel = await waitFor(() => { const p = container.querySelector("[data-drop-panel]"); expect(p).toBeTruthy(); return p!; });
    expect(panel.hasAttribute("data-grow")).toBe(false);
    expect(panel.className).not.toContain("animate-in");
    // The example chips: picked is white on white/10, never mint.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const picked = container.querySelector('[data-example][aria-selected="true"]');
    if (picked) expect(picked.className).toContain("v8:bg-white/10");
  });
});

describe("search box, v8 off", () => {
  it("highlights nothing until the keys or the pointer pick a row", async () => {
    await typed();
    expect(screen.getAllByRole("option").some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
  });

  it("keeps Motion's drop (no v8 panel) and the bouncing more-below icon", async () => {
    const container = await typed();
    expect(container.querySelector("[data-drop-panel]")).toBeNull();
    await screen.findByRole("button", { name: /more below/ });
    expect(container.querySelector("[data-more-chevron]")!.getAttribute("class")).toContain("motion-safe:animate-bounce");
  });
});
