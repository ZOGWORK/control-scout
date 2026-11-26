import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeEmail, greetingName, SIGNER } from "./emailTemplate";

const digits = (h: string) => { const m = h.match(/data-code="(\d+)"[^>]*>(\d+)</); expect(m?.[1]).toBe(m?.[2]); return m?.[2]; };
const preheader = (h: string) => /<div style="display:none[^>]*>([^<&]*)/.exec(h)?.[1];

describe("sign-in code email", () => {
  it("carries the code in the subject, the preheader, the text part and one copyable run, with the expiry and site", () => {
    const e = codeEmail("395572", { minutes: 10, siteUrl: "https://controlscout.org/" });
    expect(e.subject).toBe("395572 is your Control Scout code");
    expect(preheader(e.html)).toBe("Hey there, your sign-in code is 395572. It works for 10 minutes.");
    expect(e.text).toContain("sign-in code: 395572");
    expect(e.text).toContain("It works for 10 minutes");
    // the whole code is one text node, so selecting it copies exactly the digits
    expect(digits(e.html)).toBe("395572");
    expect(digits(codeEmail("012340").html)).toBe("012340"); // a leading zero survives
    expect(e.html).toContain("Works for 10 minutes");
    expect(e.html).toContain('href="https://controlscout.org"');
    expect(e.html).not.toMatch(/<script/);
  });

  it("reads as a note from a person: a greeting, the sign-off and the didn't-ask line, in both parts", () => {
    const e = codeEmail("395572", { name: "Sam Rivera" });
    for (const part of [e.html, e.text]) {
      expect(part).toContain("Hey Sam,");
      expect(part).toContain("Happy scouting,");
      expect(part).toContain(SIGNER);
      expect(part).toMatch(/Didn(&#39;|')t ask for this\?/);
      expect(part).toContain("nobody can sign in without the code");
    }
    expect(preheader(e.html)).toBe("Hey Sam, your sign-in code is 395572. It works for 10 minutes.");
    expect(codeEmail("395572").text.startsWith("Hey there,\n")).toBe(true);
  });

  it("uses the hosted art with a solid colour under it, and the mark as a PNG with alt text", () => {
    const { html } = codeEmail("395572", { siteUrl: "https://controlscout.org" });
    expect(html).toContain('<img src="https://controlscout.org/email/mark-white.png"');
    expect(html).toMatch(/<img [^>]*alt="Control Scout"/);
    expect(html.match(/<img/g)).toHaveLength(1);
    for (const art of ["code-wash.jpg", "code-glow.jpg"]) {
      // each background image sits on a cell that also has a background colour (Outlook, images off)
      expect(html).toMatch(new RegExp(`background="https://controlscout.org/email/${art.replace(".", "\\.")}" bgcolor="#[0-9a-f]{6}"`));
    }
    // every file the email points at ships in public/
    for (const f of ["code-wash.jpg", "code-glow.jpg", "mark-white.png"]) expect(existsSync(join(__dirname, "..", "..", "public", "email", f))).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toContain("max-width:560px");
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
