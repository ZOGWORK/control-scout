// @vitest-environment jsdom
// Match videos people add, on the app's side (docs/contributors.md): the credit line ("Video by" the actual name, the
// badge only when verified, likes as the only social action, no dislike or comment anywhere), the event page's
// coverage line, Watch Clips (never a dead button) and gallery in pickMatchVideo's order, and the match page's
// way in for someone signed out.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../../shared/api";
import type { ContributorVideo, EventContributorVideos } from "../../shared/contributors";

const h = vi.hoisted(() => ({
  user: null as null | { id: number },
  event: undefined as EventContributorVideos | undefined,
  match: undefined as unknown,
  like: vi.fn(async (_id: number, on: boolean) => ({ likes: on ? 4 : 3, liked: on })),
  openSignIn: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));
vi.mock("../layout/AccountMenu", () => ({ useOpenSignIn: () => h.openSignIn }));
vi.mock("../AccountSetup", () => ({ useAccountSetup: () => ({ ready: true, ensure: async () => true, open: () => {} }) }));
vi.mock("../ui/sonner", () => ({ toast: Object.assign(h.toast, { success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../lib/contributors", async (orig) => ({
  ...(await orig<typeof import("../../lib/contributors")>()),
  useEventVideos: () => ({ data: h.event, error: undefined, loading: false, reload: async () => {} }),
  useMatchVideos: () => ({ data: h.match, error: undefined, loading: false, reload: async () => {} }),
  likeVideo: h.like,
}));
vi.mock("../../lib/streamSeek", () => ({ playMatchVideo: vi.fn() }));

const { VideoCredit } = await import("./VideoCredit");
const { EventClipsProvider, ClipsGallery, CoverageLine, WatchClipsButton } = await import("./EventClips");
const { MatchContributorPanel } = await import("./MatchContributorPanel");

const cv = (over: Partial<ContributorVideo> = {}): ContributorVideo => ({
  id: 7, videoId: "abcdefghijk", t: 0, tier: "public", team: 4215, name: "Riley Park", verified: true, profile: "/contributors/riley", likes: 3, liked: false, mine: false, ...over,
});
const match = (n: number, over: Partial<MatchView> = {}): MatchView => ({
  key: `qual:0:${n}`, label: `Q${n}`, level: "qual", series: 0, number: n, season: 2025, code: "USNJBE", played: true, video: null, clip: null,
  red: { teams: [1, 2], score: { total: 50 } }, blue: { teams: [3, 4], score: { total: 40 } }, ...over,
} as unknown as MatchView);

beforeEach(() => { h.user = null; h.event = undefined; h.match = undefined; h.like.mockClear(); h.openSignIn.mockClear(); h.toast.mockClear(); });
afterEach(cleanup);

describe("the credit line", () => {
  it("credits the actual name, badges a verified contributor, and has likes but never a dislike or comment", () => {
    const { container } = render(<MemoryRouter><VideoCredit c={cv()} /></MemoryRouter>);
    expect(container.textContent).toMatch(/Video by Riley Park/);
    expect(screen.getByRole("link", { name: "Riley Park" }).getAttribute("href")).toBe("/contributors/riley");
    expect(screen.getByRole("img", { name: "Verified contributor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Like this video, 3 likes/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/dislike|comment/i);
    expect(screen.queryByRole("button", { name: /dislike|comment/i })).toBeNull();
  });

  it("shows no badge for someone not verified, whatever their name says", () => {
    render(<MemoryRouter><VideoCredit c={cv({ verified: false, name: "Sam ✓" })} /></MemoryRouter>);
    expect(screen.queryByRole("img", { name: "Verified contributor" })).toBeNull();
  });

  it("asks someone signed out to sign in to like, and sends nothing", () => {
    render(<MemoryRouter><VideoCredit c={cv()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Like this video/ }));
    expect(h.openSignIn).toHaveBeenCalled();
    expect(h.like).not.toHaveBeenCalled();
  });

  it("likes at once when signed in, then keeps the server's count", async () => {
    h.user = { id: 1 };
    render(<MemoryRouter><VideoCredit c={cv()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Like this video/ }));
    expect(await screen.findByRole("button", { name: /Unlike this video, 4 likes/ })).toBeTruthy();
    expect(h.like).toHaveBeenCalledWith(7, true);
  });
});

describe("the event page's clips", () => {
  const page = (matches: MatchView[]) => render(
    <MemoryRouter>
      <EventClipsProvider season={2025} code="USNJBE">
        <CoverageLine /><WatchClipsButton matches={matches} /><ClipsGallery d={{ matches }} />
      </EventClipsProvider>
    </MemoryRouter>,
  );

  it("has no Watch Clips button and no gallery when nothing can be watched, and says stats only", () => {
    h.event = { matches: {}, coverage: { played: 2, withVideo: 0 } };
    page([match(1), match(2)]);
    expect(screen.queryByRole("button", { name: /Watch Clips/ })).toBeNull();
    expect(document.querySelector("[data-clips-gallery]")).toBeNull();
    expect(screen.getByText("No recording for this event — stats only.")).toBeTruthy();
  });

  it("lists every match with a video, FIRST's own first, with the credit on the one someone added", () => {
    h.event = { matches: { "qual:0:1": cv(), "qual:0:2": cv({ id: 8, name: "Other Person" }) }, coverage: { played: 3, withVideo: 2 } };
    page([match(1), match(2, { video: "https://youtu.be/FIRSTvideo1" } as Partial<MatchView>), match(3)]);
    expect(screen.getByRole("button", { name: /Watch Clips/ })).toBeTruthy();
    const tiles = [...document.querySelectorAll("[data-clip-tile]")].map((t) => t.getAttribute("data-clip-tile"));
    expect(tiles).toEqual(["Q1", "Q2"]);
    expect(screen.getByText("Official match video")).toBeTruthy();
    expect(document.body.textContent).toMatch(/Video by Riley Park/);
    expect(document.body.textContent).not.toMatch(/Other Person/);
  });
});

describe("the match page", () => {
  it("offers Get Verified to someone signed out, and asks them to sign in", () => {
    h.match = { video: null };
    render(<MemoryRouter><MatchContributorPanel m={match(1)} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Get Verified/ }));
    expect(h.openSignIn).toHaveBeenCalled();
  });

  it("offers an unverified team member Get Verified and the team form, with the credit preview first", () => {
    h.user = { id: 2 };
    h.match = { video: null, own: [], me: { status: "none", source: null, teams: [{ number: 4215, name: "Tigers", sources: ["roster"] }], pending: null, rejected: null, ready: true, credit: "Video by Sam Lee" } };
    render(<MemoryRouter><MatchContributorPanel m={match(1)} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Get Verified/ }).getAttribute("href")).toBe("/get-verified");
    expect(screen.getByText("Share with your team")).toBeTruthy();
    expect(document.querySelector("[data-credit-preview]")?.textContent).toMatch(/Will show as: Video by Sam Lee · Visible to Tigers \(4215\) only/);
  });

  it("says another video plays (not FIRST's) when the owner put a link before FIRST's", () => {
    h.user = { id: 2 };
    const me = { status: "verified", source: "application", teams: [], pending: null, rejected: null, ready: true, credit: "Video by Sam Lee" };
    h.match = { video: cv({ overFirst: true }), own: [{ ...cv({ id: 9, name: "Sam Lee", mine: true }), shown: false }], me };
    render(<MemoryRouter><MatchContributorPanel m={match(1, { video: "https://youtu.be/FIRSTvideo1" } as Partial<MatchView>)} /></MemoryRouter>);
    const line = document.querySelector("[data-own-videos]")?.textContent ?? "";
    expect(line).toMatch(/this match already has a video/);
    expect(line).not.toMatch(/FIRST's official video plays first/);
  });
});
