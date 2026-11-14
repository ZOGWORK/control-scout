// @vitest-environment jsdom
// The event page's coverage line as the page wires it (RecordingCoverageLine): it reads the coverage check's missing
// days, so a recorded event with a day that has no recording reads "Partially recorded", never "Recording only" or
// "Full"; it waits for the check rather than say "Recording only" first; a recording that won't play keeps saying so.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../../shared/api";

const h = vi.hoisted(() => ({ api: { data: undefined as unknown, error: undefined as unknown }, paths: [] as (string | null)[] }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => { h.paths.push(path); return { ...h.api, loading: !h.api.data && !h.api.error, reload: async () => {} }; },
}));
vi.mock("../../lib/contributors", async (orig) => ({
  ...(await orig<typeof import("../../lib/contributors")>()),
  useEventVideos: () => ({ data: { matches: {}, coverage: { played: 3, withVideo: 0 } }, error: undefined, loading: false, reload: async () => {} }),
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null }, syncReady: false }) }));

const { EventClipsProvider } = await import("./EventClips");
const { RecordingCoverageLine } = await import("./RecordingGaps");

const m = (n: number, day: string): MatchView => ({
  key: `qual:0:${n}`, label: `Q${n}`, level: "qual", series: 0, number: n, season: 2025, code: "FPEWESEA", played: true, video: null, clip: null,
  time: `${day}T14:0${n}:00.5`, red: { teams: [1, 2] }, blue: { teams: [3, 4] },
} as unknown as MatchView);
const matches = [m(1, "2026-05-29"), m(2, "2026-05-30"), m(3, "2026-05-31")];
const coverage = (daysMissing: { date: string; label: string; matches: number }[]) => ({ state: "unplaced", played: 3, withClip: 0, videos: [], daysMissing, matches: [] });
const line = (o: { playable?: boolean; unplayable?: boolean } = {}) => render(
  <MemoryRouter>
    <EventClipsProvider season={2025} code="FPEWESEA">
      <RecordingCoverageLine season={2025} code="FPEWESEA" recorded matches={matches} videos={["SATURDAYv01"]} reserve playable={o.playable ?? true} unplayable={o.unplayable ?? false} />
    </EventClipsProvider>
  </MemoryRouter>,
);
const state = () => document.querySelector("[data-coverage]")?.getAttribute("data-coverage") ?? null;

beforeEach(() => { h.api = { data: undefined, error: undefined }; h.paths = []; });
afterEach(cleanup);

describe("the event page's coverage line, wired to the coverage check", () => {
  it("a day with no recording reads partly recorded, never 'Recording only' or 'Full' (FPEWESEA 2025)", () => {
    h.api.data = coverage([{ date: "2026-05-29", label: "Friday", matches: 1 }, { date: "2026-05-31", label: "Sunday", matches: 1 }]);
    line();
    expect(screen.getByText("Partially recorded — 0 of 3 matches have video")).toBeTruthy();
    expect(state()).toBe("partial");
    expect(document.body.textContent).not.toMatch(/Full|Recording only/);
    expect(h.paths.every((p) => p?.startsWith("/api/events/2025/FPEWESEA/coverage?m="))).toBe(true);
  });

  it("every day recorded, no clip placed: 'Recording only'", () => {
    h.api.data = coverage([]);
    line();
    expect(screen.getByText("Recording only — no match clips in it yet")).toBeTruthy();
    expect(state()).toBe("recording");
  });

  it("waits for the check rather than say 'Recording only' first, keeping the line's room", () => {
    line();
    expect(state()).toBeNull();
    expect(document.body.textContent).not.toMatch(/Recording only/);
    expect(document.querySelector("p[aria-hidden]")).toBeTruthy();
  });

  it("goes on without the check when it fails", () => {
    h.api.error = new Error("offline");
    line();
    expect(state()).toBe("recording");
  });

  it("a recording that won't play keeps saying so, missing days or not", () => {
    h.api.data = coverage([{ date: "2026-05-29", label: "Friday", matches: 1 }]);
    line({ playable: false, unplayable: true });
    expect(state()).toBe("unplayable");
    expect(screen.getByText("This event's recording won't play (private or removed) — stats only")).toBeTruthy();
  });
});
