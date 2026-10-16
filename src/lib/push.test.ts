// @vitest-environment jsdom
// This device's push status (src/lib/push.ts): dormant with a reason wherever push can't work, and the
// permission prompt only from enablePush (a tap), never from reading the status.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

let requestPermission: ReturnType<typeof vi.fn>;
let subscription: { endpoint: string; unsubscribe: () => Promise<boolean>; toJSON: () => unknown; options: { applicationServerKey: ArrayBuffer | null } } | null;
let calls: { path: string; method: string; body: any }[];
let available = true;

function setup(o: { ua?: string; push?: boolean; permission?: NotificationPermission; worker?: boolean; standalone?: boolean } = {}) {
  vi.resetModules();
  Object.defineProperty(navigator, "userAgent", { value: o.ua ?? CHROME, configurable: true });
  Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  window.matchMedia = ((q: string) => ({ matches: q.includes("standalone") && !!o.standalone })) as any;
  requestPermission = vi.fn(async () => "granted");
  (globalThis as any).Notification = { permission: o.permission ?? "default", requestPermission };
  if (o.push === false) delete (window as any).PushManager; else (window as any).PushManager = function PushManager() {};
  const reg = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: vi.fn(async () => {
        subscription = { endpoint: "https://push.example.com/send/1", unsubscribe: async () => { subscription = null; return true; }, toJSON: () => ({ endpoint: "https://push.example.com/send/1", keys: { p256dh: "p", auth: "a" } }), options: { applicationServerKey: null } };
        return subscription;
      }),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: async () => (o.worker === false ? undefined : reg), ready: new Promise(() => {}) },
    configurable: true,
  });
  return reg;
}

beforeEach(() => {
  subscription = null;
  calls = [];
  available = true;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/push/config") return Response.json(available ? { available: true, publicKey: Buffer.alloc(65, 4).toString("base64url") } : { available: false, publicKey: null });
    if (path === "/api/push/subscriptions/check") return Response.json({ subscribed: !!subscription });
    return Response.json({ ok: true });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("push status", () => {
  it("explains iPhone Safari outside the Home Screen, and browsers with no Push API", async () => {
    setup({ ua: IPHONE, push: false });
    const { readPushStatus } = await import("./push");
    expect(await readPushStatus(true)).toBe("ios-install");
    setup({ ua: IPHONE, standalone: true });
    expect(await (await import("./push")).readPushStatus(true)).toBe("off");
    setup({ push: false });
    expect(await (await import("./push")).readPushStatus(true)).toBe("unsupported");
  });

  it("is dormant when permission is blocked, the server has no keys, there's no worker, or no one is signed in", async () => {
    setup({ permission: "denied" });
    expect(await (await import("./push")).readPushStatus(true)).toBe("denied");
    available = false;
    setup();
    expect(await (await import("./push")).readPushStatus(true)).toBe("unavailable");
    available = true;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    setup({ worker: false });
    const p = (await import("./push")).readPushStatus(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await p).toBe("no-worker");
    vi.useRealTimers();
    setup();
    expect(await (await import("./push")).readPushStatus(false)).toBe("signed-out");
    // Reading the status never asks for permission.
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("turns on from a tap (permission first), stores the subscription, and turns off again", async () => {
    const reg = setup();
    const push = await import("./push");
    expect(await push.readPushStatus(true)).toBe("off");
    expect(await push.enablePush()).toBe("on");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(reg.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(calls.find((c) => c.path === "/api/push/subscriptions" && c.method === "POST")?.body).toEqual({ endpoint: "https://push.example.com/send/1", keys: { p256dh: "p", auth: "a" } });
    expect(push.pushOnHere()).toBe(true);
    expect(await push.disablePush()).toBe("off");
    expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ endpoint: "https://push.example.com/send/1" });
    expect(subscription).toBeNull();
    expect(push.pushOnHere()).toBe(false);
  });

  it("lets the in-tab alerts step aside only while push can actually deliver", async () => {
    setup();
    const push = await import("./push");
    expect(await push.pushDeliversHere()).toBe(false); // never turned on
    (globalThis as any).Notification.permission = "granted";
    await push.enablePush();
    expect(await push.pushDeliversHere()).toBe(true);
    // The owner switches push off: the next check says no, and forgets this device's record.
    available = false;
    setup({ permission: "granted" });
    localStorage.setItem("cs-push-on", "1");
    const again = await import("./push");
    expect(await again.pushDeliversHere()).toBe(false);
    expect(again.pushOnHere()).toBe(false);
    // The server dropped the subscription (a 410 pruned it): the same.
    available = true;
    setup({ permission: "granted" });
    localStorage.setItem("cs-push-on", "1");
    vi.mocked(fetch).mockImplementation(async (path: any) => (String(path).endsWith("/check") ? Response.json({ subscribed: false }) : Response.json({ available: true, publicKey: "x" })));
    expect(await (await import("./push")).pushDeliversHere()).toBe(false);
  });

  it("asks the server again for its push settings, instead of keeping an old answer", async () => {
    available = false;
    setup();
    const push = await import("./push");
    expect(await push.readPushStatus(true)).toBe("unavailable");
    available = true;
    // Turning on always reads the settings fresh.
    expect(await push.enablePush()).toBe("on");
    expect(calls.filter((c) => c.path === "/api/push/config")).toHaveLength(2);
  });

  it("does nothing when the prompt is dismissed or blocked", async () => {
    setup();
    const push = await import("./push");
    requestPermission.mockResolvedValueOnce("default");
    expect(await push.enablePush()).toBe("off");
    requestPermission.mockResolvedValueOnce("denied");
    expect(await push.enablePush()).toBe("denied");
    expect(calls.filter((c) => c.path === "/api/push/subscriptions")).toEqual([]);
  });
});
