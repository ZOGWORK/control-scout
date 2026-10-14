import { describe, expect, it } from "vitest";
import { canonicalPath } from "./meta";

describe("canonicalPath (client) matches the server's canonical URLs", () => {
  it("upper-cases event codes, drops team zero-padding and trailing slashes", () => {
    expect(canonicalPath("/events/2025/usnjnom3")).toBe("/events/2025/USNJNOM3");
    expect(canonicalPath("/events/2025/USNJNOM3/")).toBe("/events/2025/USNJNOM3");
    expect(canonicalPath("/teams/004215")).toBe("/teams/4215");
    expect(canonicalPath("/teams/4215")).toBe("/teams/4215");
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("/events")).toBe("/events");
  });
});
