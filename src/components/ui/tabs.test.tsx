// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { stripFade, Tabs, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

describe("stripFade: which edge of a sideways-scrolling tab strip fades", () => {
  it("fades nothing when every tab fits", () => {
    expect(stripFade({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toBeUndefined();
    expect(stripFade({ scrollLeft: 0, scrollWidth: 301, clientWidth: 300 })).toBeUndefined(); // sub-pixel rounding
  });
  it("fades the end at the start, both ends midway, and the start at the end", () => {
    expect(stripFade({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toBe("end");
    expect(stripFade({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toBe("both");
    expect(stripFade({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toBe("start");
  });
});

describe("TabsList edge fade", () => {
  it("rechecks when its tabs grow without the strip resizing (e.g. counts loading in)", async () => {
    let width = 300;
    const strip = (count: string) => (
      <Tabs value="a">
        <TabsList data-testid="list">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B {count}</TabsTrigger>
        </TabsList>
      </Tabs>
    );
    const { getByTestId, rerender } = render(strip(""));
    const list = getByTestId("list");
    Object.defineProperty(list, "clientWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => width });
    expect(list.dataset.fade).toBeUndefined();
    // The counts arrive: the tabs now overflow, the strip's own box is unchanged.
    width = 480;
    act(() => rerender(strip("12")));
    await waitFor(() => expect(list.dataset.fade).toBe("end"));
  });
});
