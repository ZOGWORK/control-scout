// The CSS a server-drawn page inlines for its first paint (server/criticalCss.ts): the rules its markup uses, in order
// and in their layers, so the whole stylesheet can arrive later without changing anything on screen.
import { describe, expect, it } from "vitest";
import { criticalCssFor, htmlClasses, selectorNeeds } from "./criticalCss";

describe("critical CSS", () => {
  it("keeps the rules the markup's classes use, and those that name no class", () => {
    const css = "/*! banner */@layer theme,base;@layer theme{:root{--a:1}}@layer base{*,:before{box-sizing:border-box}h1{margin:0}}"
      + ".p-2{padding:.5rem}.p-4{padding:1rem}.flex.p-2{gap:1px}@media(min-width:40rem){.sm\\:p-4{padding:1rem}.md\\:hidden{display:none}}";
    const out = criticalCssFor(css, '<div class="p-2 flex sm:p-4">x</div>');
    expect(out).toBe("@layer theme,base;@layer theme{:root{--a:1}}@layer base{*,:before{box-sizing:border-box}h1{margin:0}}"
      + ".p-2{padding:.5rem}.flex.p-2{gap:1px}@media(min-width:40rem){.sm\\:p-4{padding:1rem}}");
  });

  it("drops an at-rule block left empty, but keeps an empty @layer (it fixes the layers' order)", () => {
    expect(criticalCssFor("@media(hover:hover){.x:hover{color:red}}@layer components{.y{color:blue}}", '<p class="z"></p>')).toBe("@layer components{}");
  });

  it("leaves @font-face out (the drawn page declares its own) and keeps @keyframes and @property whole", () => {
    const out = criticalCssFor('@font-face{font-family:X;src:url(x.woff2)}@property --tw-x{syntax:"*";inherits:false}@keyframes spin{to{transform:rotate(1turn)}}', "");
    expect(out).toBe('@property --tw-x{syntax:"*";inherits:false}@keyframes spin{to{transform:rotate(1turn)}}');
  });

  it("reads Tailwind's escaped class names, and needs the classes of a single-branch :is()/:where()", () => {
    expect(selectorNeeds(".min-\\[1700px\\]\\:grid")).toEqual([["min-[1700px]:grid"]]);
    expect(selectorNeeds(".\\32 xl\\:p-1")).toEqual([["2xl:p-1"]]);
    expect(selectorNeeds(":where(.space-y-2>:not(:last-child))")).toEqual([["space-y-2"]]);
    expect(selectorNeeds(".group-hover\\:x:is(:where(.group):hover *)")).toEqual([["group-hover:x", "group"]]);
    // Classes inside :not(), :has(), attribute selectors or a many-branch :is() never count against a rule.
    expect(selectorNeeds(".a:not(.b)")).toEqual([["a"]]);
    expect(selectorNeeds(".a:has(.b)")).toEqual([["a"]]);
    expect(selectorNeeds('.a[data-x=".b"]')).toEqual([["a"]]);
    expect(selectorNeeds(".a:is(.b,.c)")).toEqual([["a"]]);
    expect(selectorNeeds(".a,.b")).toEqual([["a"], ["b"]]);
    expect(selectorNeeds(".a,html")).toBeNull();
  });

  it("reads class attributes as the browser does, and counts the classes <html> may carry", () => {
    const markup = `<a class="[&amp;_svg:not([class*=&#x27;size-&#x27;])]:size-4 p-1"></a>`;
    const has = htmlClasses(markup);
    expect(has.has("[&_svg:not([class*='size-'])]:size-4")).toBe(true);
    expect(has.has("p-1")).toBe(true);
    expect(has.has("light")).toBe(true); // set on <html> by index.html's head script before anything paints
    const css = ".\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-4 svg:not([class*=size-]){width:1rem}html.light .p-1{color:#000}";
    expect(criticalCssFor(css, markup)).toBe(css);
  });

  it("never breaks on braces or semicolons inside strings", () => {
    expect(criticalCssFor('.q:before{content:"{;}"}.r{color:red}', '<i class="q"></i>')).toBe('.q:before{content:"{;}"}');
  });
});
