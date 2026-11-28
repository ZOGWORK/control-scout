// @vitest-environment jsdom
// A team featured on Behind the Bot: one badge under the team's actions, for Behind the Bot episodes only, counting
// them ("×4") when there are several and opening the watch page on the newest with the team's own first; Featured in
// lists every video whose title names the team, each opening the watch page; the row chip shows only for a featured team.
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { prime } from "../lib/api";
import type { FeaturedVideo } from "../shared/creatorVideos";
import { FeaturedBadge, FeaturedChip, FeaturedSection } from "./FeaturedVideos";

const BTB: FeaturedVideo = { series: "behind-the-bot", videoId: "qcqcqcqcqc1", season: 2026, title: "21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot" };
const SNAP: FeaturedVideo = { series: null, videoId: "snapsnapsn1", season: 2026, title: "Turret | 21229 Quality Control | FTC BIOBUZZ Snapshot" };

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

function Where() { const l = useLocation(); return <p data-where>{l.pathname + l.search}</p>; }
const atRoot = (ui: React.ReactNode) => (
  <MemoryRouter initialEntries={["/teams/21229"]}>
    <Routes><Route path="/teams/:n" element={ui} /><Route path="/watch/:id" element={<Where />} /></Routes>
  </MemoryRouter>
);

describe("Featured on Behind the Bot", () => {
  it("shows one badge, just \"Behind the Bot\", for Behind the Bot only, and opens the watch page on the newest with the team's own first", () => {
    const { rerender } = render(atRoot(<FeaturedBadge featured={[SNAP]} team={21229} />));
    expect(document.querySelector("[data-featured-badge]")).toBeNull();
    rerender(atRoot(<FeaturedBadge featured={[BTB, SNAP]} team={21229} />));
    const badge = screen.getByRole("link", { name: /Behind the Bot/ });
    expect(badge.textContent).toBe("Behind the Bot");
    expect(document.querySelector("[data-featured-count]")).toBeNull();
    fireEvent.click(badge);
    expect(document.querySelector("[data-where]")?.textContent).toBe(`/watch/${BTB.videoId}?team=21229`);
  });

  it("counts the episodes on one badge when the team was on Behind the Bot more than once", () => {
    render(atRoot(<FeaturedBadge featured={[BTB, { ...BTB, videoId: "olderolder1", season: 2025 }, { ...BTB, videoId: "oldestolde1", season: 2023 }, { ...BTB, videoId: "firstfirst1", season: 2022 }]} team={21229} />));
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(document.querySelector("[data-featured-count]")?.textContent).toBe("×4");
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("Behind the Bot, 4 episodes: watch them");
    expect(screen.getByRole("link").textContent).toBe("Behind the Bot×4");
  });

  it("lists every featured video in Featured in, closed at first, each opening the watch page", () => {
    render(atRoot(<FeaturedSection featured={[BTB, SNAP]} team={21229} />));
    fireEvent.click(screen.getByRole("button", { name: /Featured in/ }));
    expect([...document.querySelectorAll("[data-featured-video]")].map((e) => e.getAttribute("data-featured-video"))).toEqual([BTB.videoId, SNAP.videoId]);
    expect(screen.getByText("Behind the Bot")).toBeTruthy();
    fireEvent.click(document.querySelector(`[data-featured-video="${SNAP.videoId}"]`)!);
    expect(document.querySelector("[data-where]")?.textContent).toBe(`/watch/${SNAP.videoId}?team=21229`);
  });

  it("draws nothing with no featured video", () => {
    render(<MemoryRouter><FeaturedBadge featured={undefined} team={1} /><FeaturedSection featured={[]} team={1} /></MemoryRouter>);
    expect(document.body.textContent).toBe("");
  });

  it("puts the chip on a featured team's row only", () => {
    prime("/api/featured-teams", { teams: [21229] });
    render(<><FeaturedChip team={21229} /><FeaturedChip team={4215} /></>);
    expect(document.querySelectorAll("[data-featured-chip]")).toHaveLength(1);
    expect(screen.getByTitle("Featured on Behind the Bot").textContent).toBe("Behind the Bot");
  });

  it("with a season, reads only that season's featured teams (the rankings table)", () => {
    prime("/api/featured-teams", { teams: [21229, 4215] });
    prime("/api/featured-teams?season=2026", { teams: [21229] });
    render(<><FeaturedChip team={21229} season={2026} /><FeaturedChip team={4215} season={2026} /></>);
    expect(document.querySelectorAll("[data-featured-chip]")).toHaveLength(1);
  });

  it("in a tight table row (fit) keeps only the clapperboard, the words still read, so it never spills into the next column", () => {
    prime("/api/featured-teams", { teams: [21229] });
    render(<><FeaturedChip team={21229} fit /><FeaturedChip team={21229} /></>);
    const [fit, plain] = document.querySelectorAll("[data-featured-chip] > span");
    expect(fit.className).toContain("@max-[17rem]/chiprow:sr-only");
    expect(fit.textContent).toBe("Behind the Bot");
    expect(plain.className).not.toContain("sr-only");
    // The two table rows that use it are the container it measures.
    const read = (f: string) => readFileSync(f, "utf8");
    expect(read("src/pages/RankingsPage.tsx")).toMatch(/@container\/chiprow[\s\S]*<FeaturedChip team=\{r\.team\} season=\{data\.season\} className="self-center" fit \/>/);
    expect(read("src/pages/EventPage.tsx")).toMatch(/@container\/chiprow[\s\S]*<FeaturedChip team=\{t\.team\} className="self-center" fit \/>/);
  });
});
