// @vitest-environment jsdom
// The owner's dog theme (dogTheme, off by default): ThemeSync tints the page only while the owner has it on, and the
// browser's bar follows the page colour either way.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLAGS } from "../shared/flags";
import { resetFlags } from "../lib/flags";
import { DOG_THEME_COLOR, THEME_COLOR, ThemeSync } from "./useTheme";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { settings: { theme: "dark", density: "comfortable", ambient: true } } }) }));

afterEach(() => { cleanup(); resetFlags(); document.documentElement.className = ""; });

describe("the dog theme", () => {
  it("is off by default: the usual page colour", () => {
    expect(DEFAULT_FLAGS.dogTheme).toBe(false);
    document.head.innerHTML = '<meta name="theme-color" content="">';
    render(<ThemeSync />);
    expect(document.documentElement.classList.contains("dog")).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR.dark);
  });

  it("tints the page while the owner has it on, and stops when they turn it off", () => {
    document.head.innerHTML = '<meta name="theme-color" content="">';
    render(<ThemeSync />);
    act(() => resetFlags({ ...DEFAULT_FLAGS, dogTheme: true }, true));
    expect(document.documentElement.classList.contains("dog")).toBe(true);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(DOG_THEME_COLOR.dark);
    act(() => resetFlags({ ...DEFAULT_FLAGS, dogTheme: false }, true));
    expect(document.documentElement.classList.contains("dog")).toBe(false);
  });
});
