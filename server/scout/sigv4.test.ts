// The presigner against AWS's own worked example (sigv4-query-string-auth.html, "An example"): the same
// inputs must give the same signature, byte for byte, or real R2 would refuse every URL.
import { describe, expect, it } from "vitest";
import { presign } from "./sigv4";

const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const sig = (u: string) => new URL(u).searchParams.get("X-Amz-Signature");

describe("SigV4 presigned URLs", () => {
  it("matches AWS's published example", () => {
    const url = presign({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", creds, expiresSec: 86400, now: new Date("2013-05-24T00:00:00Z") });
    expect(sig(url)).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request");
  });

  it("signs the headers it's given; another method or header value signs differently", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const url = "https://acct.r2.cloudflarestorage.com/b/photos/2025/X/e/p.jpg";
    const a = presign({ method: "PUT", url, creds: { ...creds, region: "auto" }, expiresSec: 600, now, headers: { "Content-Type": "image/jpeg" } });
    expect(new URL(a).searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    const b = presign({ method: "PUT", url, creds: { ...creds, region: "auto" }, expiresSec: 600, now, headers: { "Content-Type": "image/png" } });
    const c = presign({ method: "DELETE", url, creds: { ...creds, region: "auto" }, expiresSec: 600, now, headers: { "Content-Type": "image/jpeg" } });
    expect(new Set([sig(a), sig(b), sig(c)]).size).toBe(3);
  });

  it("keeps an existing query (a bucket listing) in the signed request", () => {
    const url = presign({ method: "GET", url: "https://acct.r2.cloudflarestorage.com/b?list-type=2&prefix=photos/", creds, expiresSec: 60, now: new Date("2026-10-15T00:00:00Z") });
    expect(new URL(url).searchParams.get("prefix")).toBe("photos/");
    expect(new URL(url).searchParams.get("list-type")).toBe("2");
  });
});
