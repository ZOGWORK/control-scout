// @vitest-environment jsdom
// Page views leave the browser only with consent, as route patterns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { PageViews, pageView, sendPageView } from "./analytics";
import { setAnalyticsConsent } from "./consent";
import { cleanHost, cleanLang, parsePageView, routePattern, screenBucket } from "../shared/analytics";

let beacons: { url: string; body: Blob }[] = [];
let nav: (to: string) => void = () => {};
function Nav() { nav = useNavigate(); return null; }
const sentPaths = async () => Promise.all(beacons.map(async (b) => JSON.parse(await b.body.text()).path));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); beacons = [];
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
    expect(Object.keys(first).sort()).toEqual(["lang", "path", "ref", "screen", "session"]);
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
    expect(parsePageView({ path: "/", ref: "", screen: "phone", lang: "fr-CA", session: true })).toEqual({ path: "/", ref: "", screen: "phone", lang: "fr", session: true });
  });
});
