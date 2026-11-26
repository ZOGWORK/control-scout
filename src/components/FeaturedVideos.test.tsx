// @vitest-environment jsdom
// A team featured on Behind the Bot: the header's badge shows for a Behind the Bot episode only (one per episode, with
// its season when there are several) and plays it in the app's dialog; Featured in lists every video whose title names
// the team; the row chip shows only for a featured team.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { prime } from "../lib/api";
import type { FeaturedVideo } from "../shared/creatorVideos";
import { FeaturedBadge, FeaturedChip, FeaturedSection } from "./FeaturedVideos";
import { VideoDialog } from "./VideoDialog";

const BTB: FeaturedVideo = { series: "behind-the-bot", videoId: "qcqcqcqcqc1", season: 2026, title: "21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot" };
const SNAP: FeaturedVideo = { series: null, videoId: "snapsnapsn1", season: 2026, title: "Turret | 21229 Quality Control | FTC BIOBUZZ Snapshot" };

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

describe("Featured on Behind the Bot", () => {
  it("shows the badge for a Behind the Bot episode only, and plays it in the app", () => {
    const { rerender } = render(<MemoryRouter><FeaturedBadge featured={[SNAP]} /><VideoDialog /></MemoryRouter>);
    expect(document.querySelector("[data-featured-badge]")).toBeNull();
    rerender(<MemoryRouter><FeaturedBadge featured={[BTB, SNAP]} /><VideoDialog /></MemoryRouter>);
    const badge = screen.getByRole("button", { name: /Featured on Behind the Bot/ });
    expect(badge.textContent).toBe("Featured on Behind the Bot");
    fireEvent.click(badge);
    const frame = document.querySelector("[data-video-dialog] iframe");
    expect(frame?.getAttribute("src")).toContain(BTB.videoId);
  });

  it("names each episode's season when the team was on Behind the Bot in more than one", () => {
    render(<FeaturedBadge featured={[BTB, { ...BTB, videoId: "olderolder1", season: 2025 }]} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Featured on Behind the Bot · 2026–27", "Featured on Behind the Bot · 2025–26"]);
  });

  it("lists every featured video in Featured in, closed at first", () => {
    render(<MemoryRouter><FeaturedSection featured={[BTB, SNAP]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Featured in/ }));
    expect([...document.querySelectorAll("[data-featured-video]")].map((e) => e.getAttribute("data-featured-video"))).toEqual([BTB.videoId, SNAP.videoId]);
    expect(screen.getByText("Behind the Bot")).toBeTruthy();
  });

  it("draws nothing with no featured video", () => {
    render(<MemoryRouter><FeaturedBadge featured={undefined} /><FeaturedSection featured={[]} /></MemoryRouter>);
    expect(document.body.textContent).toBe("");
  });

  it("puts the chip on a featured team's row only", () => {
    prime("/api/featured-teams", { teams: [21229] });
    render(<><FeaturedChip team={21229} /><FeaturedChip team={4215} /></>);
    expect(document.querySelectorAll("[data-featured-chip]")).toHaveLength(1);
    expect(screen.getByTitle("Featured on Behind the Bot").textContent).toBe("Behind the Bot");
  });
});
