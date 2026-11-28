// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import KitPage from "./KitPage";
import { TooltipProvider } from "../components/ui/overlay";
import { buttonVariants } from "../components/ui/button";
import { pageModule, pageTitle } from "../shared/routes";

const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const mount = () => render(<MemoryRouter><TooltipProvider><KitPage /></TooltipProvider></MemoryRouter>);

afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-v8"); document.documentElement.className = ""; });

describe("the kit (/preview/kit)", () => {
  it("is its own noindex route", () => {
    expect(pageModule("/preview/kit")).toBe("KitPage");
    expect(pageTitle("/preview/kit")).toBe("Kit");
  });

  it("shows every part of the kit, in order", () => {
    const { container } = mount();
    expect([...container.querySelectorAll("[data-kit]")].map((s) => s.getAttribute("data-kit"))).toEqual(["colour", "type", "buttons", "inputs", "tabs", "cards", "overlays"]);
  });

  it("leaves the look to <html>, touching no theme class itself", () => {
    const root = document.documentElement;
    root.classList.add("light");
    const { unmount } = mount();
    unmount();
    expect(root.classList.contains("light")).toBe(true);
  });
});

describe("foundations", () => {
  it("is on before first paint, and takes the saved theme", () => {
    // <html data-v8> is set unconditionally by index.html's first script: there is no other look to pick.
    expect(html).toContain("document.documentElement.setAttribute('data-v8', '');");
    expect(html).not.toContain("cs-v8");
    // Its own Light and Dim (index.css html[data-v8].light / .dim): the saved theme applies.
    expect(html).toContain("var t = s && s.value && s.value.theme;");
    expect(html).not.toContain("v8 ? 'dark'");
  });

  it("sets the 90% root, the slate-blue accent, three radii and the strong curves under html[data-v8]", () => {
    const block = css.slice(css.indexOf("html[data-v8] {"), css.indexOf("}", css.indexOf("html[data-v8] {")));
    for (const rule of ["--ui-base: 0.9;", "--color-accent: #a3b6e0;", "--radius-xl: 0.875rem;", "--radius-lg: 0.5rem;", "--ease-out: cubic-bezier(0.23, 1, 0.32, 1);", "--ease-in: cubic-bezier(0.23, 1, 0.32, 1);"]) expect(block).toContain(rule);
    expect(css).toContain("@custom-variant v8 (&:where(html[data-v8], html[data-v8] *));");
    expect(css).toMatch(/@media \(min-width: 2100px\) \{ html\[data-v8\] \{ --ui-base: 0\.99; \} \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{ html\[data-v8\] \{ --ui-base: 0\.875; \} \}/);
  });

  it("gives buttons exact transitions, the press, and no coloured fill in v8", () => {
    const b = buttonVariants();
    expect(b).not.toContain("transition-all");
    expect(b).toContain("active:scale-[0.97]");
    expect(b).toContain("motion-reduce:active:scale-100");
    expect(b).toContain("v8:bg-ink/10");
  });
});
