// The service worker with light pages (src/sw.template.js, docs/lite.md): with no signal at all, a light page's
// address opens its full page (the cached shell and the offline pack) rather than the shell's not-found page,
// and the worker's own copy of the address rule agrees with src/shared/lite.ts.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { fullHref } from "./shared/lite";

function worker(online: boolean) {
  const listeners = new Map<string, (e: any) => void>();
  const self = { location: { origin: "https://controlscout.org" }, addEventListener: (type: string, fn: (e: any) => void) => listeners.set(type, fn) };
  const shell = new Response("<html>shell</html>");
  const caches = { keys: async () => ["cs-shell-test"], open: async () => ({ match: async (r: string) => (r === "/" ? shell : undefined) }) };
  const fetch = async () => { if (!online) throw new TypeError("Failed to fetch"); return new Response("<html>light</html>"); };
  const src = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
    .replace("__VERSION__", "test").replace("__FILES__", "[]").replace("__OFFLINE_FILES__", "[]");
  const ctx: Record<string, any> = { self, URL, URLSearchParams, caches, indexedDB: {}, fetch, Response, console };
  runInNewContext(src, ctx);
  const navigate = async (path: string): Promise<Response> => {
    let answer: Promise<Response> | undefined;
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: `https://controlscout.org${path}` }, respondWith: (p: Promise<Response>) => { answer = p; } });
    return answer!;
  };
  return { navigate, fullPage: (path: string) => ctx.fullPage(new URL(path, "https://controlscout.org")) as string };
}

describe("service worker: light pages", () => {
  it("serves a light page from the network when there's any signal", async () => {
    expect(await (await worker(true).navigate("/lite/events/2025/USNJQ1")).text()).toBe("<html>light</html>");
  });

  it("with no signal, sends a light page to its full page (where the offline pack takes over)", async () => {
    const r = await worker(false).navigate("/lite/teams/18360?season=2024");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("https://controlscout.org/teams/18360?season=2024");
    // Rich pages still get the cached shell.
    expect(await (await worker(false).navigate("/events/2025/USNJQ1")).text()).toBe("<html>shell</html>");
  });

  it("agrees with the shared address rule", () => {
    const w = worker(true);
    for (const p of ["/lite/events/2025/USNJQ1", "/lite/events/2025/USNJQ1/match/qual:0:12", "/lite/teams/18360", "/lite/teams/18360?season=2024",
      "/lite/picklist?space=7&season=2025", "/lite/picklist", "/lite", "/lite/nope"]) {
      const [path, search = ""] = p.split("?");
      expect(w.fullPage(p), p).toBe(fullHref(path, search ? `?${search}` : ""));
    }
  });
});
