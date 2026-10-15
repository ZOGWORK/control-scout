import { describe, expect, it } from "vitest";
import { fingerprintSource, normalizeFrame, REDACTED, reportShapeError, sanitizeReport, sanitizeRoute, sanitizeText, topFrames } from "./errorReport";

describe("sanitizeText", () => {
  const s = (t: string) => sanitizeText(t, 2000);

  it("removes email addresses", () => {
    expect(s("No account for coach.ada+ftc@example.co.uk, try again")).toBe(`No account for ${REDACTED}, try again`);
  });

  it("removes bearer tokens, JWTs and prefixed keys", () => {
    expect(s("Authorization: Bearer abcDEF123456789xyz")).not.toContain("abcDEF123456789xyz");
    expect(s("bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-x")).not.toMatch(/eyJ/);
    expect(s("key ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked")).not.toContain("ghp_");
    expect(s("github_pat_11ABCDEFG0123456789_abcdefghijklmnop")).not.toContain("github_pat_");
    expect(s("re_AbCdEf1234567890abcdef")).toBe(REDACTED);
  });

  it("removes session, cookie and secret values given as key=value, key: value or JSON", () => {
    const out = s('cs_session=abc123def456; token: "s3cr3t-v4lue" {"password":"hunter22"} apiKey=XYZ987 otp=123456');
    expect(out).not.toMatch(/abc123def456|s3cr3t|hunter22|XYZ987|123456/);
    expect(out).toContain("cs_session=");
  });

  it("drops URL query strings and fragments (sign-in codes, handoff codes)", () => {
    expect(s("Failed to fetch https://controlscout.org/api/auth/verify?code=123456&email=a#frag")).toBe("Failed to fetch https://controlscout.org/api/auth/verify");
  });

  it("removes UUIDs (scout entry ids), long opaque ids and phone numbers", () => {
    const out = s("cs-scout-123e4567-e89b-12d3-a456-426614174000 sid 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 call +1 (555) 123-4567");
    expect(out).toBe(`cs-scout-${REDACTED} sid ${REDACTED} call ${REDACTED}`);
  });

  it("keeps team numbers, event codes and ordinary error text", () => {
    expect(s("TypeError: Cannot read properties of undefined (reading 'opr') on team 18360 at USCAFFLM")).toBe("TypeError: Cannot read properties of undefined (reading 'opr') on team 18360 at USCAFFLM");
  });

  it("never lets scout entry contents or notes through: JSON bodies and long quoted text go", () => {
    const parse = s(`SyntaxError: Unexpected token } in JSON at position 80: {"notes":"Their intake jams on the left side","team":4215}`);
    expect(parse).not.toMatch(/intake|jams/);
    const quoted = s(`Error: Invalid value "Great driver, talked to Sam about their autonomous routine" for field`);
    expect(quoted).not.toMatch(/Sam|autonomous/);
  });

  it("caps the length and strips control characters", () => {
    expect(s("a\u0000b\u0007c")).toBe("abc");
    const long = sanitizeText("x ".repeat(1000), 100);
    expect(long.length).toBe(100);
    expect(long.endsWith("…")).toBe(true);
  });

  it("treats non-text as empty", () => {
    expect(sanitizeText({ notes: "secret" }, 100)).toBe("");
    expect(sanitizeText(undefined, 100)).toBe("");
  });
});

describe("sanitizeRoute", () => {
  it("keeps the pathname only", () => {
    expect(sanitizeRoute("/settings?section=profile&signin=failed#x")).toBe("/settings");
    expect(sanitizeRoute("https://controlscout.org/teams/18360?x=1")).toBe("/teams/18360");
    expect(sanitizeRoute("javascript:alert(1)")).toBe("/");
    expect(sanitizeRoute(42)).toBe("/");
  });
});

describe("sanitizeReport", () => {
  it("returns exactly the six fields, whatever else was sent", () => {
    const r = sanitizeReport({ message: "Error: boom", stack: "", route: "/scout", appVersion: "0.1.0+abc", timestamp: "2026-10-15T10:00:00Z", userAgent: "Mozilla/5.0", ...({ notes: "private", email: "a@b.co" } as object) });
    expect(Object.keys(r).sort()).toEqual(["appVersion", "message", "route", "stack", "timestamp", "userAgent"]);
    expect(JSON.stringify(r)).not.toMatch(/private|a@b\.co/);
    expect(r.timestamp).toBe("2026-10-15T10:00:00.000Z");
  });

  it("fills in what's missing rather than failing", () => {
    const r = sanitizeReport({});
    expect(r.message).toBe("Unknown error");
    expect(r.route).toBe("/");
    expect(r.appVersion).toBe("unknown");
    expect(Number.isNaN(Date.parse(r.timestamp))).toBe(false);
  });
});

describe("reportShapeError", () => {
  const good = { message: "Error: x", stack: "at a (b.js:1:2)", route: "/", appVersion: "1", timestamp: "2026-10-15T10:00:00Z", userAgent: "UA" };
  it("accepts a well-formed report", () => expect(reportShapeError(good)).toBeNull());
  it("rejects wrong shapes", () => {
    expect(reportShapeError(null)).toMatch(/object/);
    expect(reportShapeError([good])).toMatch(/object/);
    expect(reportShapeError({ ...good, message: "" })).toMatch(/message/);
    expect(reportShapeError({ ...good, message: 5 })).toMatch(/message must be text/);
    expect(reportShapeError({ ...good, route: undefined })).toMatch(/route/);
    expect(reportShapeError({ ...good, timestamp: "yesterday" })).toMatch(/timestamp/);
    expect(reportShapeError({ ...good, stack: "x".repeat(20_000) })).toMatch(/too long/);
  });
  it("lets stack and userAgent be left out", () => {
    expect(reportShapeError({ ...good, stack: undefined, userAgent: undefined })).toBeNull();
  });
});

describe("fingerprint", () => {
  const chromeA = [
    "TypeError: Cannot read properties of undefined (reading 'opr')",
    "    at TeamHero (https://controlscout.org/assets/TeamPage-B3xk9_Qa.js:1:23456)",
    "    at renderWithHooks (https://controlscout.org/assets/vendor-react-DkF02aZq.js:12:3456)",
    "    at async loadTeam (https://controlscout.org/assets/index-Ab12Cd34.js:3:99)",
    "    at other (https://controlscout.org/assets/index-Ab12Cd34.js:3:100)",
  ].join("\n");
  // The same bug in the next build, served from the backup host, with a different team in the message.
  const chromeB = [
    "TypeError: Cannot read properties of undefined (reading 'opr')",
    "    at TeamHero (https://control-scout.onrender.com/assets/TeamPage-Zz99yy88.js:1:24001)",
    "    at renderWithHooks (https://control-scout.onrender.com/assets/vendor-react-QQ11ww22.js:12:3999)",
    "    at async loadTeam (https://control-scout.onrender.com/assets/index-Xy98Wv76.js:4:12)",
    "    at somethingElseEntirely (https://control-scout.onrender.com/assets/index-Xy98Wv76.js:9:9)",
  ].join("\n");

  it("normalizes frames: no origin, hash, query, line or column", () => {
    expect(normalizeFrame("    at TeamHero (https://controlscout.org/assets/TeamPage-B3xk9_Qa.js:1:23456)")).toBe("TeamHero@/assets/TeamPage.js");
    expect(normalizeFrame("    at https://x.org/assets/index-Ab12Cd34.js:3:99")).toBe("<anonymous>@/assets/index.js");
    expect(normalizeFrame("TeamHero@https://controlscout.org/assets/TeamPage-B3xk9_Qa.js:1:23456")).toBe("TeamHero@/assets/TeamPage.js");
    expect(normalizeFrame("    at Object.load (http://localhost:5173/src/lib/api.ts?t=1712345:10:5)")).toBe("load@/src/lib/api.ts");
    expect(normalizeFrame("TypeError: boom")).toBeNull();
  });

  it("takes the first three frames", () => {
    expect(topFrames(chromeA)).toEqual(["TeamHero@/assets/TeamPage.js", "renderWithHooks@/assets/vendor-react.js", "loadTeam@/assets/index.js"]);
  });

  it("is the same across builds, hosts, line numbers and frames past the third", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'opr')";
    expect(fingerprintSource({ message: msg, stack: chromeA })).toBe(fingerprintSource({ message: msg, stack: chromeB }));
  });

  it("ignores numbers and quoted values in the message", () => {
    expect(fingerprintSource({ message: "Error: team 18360 not found in '2025'", stack: "" }))
      .toBe(fingerprintSource({ message: "Error: team 4215 not found in '2024'", stack: "" }));
    expect(fingerprintSource({ message: "Failed to fetch dynamically imported module: https://controlscout.org/assets/TeamPage-B3xk9_Qa.js", stack: "" }))
      .toBe(fingerprintSource({ message: "Failed to fetch dynamically imported module: https://x.onrender.com/assets/TeamPage-Zz99yy88.js", stack: "" }));
  });

  it("differs for a different error or a different place", () => {
    const msg = "TypeError: x is not a function";
    expect(fingerprintSource({ message: msg, stack: chromeA })).not.toBe(fingerprintSource({ message: "RangeError: bad", stack: chromeA }));
    expect(fingerprintSource({ message: msg, stack: chromeA })).not.toBe(fingerprintSource({ message: msg, stack: chromeA.replace("TeamHero", "EventHero") }));
  });
});
