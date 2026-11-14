// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isShown } from "./visible";

/** jsdom lays nothing out: give an element a size, as a browser would. */
function sized(el: HTMLElement, w = 100, h = 20): HTMLElement {
  el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}
const add = (html: string) => { const box = document.createElement("div"); box.innerHTML = html; document.body.append(box); return box; };

afterEach(() => { document.body.innerHTML = ""; });

describe("isShown", () => {
  it("a laid-out, visible element is shown", () => {
    const el = sized(add("<p>hi</p>").querySelector("p")!);
    expect(isShown(el)).toBe(true);
  });

  it("not when detached, zero-sized, hidden or display:none", () => {
    expect(isShown(sized(document.createElement("p")))).toBe(false);
    expect(isShown(sized(add("<p>x</p>").querySelector("p")!, 0, 0))).toBe(false);
    expect(isShown(sized(add('<p style="visibility:hidden">x</p>').querySelector("p")!))).toBe(false);
    expect(isShown(sized(add('<p style="display:none">x</p>').querySelector("p")!))).toBe(false);
  });

  it("not inside something inert or aria-hidden (a modal's background)", () => {
    expect(isShown(sized(add("<div inert><p>x</p></div>").querySelector("p")!))).toBe(false);
    expect(isShown(sized(add('<div aria-hidden="true"><p>x</p></div>').querySelector("p")!))).toBe(false);
  });
});
