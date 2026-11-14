// @vitest-environment jsdom
// The owner's dog theme (dogTheme, off by default): ThemeSync tints the page only while the owner has it on, and the
// browser's bar follows the page colour either way.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLAGS } from "../shared/flags";
import { resetFlags } from "../lib/flags";
import { DOG_THEME_COLOR, THEME_COLOR, ThemeSync } from "./useTheme";

const update = vi.hoisted(() => vi.fn());
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { settings: { theme: "dark", density: "comfortable", ambient: true } }, update }) }));

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

describe("a theme picked on Lite's Settings page (src/lib/liteCookies.ts)", () => {
  const cookie = (name: string) => document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  it("is taken once as this device's choice, and the app's older one isn't written over it", () => {
    document.cookie = "cs-theme=light; path=/";
    document.cookie = "cs-lite-picked=theme; path=/";
    update.mockClear();
    render(<ThemeSync />);
    expect(update).toHaveBeenCalledTimes(1);
    const [key, fn] = update.mock.calls[0];
    expect(key).toBe("settings");
    expect(fn({ theme: "dark", density: "comfortable" })).toEqual({ theme: "light", density: "comfortable" });
    // The mocked settings still say dark: the cookie keeps Lite's choice until the app's state has taken it.
    expect(cookie("cs-theme")).toBe("light");
    expect(cookie("cs-lite-picked")).toBeNull();
  });
  it("without a pick from Lite, the app's choice goes to the cookie as before", () => {
    update.mockClear();
    render(<ThemeSync />);
    expect(update).not.toHaveBeenCalled();
    expect(cookie("cs-theme")).toBe("dark");
  });
});
