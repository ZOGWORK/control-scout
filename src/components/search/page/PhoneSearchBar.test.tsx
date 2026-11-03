// @vitest-environment jsdom
// With the top bar's search field open, it drops in right over /search's phone bar: the bar hides then (keeping
// its place), or a second, half-covered search box shows under the field.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SearchProvider, useSearch } from "../../layout/Search";
import { PhoneSearchBar } from "./PhoneSearchBar";

afterEach(cleanup);

let expand: (v: boolean) => void = () => {};
function Opener() { expand = useSearch().setExpanded; return null; }

describe("phone search bar", () => {
  it("hides while the top bar's field is open, and shows again once it closes", () => {
    const { container } = render(<MemoryRouter initialEntries={["/search"]}><SearchProvider><Opener /><PhoneSearchBar query="" /></SearchProvider></MemoryRouter>);
    const bar = container.querySelector("[data-phone-search]")!;
    expect(bar.className).not.toMatch(/\binvisible\b/);
    act(() => expand(true));
    expect(bar.className).toMatch(/\binvisible\b/);
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    act(() => expand(false));
    expect(bar.className).not.toMatch(/\binvisible\b/);
    expect(bar.hasAttribute("aria-hidden")).toBe(false);
  });
});
