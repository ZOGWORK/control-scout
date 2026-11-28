// Behind Cloudflare, req.ip is Cloudflare's edge, shared by every visitor it serves (server/visitorIp.ts). A limit
// keyed on it locks out everyone behind that edge at once: about 20 sign-in attempts at a busy event closed email
// sign-in for the whole venue for 15 minutes. Every per-visitor key goes through visitorIp(req); this keeps it so.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

describe("visitor keys", () => {
  it("no server code reads req.ip except visitorIp itself", () => {
    const offenders = sources(join(__dirname))
      .filter((p) => !p.endsWith("visitorIp.ts"))
      .filter((p) => /\breq\.ip\b/.test(readFileSync(p, "utf8").replace(/\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });
});
