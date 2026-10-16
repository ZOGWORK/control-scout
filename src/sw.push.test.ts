// The service worker's web push handlers (src/sw.template.js, docs/push.md), run in a sandbox with a fake
// `self`: a push shows the notification the server described, and a tap opens its page in this app.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function worker() {
  const listeners = new Map<string, (e: any) => void>();
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let tabs: any[] = [];
  const self = {
    location: { origin: "https://controlscout.org" },
    addEventListener: (type: string, fn: (e: any) => void) => listeners.set(type, fn),
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }); } },
    clients: {
      matchAll: async () => tabs,
      openWindow: async (url: string) => { opened.push(url); return null; },
      claim: async () => {},
    },
    skipWaiting: async () => {},
  };
  const src = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
    .replace("__VERSION__", "test").replace("__FILES__", "[]").replace("__OFFLINE_FILES__", "[]");
  runInNewContext(src, { self, URL, caches: {}, indexedDB: {}, fetch, Response, console });
  const fire = async (type: string, event: any) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  return {
    shown, opened, navigated, fire,
    setTabs: (urls: string[]) => { tabs = urls.map((url) => ({ url, focus: async () => {}, navigate: async (u: string) => { navigated.push(u); return {}; } })); },
  };
}

const pushEvent = (data: unknown) => ({ data: { json: () => (typeof data === "string" ? JSON.parse(data) : data), text: () => String(data) } });

describe("service worker push", () => {
  it("shows the notification the push describes, with the url to open", async () => {
    const w = worker();
    await w.fire("push", pushEvent({ title: "4215 plays Q12 in 15 min", body: "USTXQ1 Qualifier", url: "/events/2025/USTXQ1?tab=matches&match=qual%3A0%3A12", tag: "match:2025:USTXQ1:qual:0:12" }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("4215 plays Q12 in 15 min");
    expect(w.shown[0].options).toMatchObject({ body: "USTXQ1 Qualifier", tag: "match:2025:USTXQ1:qual:0:12", icon: "/icon-192.png", data: { url: "/events/2025/USTXQ1?tab=matches&match=qual%3A0%3A12" } });
  });

  it("never links off the site, and copes with an unreadable payload", async () => {
    const w = worker();
    await w.fire("push", pushEvent({ title: "x", body: "y", url: "https://evil.example/" }));
    await w.fire("push", pushEvent({ title: "x", url: "//evil.example/" }));
    await w.fire("push", { data: { json: () => { throw new Error("not json"); }, text: () => "plain" } });
    expect(w.shown.map((s) => s.options.data.url)).toEqual(["/", "/", "/"]);
    expect(w.shown[2]).toMatchObject({ title: "Control Scout", options: { body: "plain" } });
  });

  it("a tap opens the url in a new window, or takes an open tab there", async () => {
    const w = worker();
    let closed = 0;
    const click = { notification: { data: { url: "/events/2025/USTXQ1" }, close: () => { closed++; } } };
    await w.fire("notificationclick", click);
    expect(w.opened).toEqual(["https://controlscout.org/events/2025/USTXQ1"]);
    w.setTabs(["https://controlscout.org/teams/4215"]);
    await w.fire("notificationclick", click);
    expect(w.navigated).toEqual(["https://controlscout.org/events/2025/USTXQ1"]);
    expect(w.opened).toHaveLength(1);
    expect(closed).toBe(2);
  });
});
