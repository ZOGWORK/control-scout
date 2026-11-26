import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WASH, WASH_PRESETS } from "../../src/shared/wash";
import { codeEmail, greetingName, rgba } from "./emailTemplate";

const digits = (h: string) => { const m = h.match(/data-code="(\d+)"[^>]*>(\d+)</); expect(m?.[1]).toBe(m?.[2]); return m?.[2]; };
const preheader = (h: string) => /<div style="display:none[^>]*>([^<&]*)/.exec(h)?.[1];

describe("sign-in code email", () => {
  it("carries the code in the subject, the preheader, the text part and one copyable run, with the expiry and site", () => {
    const e = codeEmail("395572", { minutes: 10, siteUrl: "https://controlscout.org/" });
    expect(e.subject).toBe("395572 is your Control Scout code");
    expect(preheader(e.html)).toBe("Hey there, your sign-in code is 395572. It expires in 10 minutes.");
    expect(e.text).toContain("sign-in code: 395572");
    expect(e.text).toContain("It expires in 10 minutes.");
    // the whole code is one text node, so selecting it copies exactly the digits
    expect(digits(e.html)).toBe("395572");
    expect(digits(codeEmail("012340").html)).toBe("012340"); // a leading zero survives
    expect(e.html).toContain("Expires in 10 minutes.");
    expect(e.html).toContain('href="https://controlscout.org"');
    expect(e.html).not.toMatch(/<script/);
  });

  it("greets by name and has the didn't-ask line in both parts, with no sign-off", () => {
    const e = codeEmail("395572", { name: "Sam Rivera" });
    for (const part of [e.html, e.text]) {
      expect(part).toContain("Hey Sam,");
      expect(part).not.toContain("Happy scouting");
      expect(part).toMatch(/Didn(&#39;|')t ask for this\?/);
      expect(part).toContain("Nobody can sign in without the code.");
    }
    expect(preheader(e.html)).toBe("Hey Sam, your sign-in code is 395572. It expires in 10 minutes.");
    expect(codeEmail("395572").text.startsWith("Hey there,\n")).toBe(true);
  });

  it("keeps to one accent, the site's wash: the mark is the only image, no pills, no other accent colours", () => {
    const { html } = codeEmail("395572", { siteUrl: "https://controlscout.org" });
    expect(html).toContain('<img src="https://controlscout.org/email/mark-white.png"');
    expect(html).toMatch(/<img [^>]*alt="Control Scout"/);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toMatch(/background="|url\(|border-radius:999px|#34d399|#6ee7b7|#ffc700/i);
    expect(existsSync(join(__dirname, "..", "..", "public", "email", "mark-white.png"))).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toContain("IBM Plex Sans");
    // every gradient cell also has a solid colour, for clients that drop gradients
    for (const cell of ["data-glow", "data-tile", "data-panel"]) expect(html).toMatch(new RegExp(`${cell}[^>]*bgcolor="#[0-9a-f]{6}"[^>]*background-color:`));
  });

  it("takes its colours from the wash it's given (the owner's Appearance setting), Dusk by default", () => {
    const dusk = codeEmail("395572").html;
    expect(dusk).toContain(rgba(DEFAULT_WASH.a, 0.42));
    expect(dusk).toContain(`bgcolor="${DEFAULT_WASH.b}"`);
    const sunset = WASH_PRESETS.find((p) => p.id === "sunset")!.wash;
    const html = codeEmail("395572", { wash: sunset }).html;
    expect(html).toContain(rgba(sunset.a, 0.42));
    expect(html).toContain(`bgcolor="${sunset.b}"`);
    expect(html).not.toContain(rgba(DEFAULT_WASH.a, 0.42));
    // a value that isn't #rrggbb never reaches the markup
    const bad = codeEmail("395572", { wash: { ...sunset, a: 'red"><script>', b: "url(x)" } }).html;
    expect(bad).not.toContain("<script>");
    expect(bad).not.toContain("url(x)");
    expect(bad).toContain(`bgcolor="${DEFAULT_WASH.b}"`);
  });

  it("escapes the name, and greets 'there' for a name that reads like a link, an address or markup", () => {
    expect(greetingName("  Ana  María ")).toBe("Ana");
    expect(greetingName("O'Neil")).toBe("O'Neil");
    expect(codeEmail("395572", { name: "O'Neil" }).html).toContain("Hey O&#39;Neil,");
    for (const bad of ["<img src=x onerror=alert(1)>", "evil.com", "https://evil.example", "me@x.org", "a&b", "x".repeat(25), "", null, undefined]) {
      expect(greetingName(bad)).toBeNull();
      const e = codeEmail("395572", { name: bad });
      expect(e.html).toContain("Hey there,");
      expect(e.text).toContain("Hey there,");
      expect(e.html).not.toContain("<img src=x");
      expect(e.html).not.toContain("evil");
    }
    // a name with a quote can't break out of anything
    expect(codeEmail("395572", { name: 'Jo"><script>' }).html).not.toContain("<script>");
  });
});
