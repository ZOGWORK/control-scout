// @vitest-environment jsdom
// The "not in your pack" card (./NotInPack.tsx): what the search needs, in plain words, then what the pack holds, with
// its pages to open: never a dead page.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotInPackCard, aboutText, notInPackSentence, packLine } from "./NotInPack";
import type { NotInPack } from "../../../shared/api";

const PACK = { season: 2026, code: "USMIMIQ1", name: "Bullock Creek Qualifier", teams: 34, matches: 53, dataAsOf: "2026-11-14T01:09:00Z" };

describe("not in your pack", () => {
  it("says what the search needs, as read", () => {
    expect(notInPackSentence({ about: ["the 2025–26 season"], packs: [], links: [] })).toBe("This needs data that isn't in your downloaded pack (it's about the 2025–26 season).");
    expect(notInPackSentence({ about: [], packs: [], links: [] })).toBe("This needs data that isn't in your downloaded pack.");
    expect(aboutText(["team 4215", "Worlds", "the 2025–26 season"])).toBe("team 4215, Worlds and the 2025–26 season");
  });

  it("says what the pack holds and when its data is from", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    expect(packLine(PACK, now)).toMatch(/^Bullock Creek Qualifier, 34 teams, 53 matches, data from Nov 1[34], \d{1,2}:09 [AP]M$/);
  });

  it("links to the pack's event and the pages the search named", () => {
    const n: NotInPack = { about: ["team 4215"], packs: [PACK], links: [{ label: "12722 The Viking Warriors", href: "/teams/12722?season=2026" }] };
    render(<MemoryRouter><NotInPackCard notInPack={n} /></MemoryRouter>);
    expect(screen.getByText("This needs data that isn't in your downloaded pack (it's about team 4215).")).toBeTruthy();
    expect(screen.getByRole("link", { name: /12722 The Viking Warriors/ }).getAttribute("href")).toBe("/teams/12722?season=2026");
    expect(screen.getByRole("link", { name: "Open event" }).getAttribute("href")).toBe("/events/2026/USMIMIQ1");
  });
});
