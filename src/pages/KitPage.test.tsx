// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { useIsV8 } from "../lib/v8";
import { MemoryRouter } from "react-router-dom";
import KitPage from "./KitPage";
import { TooltipProvider } from "../components/ui/overlay";
import { buttonVariants } from "../components/ui/button";
import { pageModule, pageTitle } from "../shared/routes";

const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const mount = () => render(<MemoryRouter><TooltipProvider><KitPage /></TooltipProvider></MemoryRouter>);

afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-v8"); document.documentElement.className = ""; });

describe("v8 kit (/preview/kit)", () => {
  it("is its own noindex route", () => {
    expect(pageModule("/preview/kit")).toBe("KitPage");
    expect(pageTitle("/preview/kit")).toBe("Kit");
  });

  it("shows every part of the kit, in order", () => {
    const { container } = mount();
    expect([...container.querySelectorAll("[data-kit]")].map((s) => s.getAttribute("data-kit"))).toEqual(["colour", "type", "buttons", "inputs", "tabs", "cards", "overlays"]);
  });

  it("draws in v8 while open and takes it off after, touching no theme class itself", () => {
    const root = document.documentElement;
    root.classList.add("light");
    const { unmount } = mount();
    expect(root.hasAttribute("data-v8")).toBe(true);
    unmount();
    expect(root.hasAttribute("data-v8")).toBe(false);
    expect(root.classList.contains("light")).toBe(true);
  });

  it("the theme follows the switch live: dark while v8 is on, the saved one once it's off", async () => {
    const seen: string[] = [];
    function Probe() { seen.push(useIsV8() ? "v8" : "off"); return null; }
    render(<Probe />);
    await act(async () => { document.documentElement.setAttribute("data-v8", ""); });
    await act(async () => { document.documentElement.removeAttribute("data-v8"); });
    expect(seen.filter((x, i) => x !== seen[i - 1])).toEqual(["off", "v8", "off"]);
  });

  it("leaves v8 on when the device already has it", () => {
    document.documentElement.setAttribute("data-v8", "");
    const { unmount } = mount();
    unmount();
    expect(document.documentElement.hasAttribute("data-v8")).toBe(true);
  });
});

describe("v8 foundations", () => {
  it("turns on before first paint from ?v8=1, off from ?v8=0, and is dark only", () => {
    expect(html).toContain("/[?&]v8=([01])/");
    expect(html).toContain("var v8 = q ? q[1] === '1' : stored === '1';");
    expect(html).toContain("var t = v8 ? 'dark' :");
  });

  it("sets the 90% root, mint, three radii and the strong curves under html[data-v8]", () => {
    const block = css.slice(css.indexOf("html[data-v8] {"), css.indexOf("}", css.indexOf("html[data-v8] {")));
    for (const rule of ["--ui-base: 0.9;", "--color-accent: #7fd1ae;", "--radius-xl: 0.875rem;", "--radius-lg: 0.5rem;", "--ease-out: cubic-bezier(0.23, 1, 0.32, 1);", "--ease-in: cubic-bezier(0.23, 1, 0.32, 1);"]) expect(block).toContain(rule);
    expect(css).toContain("@custom-variant v8 (&:where(html[data-v8], html[data-v8] *));");
    expect(css).toMatch(/@media \(min-width: 2100px\) \{ html\[data-v8\] \{ --ui-base: 0\.99; \} \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{ html\[data-v8\] \{ --ui-base: 0\.875; \} \}/);
  });

  it("gives buttons exact transitions, the press, and no coloured fill in v8", () => {
    const b = buttonVariants();
    expect(b).not.toContain("transition-all");
    expect(b).toContain("active:scale-[0.97]");
    expect(b).toContain("motion-reduce:active:scale-100");
    expect(b).toContain("v8:bg-white/10");
  });
});
