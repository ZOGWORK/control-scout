// @vitest-environment jsdom
// Owner console › Clip coverage as a review screen: two progress meters; the triage lists as count tiles (Actionable
// the default, "To review"); why matches are missing as coloured tiles that filter the chips; one card per event with
// its missing matches as chips coloured by kind, each opening the app's video dialog at its second; Reviewed on the
// card at once (back if the server says no); findings as chips too; bulk Reviewed folded, asking first with its count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CoverageMatch, CoverageTriage, OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";
import { onVideoDialog, type MatchPlay } from "../../lib/streamSeek";
import { resetOptimistic } from "../../lib/optimistic";
import { kindOf, kindTotals, secondOf } from "./clipReview";

const miss = (label: string, o: Partial<CoverageMatch> = {}): CoverageMatch => ({ key: `k-${label}`, label, date: "2025-11-01", clip: false, videoId: "vidA0000001", ...o });
const ev = (code: string, triage: CoverageTriage, triageWhy: string, o: Partial<OwnerCoverageEvent> = {}): OwnerCoverageEvent => ({
  season: 2026, code, name: `${code} meet`, state: "partial", played: 26, withClip: 15, checkedAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null,
  version: `v-${code}`, videos: [{ videoId: "vidA0000001", label: "Sat", date: "2025-11-01", matches: 26, clipped: 15 }], daysMissing: [], missing: [], triage, triageWhy, ...o,
});
const h = vi.hoisted(() => ({ actionable: 1, fail: false, ver: "v-AUSYQ2", paths: [] as string[], sent: [] as { path: string; json: unknown }[] }));
const EVENTS = (): Record<string, OwnerCoverageEvent[]> => ({
  actionable: [ev("AUSYQ2", "actionable", "1 match not yet checked against the video (Q1) (10 more held back for other reasons)", {
    season: 2025, version: h.ver,
    missing: [
      miss("Q1", { video: { checked: null } }),
      miss("Q2", { reason: "gap-unplaced", why: "Checked in the video (2026-11-15): seen at 0:09:40, not yet confirmed", clock: "Video 4 h shorter than its broadcast, no chapters to confirm the clock", video: { checked: "2026-11-15", seenAt: 580 } }),
      miss("Q6", { reason: "no-clock", why: "Video has no broadcast clock (an upload, not a live stream)" }),
      miss("M9", { videoId: null, reason: "no-recording-day" }),
      miss("Q3", { clip: true }),
    ],
  })],
  "early-start": [ev("USAZFLQ", "early-start", "11 matches checked in the video: each starts while the match before is still on, so a clip would open on the wrong match")],
  "no-timing": [ev("USAZGLQ1", "no-timing", "42 matches: Video unavailable or private", { withClip: 0, played: 42, state: "unplaced" })],
  unchecked: [ev("USAZFLQ", "unchecked", "11 matches not yet checked against the video (Q3, Q5, Q6, Q8, Q9, 6 more)", { missing: [miss("Q3", { video: { checked: null } })] })],
  "old-season": [],
  reviewed: [ev("AUSYQ2", "actionable", "Reviewed", { season: 2025, reviewedAt: new Date().toISOString(), reviewedBy: "owner@example.test" })],
});
const page = (list: string): OwnerClipCoverage => ({
  events: list === "actionable" && !h.actionable ? [] : EVENTS()[list] ?? [], list: list as OwnerClipCoverage["list"], open: h.actionable, reviewed: 1,
  categories: { actionable: h.actionable, unchecked: 4, "no-timing": 1, "early-start": 1, unplayable: 0, "old-season": 0 },
  clipChecks: { checked: 120, ok: 117, pulled: 1, unconfirmed: 2, noOverlayVideos: 3 },
  findings: [{ kind: "pulled", season: 2026, code: "USAZFLQ", name: "Flagstaff", label: "Q7", videoId: "flagVideo01", at: 3600, why: "Clip pulled: its first frame shows Q6, not Q7" },
    { kind: "seen", season: 2025, code: "ROCMPCND", name: "Romania COANDA", label: "Q2", videoId: "pvmxbH8YW-k", at: 9952, why: "Checked in the video (2026-11-15): seen at 2:45:52, not yet confirmed" }],
  lastPass: { at: new Date().toISOString(), checked: 1397, events: 1397, full: 770, clipped: 31981, missing: 13947, why: { "not yet checked against the video": 2400, "no-clock": 300, "video-unread": 50 }, unplayable: 900, opened: 0, pending: 2323, pendingBefore: 2400 },
  seasons: [{ season: 2026, open: 2, actionable: 0 }, { season: 2025, open: 3, actionable: 1 }],
  totals: { events: 1392, played: 45695, withClip: 29333, full: 708 },
});
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string) => { h.paths.push(path); return { data: page(new URL(path, "http://x").searchParams.get("list") ?? "actionable"), error: undefined, loading: false, reload: () => {} }; },
  prime: () => {},
  markStale: () => {},
  apiFetch: async (path: string, init: { json: unknown }) => {
    h.sent.push({ path, json: init.json });
    if (h.fail) throw new Error("The list changed");
    return { ...page("actionable"), marked: 2 };
  },
}));
vi.mock("../ui/sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { ClipCoveragePanel } = await import("./ClipCoveragePanel");

let played: MatchPlay[] = [];
let off = () => {};
beforeEach(() => { h.actionable = 1; h.fail = false; h.ver = "v-AUSYQ2"; h.paths = []; h.sent = []; played = []; resetOptimistic(); off = onVideoDialog((p) => played.push(p)); });
afterEach(() => { off(); cleanup(); });
const show = () => render(<MemoryRouter><ClipCoveragePanel /></MemoryRouter>);
const rows = () => [...document.querySelectorAll("[data-coverage-event]")].map((r) => [r.getAttribute("data-coverage-event"), r.getAttribute("data-triage")]);
const chips = (root: ParentNode = document) => [...root.querySelectorAll("[data-coverage-event] [data-chip]")].map((c) => `${c.getAttribute("data-chip")}:${c.getAttribute("data-kind")}`);
const openMore = () => fireEvent.click(screen.getByRole("button", { name: /Bulk review and check details/ }));

describe("clipReview kinds", () => {
  it("sorts each missing match into a kind: a pulled clip, what the frames showed, else its reason", () => {
    expect(kindOf(miss("Q1", { video: { checked: null } }))).toBe("unchecked");
    expect(kindOf(miss("Q1", { video: { checked: "x", seenAt: 5 } }))).toBe("seen");
    expect(kindOf(miss("Q1", { video: { checked: "x", earlyStart: { t: 1, previousEnds: 2 } } }))).toBe("early");
    expect(kindOf(miss("Q1", { video: { checked: "x" } }))).toBe("notfound");
    // The same order as the pass log's videoState, so a tile counts what its chips show: an early start before a
    // sighting, an unread video before anything; one its frames show outside the recording is Outside video, whatever
    // its reason (a gap-unplaced match read in its video: the clock's shortfall is only why the clock couldn't place it).
    expect(kindOf(miss("Q1", { video: { checked: "x", seenAt: 5, earlyStart: { t: 1, previousEnds: 2 } } }))).toBe("early");
    expect(kindOf(miss("Q1", { video: { checked: null, outside: "before the video" } }))).toBe("unchecked");
    expect(kindOf(miss("Q1", { video: { checked: "x", outside: "before the video" } }))).toBe("outside");
    expect(kindOf(miss("Q1", { reason: "gap-unplaced", video: { checked: "x", outside: "played before the recording starts" } }))).toBe("outside");
    expect(kindOf(miss("Q1", { reason: "gap-unplaced", video: { checked: "x", found: "its frames didn't confirm a start" } }))).toBe("notfound");
    expect(kindTotals({ "checked in the video, not in the recording": 2, "checked in the video, no start found": 1 })).toEqual([{ kind: "outside", n: 2 }, { kind: "notfound", n: 1 }]);
    expect(kindOf(miss("Q1", { reason: "gap-unplaced" }))).toBe("unplaced");
    expect(kindOf(miss("Q1", { reason: "video-unavailable" }))).toBe("unavailable");
    expect(kindOf(miss("Q1", { video: { checked: "x", seenAt: 5 } }), true)).toBe("pulled");
    expect(kindTotals({ "no-clock": 3, "video-unread": 2, "seen in the video, no clip (a finding)": 4 })).toEqual([{ kind: "noclock", n: 5 }, { kind: "seen", n: 4 }]);
    expect(secondOf(miss("Q1", { video: { checked: "x", before: { label: "Q0", at: 40 } } }))).toBe(40);
    expect(secondOf(miss("Q1"))).toBeNull();
  });
});

describe("ClipCoveragePanel, a review screen", () => {
  it("shows the two meters and opens on To review, one card per event with a chip per missing match", () => {
    show();
    expect(h.paths[0]).toBe("/api/owner/clip-coverage?list=actionable");
    const events = document.querySelector('[data-coverage-meter="events"]')!;
    expect(events.textContent).toMatch(/^51%708 of 1,392Events fully clipped$/);
    expect(document.querySelector('[data-coverage-meter="matches"]')?.textContent).toMatch(/^64%29,333 of 45,695Matches with a clip$/);
    expect(document.querySelector("[data-coverage-pending]")?.textContent).toMatch(/2,323 waiting for their video check↓ 77$/);
    expect(screen.getByRole("heading", { name: "To review (1)" })).toBeTruthy();
    expect(rows()).toEqual([["2025/AUSYQ2", "actionable"]]);
    // Clipped matches get no chip; the rest in the order played.
    expect(chips()).toEqual(["Q1:unchecked", "Q2:seen", "Q6:noclock", "M9:novideo"]);
    expect(document.querySelector('[data-chip="Q6"]')?.getAttribute("title")).toBe("Q6 · No clock: The video has no broadcast clock to place it from. Opens at the video's start");
    // The raw sentence is one tap away, not on the card.
    expect(document.querySelector("[data-triage-why]")).toBeNull();
    fireEvent.click(document.querySelector("[data-coverage-details]")!);
    expect(document.querySelector("[data-triage-why]")?.textContent).toMatch(/^Actionable1 match not yet checked against the video \(Q1\)/);
    // What the frames showed, with the clock's own reason kept beside it.
    expect(screen.getByText(/· Checked in the video \(2026-11-15\): seen at 0:09:40, not yet confirmed\. The clock: Video 4 h shorter than its broadcast/)).toBeTruthy();
  });

  it("a chip opens the app's video dialog at its second, with the match's label", () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-event] [data-chip="Q2"]')!);
    expect(played).toEqual([{ videoId: "vidA0000001", t: 580, label: "2025 AUSYQ2 Q2 · Seen, no clip · 0:09:40" }]);
    // No video, nothing to open: not a button.
    expect(document.querySelector('[data-chip="M9"]')?.tagName).toBe("SPAN");
    // A finding opens at its own frame.
    fireEvent.click(document.querySelector('[data-coverage-finding="2025/ROCMPCND/Q2"] [data-chip]')!);
    expect(played.at(-1)).toEqual({ videoId: "pvmxbH8YW-k", t: 9952, label: "2025 ROCMPCND Q2 · Seen, no clip · 2:45:52" });
    expect(document.querySelector('[data-coverage-finding="2026/USAZFLQ/Q7"] [data-chip]')?.getAttribute("data-kind")).toBe("pulled");
    expect(screen.getByRole("heading", { name: "Found in the video (2)" })).toBeTruthy();
  });

  it("the list tiles switch the list: Early start shows Flagstaff, No timing shows Glendale", () => {
    show();
    expect(document.querySelector('[data-coverage-list="unchecked"]')?.textContent).toBe("4Not yet checked");
    fireEvent.click(document.querySelector('[data-coverage-list="early-start"]')!);
    expect(h.paths.at(-1)).toBe("/api/owner/clip-coverage?list=early-start");
    expect(rows()).toEqual([["2026/USAZFLQ", "early-start"]]);
    fireEvent.click(document.querySelector('[data-coverage-list="no-timing"]')!);
    expect(rows()).toEqual([["2026/USAZGLQ1", "no-timing"]]);
    expect(document.querySelector('[data-coverage-list="no-timing"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("the reason tiles count every missing match by kind and show only that kind's chips", () => {
    show();
    const tiles = [...document.querySelectorAll("[data-coverage-kind]")].map((t) => `${t.getAttribute("data-coverage-kind")} ${t.textContent}`);
    // A match whose recording can't be played isn't missing (the pass counts it apart): no tile, a count in the heading.
    expect(tiles).toEqual(["unchecked Not checked2,400", "noclock No clock350"]);
    expect(document.querySelector("[data-coverage-pass] h3")?.textContent).toContain("900 more whose recording can't be played");
    fireEvent.click(document.querySelector('[data-coverage-kind="noclock"]')!);
    expect(chips()).toEqual(["Q6:noclock"]);
    // No finding is that kind: the findings step aside.
    expect(document.querySelector("[data-coverage-findings]")).toBeNull();
    fireEvent.click(document.querySelector("[data-coverage-only-clear]")!);
    expect(chips()).toHaveLength(4);
  });

  it("Reviewed takes the card off at once and sends its version; a no from the server puts it back", async () => {
    show();
    fireEvent.click(document.querySelector("[data-coverage-reviewed]")!);
    expect(rows()).toEqual([]);
    await waitFor(() => expect(h.sent).toEqual([{ path: "/api/owner/clip-coverage/2025/AUSYQ2/reviewed", json: { version: "v-AUSYQ2" } }]));
    // It's on the Reviewed list.
    fireEvent.click(document.querySelector('[data-coverage-list="reviewed"]')!);
    expect(rows()).toEqual([["2025/AUSYQ2", "actionable"]]);
    // Its missing list changes (a new version) and it opens again: back on To review, not left hidden.
    h.ver = "v-AUSYQ2-new";
    fireEvent.click(document.querySelector('[data-coverage-list="actionable"]')!);
    expect(rows()).toEqual([["2025/AUSYQ2", "actionable"]]);
    cleanup();
    h.fail = true;
    show();
    fireEvent.click(document.querySelector("[data-coverage-reviewed]")!);
    expect(rows()).toEqual([]);
    await waitFor(() => expect(rows()).toEqual([["2025/AUSYQ2", "actionable"]]));
  });

  it("never offers Reviewed for a match not yet checked against the video", () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-list="unchecked"]')!);
    expect(h.paths.at(-1)).toBe("/api/owner/clip-coverage?list=unchecked");
    expect(rows()).toEqual([["2026/USAZFLQ", "unchecked"]]);
    expect(document.querySelector("[data-coverage-reviewed]")).toBeNull();
    expect(document.querySelector('[data-coverage-bulk="unchecked"]')).toBeNull();
  });

  it("Mark all non-actionable asks first, says how many, and sends that count; Cancel marks nothing", async () => {
    show();
    openMore();
    expect(document.querySelector('[data-coverage-bulk="non-actionable"]')?.textContent).toMatch(/\(2\)$/);
    fireEvent.click(document.querySelector('[data-coverage-bulk="non-actionable"]')!);
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.sent).toEqual([]);
    fireEvent.click(document.querySelector('[data-coverage-bulk="non-actionable"]')!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 2 events reviewed?" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 2 events reviewed/ }));
    await waitFor(() => expect(h.sent).toEqual([{ path: "/api/owner/clip-coverage/bulk-reviewed", json: { category: "non-actionable", season: undefined, expected: 2 } }]));
  });

  it("marks a whole category, or a whole season, the same way", async () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-list="no-timing"]')!);
    fireEvent.click(document.querySelector('[data-coverage-bulk="no-timing"]')!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Mark 1 event reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: "no-timing", season: undefined, expected: 1 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openMore();
    fireEvent.change(document.querySelector("[data-coverage-season]")!, { target: { value: "2025" } });
    fireEvent.click(document.querySelector('[data-coverage-bulk="season"]')!);
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 2 events reviewed?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/that isn't Actionable \(1 Actionable event stays under To review\)/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 2 events reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: "non-actionable", season: 2025, expected: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(document.querySelector("[data-coverage-season-actionable]")!);
    fireEvent.click(document.querySelector('[data-coverage-bulk="season"]')!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 3 events reviewed?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/including its 1 Actionable/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 3 events reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: undefined, season: 2025, expected: 3 }));
  });

  it("keeps the clip checks and the last pass in numbers, folded", () => {
    show();
    expect(document.querySelector("[data-coverage-clip-checks]")).toBeNull();
    openMore();
    expect(document.querySelector("[data-coverage-clip-checks]")?.textContent).toBe("Clips checked by their first frame120Checked117Confirmed1Pulled2Read again3No overlay");
    expect(document.querySelector("[data-coverage-last-pass]")?.textContent).toMatch(/: 1,397 events checked · 770 fully clipped · 31,981 matches clipped · 13,947 missing · 900 whose recording can't be played \(not counted as missing\)\.$/);
  });

  it("says 0 to review plainly when nothing is actionable", () => {
    h.actionable = 0;
    show();
    expect(screen.getByRole("heading", { name: "To review (0)" })).toBeTruthy();
    expect(screen.getByText("0 to review")).toBeTruthy();
    expect(rows()).toEqual([]);
  });
});
