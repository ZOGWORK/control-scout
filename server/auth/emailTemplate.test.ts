import { describe, expect, it } from "vitest";
import { codeEmail } from "./emailTemplate";

describe("sign-in code email", () => {
  it("carries the code in the subject, the text part and one copyable run, with the expiry, logo and site", () => {
    const e = codeEmail("395572", { minutes: 10, siteUrl: "https://controlscout.org/" });
    expect(e.subject).toBe("395572 is your Control Scout code");
    expect(e.text).toContain("395572");
    expect(e.text).toContain("expires in 10 minutes");
    // the whole code is one text node, so selecting it copies exactly the digits
    const digits = (h: string) => { const m = h.match(/data-code="(\d+)"[^>]*>(\d+)</); expect(m?.[1]).toBe(m?.[2]); return m?.[2]; };
    expect(digits(e.html)).toBe("395572");
    expect(digits(codeEmail("012340").html)).toBe("012340"); // a leading zero survives
    expect(e.html).toContain("Expires in 10 minutes");
    expect(e.html).toContain('href="https://controlscout.org"');
    expect(e.html).toContain('<img src="https://controlscout.org/logo.png"');
    expect(e.html.match(/<img/g)).toHaveLength(1);
    expect(e.html).not.toMatch(/<script/);
  });
});
