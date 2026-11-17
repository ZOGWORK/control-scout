// @vitest-environment jsdom
// The top bar's light/dark switch: Light and back to the dark theme last used (Dim, Dark or Midnight), never a
// different dark one; with none remembered, Dark (the default). The remembered one is a setting that syncs.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toggledTheme } from "../../hooks/useTheme";
import { cleanValue, DEFAULT_SETTINGS, type Settings } from "../../shared/personal";

const s = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o });

describe("toggledTheme", () => {
  it("Dim → Light → Dim", () => {
    const light = toggledTheme(s({ theme: "dim" }), "dim");
    expect(light.theme).toBe("light");
    expect(toggledTheme(light, "light").theme).toBe("dim");
  });
  it("Midnight → Light → Midnight, never the default", () => {
    const light = toggledTheme(s({ theme: "midnight" }), "midnight");
    expect(light).toMatchObject({ theme: "light", darkTheme: "midnight" });
    expect(toggledTheme(light, "light").theme).toBe("midnight");
  });
  it("Light with nothing remembered: Dark, the default", () => {
    expect(toggledTheme(s({ theme: "light" }), "light").theme).toBe("dark");
  });
  it("System showing dark: Light, and back to Dark (what it showed)", () => {
    const light = toggledTheme(s({ theme: "system" }), "dark");
    expect(light).toMatchObject({ theme: "light", darkTheme: "dark" });
    expect(toggledTheme(light, "light").theme).toBe("dark");
  });
  it("leaves every other setting as it was", () => {
    const before = s({ theme: "dim", density: "compact", ambient: false });
    expect(toggledTheme(before, "dim")).toMatchObject({ density: "compact", ambient: false });
  });
});

describe("the remembered dark theme syncs", () => {
  it("is kept when known, dropped otherwise, and missing stays missing", () => {
    expect((cleanValue("settings", { ...DEFAULT_SETTINGS, darkTheme: "midnight" }) as Settings).darkTheme).toBe("midnight");
    expect("darkTheme" in (cleanValue("settings", { ...DEFAULT_SETTINGS, darkTheme: "light" }) as Settings)).toBe(false);
    expect("darkTheme" in (cleanValue("settings", DEFAULT_SETTINGS) as Settings)).toBe(false);
  });
});

let settings: Settings = s({ theme: "midnight" });
vi.mock("../../lib/personal", () => ({
  usePersonal: () => ({ state: { settings }, update: (_k: string, fn: (x: Settings) => Settings) => { settings = fn(settings); return true; } }),
}));
const { ThemeToggle } = await import("./ThemeToggle");
afterEach(cleanup);

describe("ThemeToggle", () => {
  it("says what it does, and flips Midnight to Light and back to Midnight", () => {
    const { rerender } = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(settings).toMatchObject({ theme: "light", darkTheme: "midnight" });
    rerender(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(settings.theme).toBe("midnight");
  });
});
