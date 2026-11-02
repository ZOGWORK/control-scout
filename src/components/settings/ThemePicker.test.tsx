// @vitest-environment jsdom
// Settings › Appearance › Theme: five cards (Light, Dim, Dark, Midnight, System) as one radio group, the chosen
// one checked; picking another reports it. A saved theme survives cleanValue, an unknown one falls back to Dark.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemePicker } from "./ThemePicker";
import { cleanValue, DEFAULT_SETTINGS, THEMES } from "../../shared/personal";

afterEach(cleanup);

describe("Theme picker", () => {
  it("lists every theme, in order, with the current one checked", () => {
    render(<ThemePicker value="dim" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["light", "dim", "dark", "midnight", "system"]);
    expect(screen.getByRole("radio", { name: /Dim/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /^Dark/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("picking a card reports that theme", () => {
    const onChange = vi.fn();
    render(<ThemePicker value="dark" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Midnight/ }));
    expect(onChange).toHaveBeenCalledWith("midnight");
  });
});

describe("Saved theme", () => {
  it("keeps every built-in theme and drops an unknown one to the default (Dark)", () => {
    for (const theme of THEMES) expect(cleanValue("settings", { ...DEFAULT_SETTINGS, theme })?.theme).toBe(theme);
    expect(cleanValue("settings", { ...DEFAULT_SETTINGS, theme: "sepia" })?.theme).toBe("dark");
    expect(DEFAULT_SETTINGS.theme).toBe("dark");
  });
});
