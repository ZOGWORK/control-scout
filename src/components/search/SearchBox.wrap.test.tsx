// @vitest-environment jsdom
// The site's search bar (`wrap`): a long query rests on one line, fading where it runs on; clicking into it grows the
// field over the page (the page under it keeps its place) to show the whole query wrapped, the caret at its end; it
// shrinks back to one line when focus leaves. Still the list's combobox, still one line of query: Enter (and
// Shift+Enter) search and never type a line break, and a pasted paragraph becomes one line.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: () => new Promise(() => {}) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, oneLine } = await import("./SearchBox");
const { focusForEditing } = await import("../../lib/focusField");

const LONG = "quality control average auto opr in their last meet in the decode season";

beforeEach(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => cleanup());

function mount(extra: Partial<Parameters<typeof SearchBox>[0]> = {}) {
  const onPick = vi.fn();
  const { container } = render(<><SearchBox onPick={onPick} placeholder="Search" label="Search" wrap syncQuery={LONG} {...extra} /><button>elsewhere</button></>);
  const field = screen.getByRole("combobox", { name: "Search" }) as HTMLTextAreaElement;
  const row = container.querySelector<HTMLElement>("[data-search-field]")!;
  const frame = container.querySelector<HTMLElement>("[data-search-frame]")!;
  const layer = container.querySelector<HTMLElement>("[data-search-layer]")!;
  return { field, row, frame, layer, onPick };
}
/** A click into the field as a browser sends it: the press focuses it, then the click. */
function clickInto(el: HTMLElement) {
  fireEvent.pointerDown(el);
  act(() => el.focus());
  fireEvent.click(el);
}

describe("the search bar grows to show a long query while it's edited", () => {
  it("is a textarea that is still the list's combobox", () => {
    const { field } = mount();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.getAttribute("aria-autocomplete")).toBe("list");
    expect(field.getAttribute("aria-controls")).toBeTruthy();
    expect(field.getAttribute("aria-expanded")).toBe("false");
    expect(field.value).toBe(LONG);
  });

  it("rests on one line: no wrapping, its start showing", () => {
    const { field, row, layer } = mount();
    expect(field.getAttribute("wrap")).toBe("off");
    expect(field.className).toContain("whitespace-pre");
    expect(field.className).toContain("overflow-hidden");
    expect(row.hasAttribute("data-grown")).toBe(false);
    expect(layer.className).not.toContain("absolute");
  });

  it("grows over the page when clicked into, wrapping, with the caret at the very end; shrinks back when focus leaves", () => {
    const { field, row, frame, layer } = mount();
    clickInto(field);
    expect(row.hasAttribute("data-grown")).toBe(true);
    expect(field.getAttribute("wrap")).toBe("soft");
    expect(field.className).toContain("whitespace-pre-wrap");
    // Over the page: the layer lies on top, and the frame keeps the resting height in the page's flow.
    expect(layer.className).toContain("absolute");
    expect(layer.className).toContain("z-50");
    expect(frame.style.height).toMatch(/px$/);
    expect(row.style.height).toBe("auto");
    expect(field.selectionStart).toBe(LONG.length);
    expect(field.selectionEnd).toBe(LONG.length);

    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    expect(row.hasAttribute("data-grown")).toBe(false);
    expect(field.getAttribute("wrap")).toBe("off");
    expect(layer.className).not.toContain("absolute");
    expect(frame.style.height).toBe("");
  });

  it("puts the caret at the end on the click even where the press placed it elsewhere", () => {
    const { field } = mount();
    fireEvent.pointerDown(field);
    act(() => field.focus());
    // The browser places the caret where the press landed, after focus.
    field.setSelectionRange(3, 3);
    fireEvent.click(field);
    expect(field.selectionStart).toBe(LONG.length);
    // A later click inside the focused field places the caret as usual.
    field.setSelectionRange(5, 5);
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(field.selectionStart).toBe(5);
  });

  it("a press released outside the grown field still ends with the caret at the end, and a later click places it as usual", async () => {
    const { field } = mount();
    fireEvent.pointerDown(field);
    act(() => field.focus());
    field.setSelectionRange(3, 3);
    // The release lands on the page (the field grew under the pointer): no click reaches the field.
    fireEvent.pointerUp(document.body);
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(field.selectionStart).toBe(LONG.length);
    // The next click inside the focused field is an ordinary one.
    field.setSelectionRange(5, 5);
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(field.selectionStart).toBe(5);
  });

  it("the search shortcut still selects the whole query (typing replaces it)", () => {
    const { field } = mount();
    act(() => focusForEditing(field, { touch: false }));
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LONG.length);
  });

  it("eases the grow (150ms) only when motion is allowed", () => {
    const { field } = mount();
    clickInto(field);
    for (const c of ["motion-safe:transition-[height]", "motion-safe:duration-150", "motion-safe:ease-out"]) expect(field.className).toContain(c);
    expect(field.className).not.toMatch(/(^|\s)transition-\[height\]/);
  });

  it("Enter and Shift+Enter search and never type a line break", () => {
    const { field, onPick } = mount();
    clickInto(field);
    fireEvent.change(field, { target: { value: "4215 record" } });
    expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(false);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=4215%20record");
  });

  it("Enter on an empty field types no line break either", () => {
    const { field } = mount({ syncQuery: undefined });
    clickInto(field);
    expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
    expect(field.value).toBe("");
  });

  it("a pasted paragraph becomes one line", () => {
    const { field } = mount({ syncQuery: undefined });
    clickInto(field);
    fireEvent.change(field, { target: { value: "quality control\naverage auto opr\r\n\r\n  in their last meet\n" } });
    expect(field.value).toBe("quality control average auto opr in their last meet ");
  });

  it("Escape closes the list and stays in the grown field; focus leaving shrinks it", () => {
    const { field, row } = mount({ syncQuery: undefined });
    clickInto(field);
    fireEvent.change(field, { target: { value: "bit" } });
    expect(field.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(field);
    expect(row.hasAttribute("data-grown")).toBe(true);
    act(() => field.blur());
    expect(row.hasAttribute("data-grown")).toBe(false);
  });

  it("clearing keeps focus in the grown field (the press doesn't take it)", () => {
    const { field, row } = mount();
    clickInto(field);
    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(fireEvent.pointerDown(clear)).toBe(false);
    expect(fireEvent.mouseDown(clear)).toBe(false);
    fireEvent.click(clear);
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect(row.hasAttribute("data-grown")).toBe(true);
  });

  it("the suggestions list opens under the grown field, inside the layer that lies over the page", () => {
    const { field, layer } = mount({ syncQuery: undefined, examples: true });
    clickInto(field);
    const list = screen.getByRole("listbox");
    expect(layer.contains(list)).toBe(true);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(field.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
  });
});

describe("other search boxes", () => {
  it("stay a one-line input", () => {
    render(<SearchBox onPick={() => {}} placeholder="Find a team" label="Find a team" kinds={["team"]} />);
    expect(screen.getByRole("combobox", { name: "Find a team" }).tagName).toBe("INPUT");
  });
});

describe("oneLine", () => {
  it("turns line breaks, and the spaces around them, into one space", () => {
    expect(oneLine("a\nb")).toBe("a b");
    expect(oneLine("a  \r\n\r\n  b")).toBe("a b");
    expect(oneLine("a  b")).toBe("a  b");
    expect(oneLine("no breaks")).toBe("no breaks");
  });
});
