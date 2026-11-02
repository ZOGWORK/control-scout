// @vitest-environment jsdom
// Settings › Appearance › Theme: five cards (Light, Dim, Dark, Midnight, System) as one radio group, the chosen
// one checked; picking another reports it. A saved theme survives cleanValue, an unknown one falls back to Dark.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { SWATCH, ThemePicker } from "./ThemePicker";
import { THEME_COLOR } from "../../hooks/useTheme";
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

describe("Copies of each theme's colours", () => {
  // The picker's swatches, the browser bar colour, the pre-paint script and the static first paint can't read
  // src/index.css, so they carry the page and card colours themselves: these must match the real tokens.
  const css = readFileSync("src/index.css", "utf8");
  const html = readFileSync("index.html", "utf8");
  const boot = readFileSync("server/bootShell.ts", "utf8");
  const token = (block: string, name: string) => new RegExp(`${block} \{[^}]*?--${name}: (#[0-9a-f]+);`).exec(css)?.[1];
  const BLOCK = { light: "html.light", dim: "html.dim", dark: ":root", midnight: "html.midnight" } as const;

  it("match src/index.css", () => {
    for (const p of ["light", "dim", "dark", "midnight"] as const) {
      const bg = token(BLOCK[p], "sh-background"), card = token(BLOCK[p], "sh-card");
      expect(THEME_COLOR[p], p).toBe(bg);
      expect(SWATCH[p].bg, p).toBe(bg);
      if (p !== "light") expect(SWATCH[p].card, p).toBe(card); // Light's swatch card is muted grey, so it shows on white
    }
    expect(html).toContain(`t === 'dim' ? '${THEME_COLOR.dim}' : '${THEME_COLOR.midnight}'`);
    expect(boot).toContain(`html.dim{background:${THEME_COLOR.dim}}`);
    expect(boot).toContain(`html.dim .csb{--b-bg:${THEME_COLOR.dim};`);
  });
});
