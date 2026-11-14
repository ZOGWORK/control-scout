// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusForEditing, touchFirst } from "./focusField";

const media = (coarse: boolean, fine: boolean) => ({
  matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" ? coarse : q === "(any-pointer: fine)" ? fine : false }) as MediaQueryList,
});

describe("touchFirst", () => {
  it("a phone (coarse pointer, no mouse) is touch-first", () => expect(touchFirst(media(true, false))).toBe(true));
  it("a laptop is not", () => expect(touchFirst(media(false, true))).toBe(false));
  it("a touch laptop with a trackpad is not: it keeps select-all", () => expect(touchFirst(media(true, true))).toBe(false));
  it("no window (server render) is not", () => expect(touchFirst(undefined)).toBe(false));
});

describe("focusForEditing", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  const field = (value: string) => {
    const el = document.createElement("input");
    el.value = value;
    document.body.append(el);
    return el;
  };

  it("mouse or keyboard: focused with the whole query selected, so typing replaces it", () => {
    const el = field("teams in new jersey");
    focusForEditing(el, { touch: false });
    expect(document.activeElement).toBe(el);
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 19]);
  });

  it("touch: focused with a caret at the end, nothing selected (an iPhone tap on a selection only offers Cut/Copy/Paste)", () => {
    const el = field("teams in new jersey");
    focusForEditing(el, { touch: true });
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(19);
    expect(el.selectionEnd).toBe(19);
  });

  it("opening it again on touch never selects: the caret stays a caret", () => {
    const el = field("abc");
    focusForEditing(el, { touch: true });
    el.setSelectionRange(1, 1);
    focusForEditing(el, { touch: true });
    expect(el.selectionStart).toBe(el.selectionEnd);
  });

  it("no field: nothing happens", () => expect(() => focusForEditing(null)).not.toThrow());
});
