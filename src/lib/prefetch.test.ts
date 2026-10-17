// @vitest-environment jsdom
// Link intent → the page's code and main data start loading (src/lib/prefetch.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOVER_MS, dataFor, installPrefetch } from "./prefetch";
import { matchReportPath } from "./matchReport";

const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
const u = (p: string) => new URL(p, "http://localhost");
const src = (f: string) => readFileSync(join(__dirname, "..", "pages", f), "utf8");

describe("dataFor: the same paths the pages ask for", () => {
  it("team, event, match report, events list, rankings and power rankings", () => {
    expect(dataFor(u("/teams/4215"), 2025)).toEqual(["/api/teams/4215"]);
    expect(dataFor(u("/teams/4215?season=2024"), 2025)).toEqual(["/api/teams/4215?season=2024", "/api/teams/4215/matches?season=2024"]);
    expect(dataFor(u("/teams/0"), 2025)).toEqual([]);
    expect(dataFor(u("/events/2025/USNJCMP"), 2025)).toEqual(["/api/events/2025/USNJCMP"]);
    expect(dataFor(u("/events/2025/USNJCMP/match/QUAL:0:06"), 2025)).toEqual([matchReportPath(2025, "USNJCMP", "qual:0:6")]);
    expect(dataFor(u("/events/2025/X/match/nope"), 2025)).toEqual([]);
    expect(dataFor(u("/events"), 2025)).toEqual(["/api/events?season=2025"]);
    expect(dataFor(u("/events?season=2024&q=x"), 2025)).toEqual(["/api/events?season=2024"]);
    expect(dataFor(u("/events"), undefined)).toEqual([]); // the current season isn't known yet
    expect(dataFor(u("/rankings"), 2025)).toEqual(["/api/rankings"]);
    expect(dataFor(u("/rankings?region=US"), 2025)).toEqual([]);
    expect(dataFor(u("/power-rankings"), 2025)).toEqual(["/api/power-rankings"]);
    expect(dataFor(u("/predict"), 2025)).toEqual([]);
  });

  it("the pages still build those paths the same way (update prefetch.ts when they change)", () => {
    expect(src("TeamPage.tsx")).toContain("useApi<TeamProfile>(valid ? `/api/teams/${team}${qs({ season })}` : null)");
    expect(src("TeamPage.tsx")).toContain("useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches?season=${season}`)");
    expect(src("EventPage.tsx")).toContain("const path = `/api/events/${season}/${code}`;");
    expect(src("EventsPage.tsx")).toContain("useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`)");
    expect(src("RankingsPage.tsx")).toContain("const path = `/api/rankings${qs({ season: seasonParam, region: places.map(placeKey).join(\",\"), week, page: page > 1 ? page : null })}`;");
    expect(src("PowerRankingsPage.tsx")).toContain('(id ? `/api/power-rankings/${id}` : "/api/power-rankings")');
    expect(src("MatchReportPage.tsx")).toContain("matchReportPath(season!, code!, key!)");
  });
});

describe("installPrefetch", () => {
  let stop: () => void;
  const preload = vi.fn();
  const link = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement("a");
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    a.append(document.createElement("span"));
    document.body.append(a);
    return a;
  };
  const hover = (el: Element) => el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  const leave = (el: Element) => el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
  const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    preload.mockClear();
    stop = installPrefetch(preload);
  });
  afterEach(() => { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

  it("a pointer resting on a link loads the page's code and data once", async () => {
    const a = link("/teams/18360");
    hover(a.firstElementChild!);
    expect(preload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HOVER_MS);
    expect(preload).toHaveBeenCalledWith("TeamPage");
    expect(fetched()).toEqual(["/api/teams/18360"]);
    leave(a); hover(a);
    await vi.advanceTimersByTimeAsync(HOVER_MS);
    expect(fetched()).toEqual(["/api/teams/18360"]); // deduped: the cache already has it
  });

  it("sweeping across links loads nothing", async () => {
    const a = link("/teams/1"), b = link("/teams/2");
    hover(a); leave(a); hover(b); leave(b);
    await vi.advanceTimersByTimeAsync(HOVER_MS * 2);
    expect(preload).not.toHaveBeenCalled();
    expect(fetched()).toEqual([]);
  });

  it("touch and keyboard focus load at once", async () => {
    link("/events/2025/AUBRQ2").dispatchEvent(new Event("touchstart", { bubbles: true }));
    link("/power-rankings").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(preload.mock.calls.map((c) => c[0])).toEqual(["EventPage", "PowerRankingsPage"]);
    expect(fetched()).toEqual(["/api/events/2025/AUBRQ2", "/api/power-rankings"]);
  });

  it("never for other sites, new tabs, downloads, or with Save-Data on", async () => {
    const focus = (a: Element) => a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focus(link("https://example.com/teams/3"));
    focus(link("/teams/4", { target: "_blank" }));
    focus(link("/teams/5", { download: "" }));
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    try { focus(link("/teams/6")); } finally { Object.defineProperty(navigator, "connection", { value: undefined, configurable: true }); }
    await vi.advanceTimersByTimeAsync(0);
    expect(preload).not.toHaveBeenCalled();
    expect(fetched()).toEqual([]);
  });
});
