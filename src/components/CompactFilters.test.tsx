// @vitest-environment jsdom
// The phone filter row and its sheet: chips say what's on and each one removes its filter from the URL
// (focus moving to the next chip, then the Filters button); the sheet opens from the Filters button, keeps
// focus inside, closes on Escape or Done and hands focus back to the button; a follow-up asked for on
// close (open the filter builder) runs once focus is back.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate, useSearchParams, type NavigateFunction } from "react-router-dom";
import { CompactFilters, FilterSection, useCompactFilters, type FilterChip } from "./CompactFilters";

let loc = "";
let nav: NavigateFunction;
function Probe() { loc = useLocation().search; nav = useNavigate(); return null; }

/** A list page's filters as a test drives them: ?place= and ?type= in the URL, one chip each. */
function Harness({ onFollowUp }: { onFollowUp?: () => void }) {
  const [sp, setSp] = useSearchParams();
  const drop = (k: string) => setSp((x) => { x.delete(k); return x; });
  const chips: FilterChip[] = [];
  for (const k of ["place", "type"]) {
    const v = sp.get(k);
    if (v) chips.push({ id: k, label: v, name: `${k}: ${v}`, onRemove: () => drop(k) });
  }
  return (
    <CompactFilters lead={<button type="button">2025–26</button>} chips={chips} summary="12 events" doneLabel="Show 12 events"
      onClearAll={() => setSp(new URLSearchParams())}>
      {(close) => (
        <FilterSection label="Where">
          <button type="button" onClick={() => setSp((x) => { x.set("place", "Texas"); return x; })}>Texas</button>
          <button type="button" onClick={() => close(onFollowUp)}>Edit conditions</button>
        </FilterSection>
      )}
    </CompactFilters>
  );
}

const mount = (url = "/events", onFollowUp?: () => void) =>
  render(<MemoryRouter initialEntries={[url]}><Harness onFollowUp={onFollowUp} /><Probe /></MemoryRouter>);
// (hidden: true, as the open sheet hides the page from assistive tech.)
const filtersButton = () => screen.getByRole("button", { name: /^Filters/, hidden: true });
// Focus moves after the next frame.
const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

beforeEach(() => { loc = ""; });
afterEach(() => cleanup());

describe("CompactFilters row", () => {
  it("shows a chip per filter that's on, and the count on the Filters button", () => {
    mount("/events?place=Texas&type=Qualifier");
    const list = screen.getByRole("list", { name: "Filters on" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove filter: place: Texas" })).toBeTruthy();
    expect(filtersButton().getAttribute("aria-label")).toBe("Filters, 2 on");
  });

  it("with nothing on, shows no chip list and a plain Filters button", () => {
    mount();
    expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
    expect(filtersButton().getAttribute("aria-label")).toBe("Filters");
    expect(filtersButton().textContent).toContain("Filters");
  });

  it("removing a chip takes its filter out of the URL and moves focus to the next chip", async () => {
    mount("/events?place=Texas&type=Qualifier&season=2025");
    const chip = screen.getByRole("button", { name: "Remove filter: place: Texas" });
    chip.focus();
    fireEvent.click(chip);
    expect(new URLSearchParams(loc).get("place")).toBeNull();
    expect(new URLSearchParams(loc).get("type")).toBe("Qualifier");
    expect(new URLSearchParams(loc).get("season")).toBe("2025"); // the rest of the URL stays
    await frame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove filter: type: Qualifier" }));
  });

  it("removing the last chip moves focus to the Filters button", async () => {
    mount("/events?type=Qualifier");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: type: Qualifier" }));
    expect(loc).toBe("");
    await frame();
    expect(document.activeElement).toBe(filtersButton());
  });

  it("follows Back and Forward: the chips are the URL's", () => {
    mount("/events");
    act(() => nav("/events?place=Ohio"));
    expect(screen.getByRole("button", { name: "Remove filter: place: Ohio" })).toBeTruthy();
    act(() => nav(-1));
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
    act(() => nav(1));
    expect(screen.getByRole("button", { name: "Remove filter: place: Ohio" })).toBeTruthy();
  });
});

describe("CompactFilters sheet", () => {
  it("opens from the Filters button with every control, focus inside, and the summary", async () => {
    mount();
    const button = filtersButton();
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    expect(dialog.textContent).toContain("12 events");
    expect(screen.getByRole("button", { name: "Texas" })).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("a control in the sheet changes the URL straight away, and the chip appears", async () => {
    mount();
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: "Texas" }));
    expect(new URLSearchParams(loc).get("place")).toBe("Texas");
    expect(filtersButton().getAttribute("aria-label")).toBe("Filters, 1 on");
  });

  it("Escape closes it and focus goes back to the Filters button", async () => {
    mount();
    const button = filtersButton();
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("Done closes it and focus goes back to the Filters button", async () => {
    mount();
    const button = filtersButton();
    button.focus();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Show 12 events" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("Clear filters empties the URL's filters (offered only while one is on)", async () => {
    mount("/events?place=Texas&type=Qualifier");
    fireEvent.click(filtersButton());
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    fireEvent.click(clear);
    expect(loc).toBe("");
    expect((screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a follow-up asked for on close runs after focus is back on the Filters button", async () => {
    let focusedThen: Element | null = null;
    const followUp = vi.fn(() => { focusedThen = document.activeElement; });
    mount("/events", followUp);
    const button = filtersButton();
    button.focus();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Edit conditions" }));
    await waitFor(() => expect(followUp).toHaveBeenCalledTimes(1));
    expect(focusedThen).toBe(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("useCompactFilters", () => {
  function Show() { return <p>{useCompactFilters() ? "phone" : "wide"}</p>; }
  afterEach(() => vi.unstubAllGlobals());

  it("is on under 768px and follows the window", () => {
    let listener: (() => void) | null = null;
    const m = { matches: true, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: () => {} };
    const mm = vi.fn(() => m);
    vi.stubGlobal("matchMedia", mm);
    render(<Show />);
    expect(mm).toHaveBeenCalledWith("(max-width: 767px)");
    expect(screen.getByText("phone")).toBeTruthy();
    m.matches = false;
    act(() => listener!());
    expect(screen.getByText("wide")).toBeTruthy();
  });

  it("is off where there's no matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Show />);
    expect(screen.getByText("wide")).toBeTruthy();
  });
});
