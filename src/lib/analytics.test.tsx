// @vitest-environment jsdom
// Page views leave the browser only with consent, as route patterns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { OWNER_DEVICE_KEY, PageViews, pageView, sendPageView } from "./analytics";
import { setAnalyticsConsent } from "./consent";
import { cleanHost, cleanLang, parsePageView, routePattern, screenBucket } from "../shared/analytics";

const who = vi.hoisted(() => ({ user: null as { isOwner?: true } | null }));
vi.mock("./personal", () => ({ usePersonal: () => who }));

let beacons: { url: string; body: Blob }[] = [];
let nav: (to: string) => void = () => {};
function Nav() { nav = useNavigate(); return null; }
const sentPaths = async () => Promise.all(beacons.map(async (b) => JSON.parse(await b.body.text()).path));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); beacons = []; who.user = null;
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "sendBeacon", { value: vi.fn((url: string, body: Blob) => { beacons.push({ url, body }); return true; }), configurable: true });
});
afterEach(() => cleanup());

describe("consent gating", () => {
  it("sends nothing before a choice, or after No thanks", async () => {
    expect(sendPageView("/teams/1")).toBe(false);
    const ui = render(<MemoryRouter initialEntries={["/"]}><PageViews /><Nav /></MemoryRouter>);
    act(() => nav("/events"));
    act(() => setAnalyticsConsent(false));
    act(() => nav("/teams/18360"));
    ui.unmount();
    expect(beacons).toEqual([]);
  });

  it("sends nothing with Global Privacy Control, even over a stored yes", () => {
    setAnalyticsConsent(true);
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    render(<MemoryRouter><PageViews /></MemoryRouter>);
    expect(beacons).toEqual([]);
  });

  it("with consent: one beacon per route change to /api/collect, route patterns only; stops when consent is withdrawn", async () => {
    setAnalyticsConsent(true);
    render(<MemoryRouter initialEntries={["/teams/18360?season=2025"]}><PageViews /><Nav /></MemoryRouter>);
    act(() => nav("/events/2025/USNJQ1"));
    act(() => nav("/predict"));
    expect(beacons.every((b) => b.url === "/api/collect")).toBe(true);
    expect(await sentPaths()).toEqual(["/teams/:number", "/events/:season/:code", "/predict"]);
    act(() => setAnalyticsConsent(false));
    act(() => nav("/compare"));
    expect(beacons).toHaveLength(3);
  });

  it("counts the current page the moment consent is given", async () => {
    render(<MemoryRouter initialEntries={["/settings"]}><PageViews /></MemoryRouter>);
    expect(beacons).toHaveLength(0);
    act(() => setAnalyticsConsent(true));
    expect(await sentPaths()).toEqual(["/settings"]);
  });
});

describe("payload", () => {
  it("marks only the session's first view as a session, with the external referrer only then", () => {
    Object.defineProperty(document, "referrer", { value: "https://www.reddit.com/r/FTC/comments/x", configurable: true });
    const first = pageView("/");
    const second = pageView("/teams");
    expect(first).toMatchObject({ path: "/", ref: "www.reddit.com", session: true });
    expect(second).toMatchObject({ path: "/teams", ref: "", session: false });
    expect(Object.keys(first).sort()).toEqual(["lang", "newVisitor", "path", "ref", "screen", "session", "visitor"]);
  });

  it("normalises paths, hosts, languages and screen sizes", () => {
    expect(routePattern("/teams/18360/")).toBe("/teams/:number");
    expect(routePattern("/events?season=2025")).toBe("/events");
    expect(routePattern("/no/such/page")).toBe("(other)");
    expect(routePattern("https://evil.example/")).toBe("(other)");
    expect(cleanHost("WWW.Example.COM")).toBe("example.com");
    expect(cleanHost("bad host/<script>")).toBe("");
    expect(cleanLang("en-US")).toBe("en");
    expect(cleanLang("x")).toBe("");
    expect([screenBucket(390), screenBucket(800), screenBucket(1440)]).toEqual(["phone", "tablet", "desktop"]);
    expect(parsePageView({ path: "/", ref: "", screen: "phone", lang: "fr-CA", session: true })).toEqual({ path: "/", ref: "", screen: "phone", lang: "fr", session: true, visitor: false, newVisitor: false });
    expect(parsePageView({ path: "/", ref: "", screen: "phone", lang: "", session: false, visitor: true, newVisitor: true })).toMatchObject({ visitor: true, newVisitor: true });
    expect(parsePageView({ path: "/", ref: "", screen: "phone", lang: "", session: false, visitor: "yes" })).toBeNull();
  });
});

describe("unique visitors", () => {
  it("a browser is a new visitor once, and a visitor once per Eastern day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-25T03:00:00Z")); // 10 pm Eastern, Nov 24
      expect(pageView("/")).toMatchObject({ visitor: true, newVisitor: true });
      expect(pageView("/teams")).toMatchObject({ visitor: false, newVisitor: false });
      vi.setSystemTime(new Date("2026-11-25T04:30:00Z")); // 11:30 pm Eastern, still Nov 24
      expect(pageView("/")).toMatchObject({ visitor: false, newVisitor: false });
      vi.setSystemTime(new Date("2026-11-25T15:00:00Z")); // Nov 25
      expect(pageView("/")).toMatchObject({ visitor: true, newVisitor: false });
    } finally { vi.useRealTimers(); }
  });

  it("with storage blocked, never counts a visitor (it couldn't remember not to count again)", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try { expect(pageView("/")).toMatchObject({ visitor: false, newVisitor: false }); } finally { get.mockRestore(); }
  });
});

describe("the owner's own devices", () => {
  it("sends nothing once the owner signs in, and keeps sending nothing after they sign out", () => {
    setAnalyticsConsent(true);
    who.user = { isOwner: true };
    const ui = render(<MemoryRouter initialEntries={["/"]}><PageViews /><Nav /></MemoryRouter>);
    act(() => nav("/teams"));
    expect(beacons).toEqual([]);
    expect(localStorage.getItem(OWNER_DEVICE_KEY)).toBe("1");
    ui.unmount();
    who.user = null;
    render(<MemoryRouter initialEntries={["/events"]}><PageViews /><Nav /></MemoryRouter>);
    act(() => nav("/predict"));
    expect(beacons).toEqual([]);
    expect(sendPageView("/")).toBe(false);
  });

  it("a signed-in visitor who isn't the owner is counted as usual", () => {
    setAnalyticsConsent(true);
    who.user = {};
    render(<MemoryRouter initialEntries={["/"]}><PageViews /></MemoryRouter>);
    expect(beacons).toHaveLength(1);
    expect(localStorage.getItem(OWNER_DEVICE_KEY)).toBeNull();
  });
});
