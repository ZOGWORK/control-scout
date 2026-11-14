// The footer's flagged links (src/shared/footer.ts): one predicate for the app's footer and the server's first paint.
import { describe, expect, it } from "vitest";
import { footerFlagOn, footerLinks } from "./footer";

describe("footerLinks", () => {
  it("drops the Status and Rules links while their switches are off, and keeps them while on", () => {
    const to = (on: Parameters<typeof footerFlagOn>[0]) => footerLinks(footerFlagOn(on)).map((l) => l.to);
    expect(to({ rulesReference: true, statusPage: false })).not.toContain("/status");
    expect(to({ rulesReference: false, statusPage: true })).toEqual(expect.arrayContaining(["/status"]));
    expect(to({ rulesReference: false, statusPage: true })).not.toContain("/rules");
    expect(to({})).toEqual(expect.arrayContaining(["/status", "/rules"]));
  });
});
