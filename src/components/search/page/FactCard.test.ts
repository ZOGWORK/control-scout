// A listed website on the fact card links whether or not FIRST's listing gives it a scheme; only http(s) ever links.
import { describe, expect, it } from "vitest";
import { hrefOf } from "./FactCard";

describe("hrefOf", () => {
  it("links a bare domain over https and keeps an http(s) link as is", () => {
    expect(hrefOf("www.hypnoticrobotics.org")).toBe("https://www.hypnoticrobotics.org/");
    expect(hrefOf("HTTPS://Example.org/team")).toBe("https://example.org/team");
    expect(hrefOf("http://example.org")).toBe("http://example.org/");
  });
  it("never links another scheme or something that isn't an address", () => {
    expect(hrefOf("javascript:alert(1)")).toBeNull();
    expect(hrefOf("mailto:team@example.org")).toBeNull();
    expect(hrefOf("not a site")).toBeNull();
  });
});
