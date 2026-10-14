import { describe, expect, it } from "vitest";
import { codeEmail } from "./emailTemplate";

describe("sign-in code email", () => {
  it("carries the code in the subject, the text part and six tiles, with the expiry and site", () => {
    const e = codeEmail("395572", { minutes: 10, siteUrl: "https://controlscout.org/" });
    expect(e.subject).toBe("395572 is your Control Scout code");
    expect(e.text).toContain("395572");
    expect(e.text).toContain("expires in 10 minutes");
    expect(e.html.match(/font-size:28px;font-weight:700/g)).toHaveLength(6);
    expect(e.html).toContain("Expires in 10 minutes");
    expect(e.html).toContain('href="https://controlscout.org"');
    expect(e.html).not.toMatch(/<img|<script/);
  });
});
