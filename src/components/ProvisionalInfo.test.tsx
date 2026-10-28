// @vitest-environment jsdom
// A regional site's registered teams and event info: always labelled with the source and as provisional,
// registered teams first, the waitlist apart (not in the event) and not counted as registered.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ProvisionalInfo } from "../shared/api";
import { ProvisionalDetails, ProvisionalTeams, SharedSessionTeams } from "./ProvisionalInfo";

afterEach(cleanup);

const p = (o: Partial<ProvisionalInfo> = {}): ProvisionalInfo => ({
  sourceName: "FTC New Jersey", url: "https://www.newjerseyftc.com/upcoming-events.html", fetchedAt: new Date().toISOString(),
  nickname: null, hosts: "Team 4215 Hypnotic Robotics", venue: "River Dell High School", address: "55 Pyle St, Oradell, NJ 07649", capacity: "30",
  schedule: ["Day Ends 4:30pm"], notes: ["There will be no elimination matches"], closed: false, sessionUnknown: false,
  teams: [
    { team: 6980, name: "Bad Wolf", city: "Oradell", state: "NJ", status: "pending", session: null, known: true },
    { team: 207, name: "Critical Mass", city: null, state: null, status: "registered", session: null, known: false },
    { team: 4215, name: "Hypnotic Robotics", city: "Oradell", state: "NJ", status: "registered", session: null, known: true },
  ],
  ...o,
});

describe("ProvisionalTeams", () => {
  it("lists registered teams as the event's, the waitlist apart (not in the event), and names the source", () => {
    render(<MemoryRouter><ProvisionalTeams p={p()} season={2026} team={null} /></MemoryRouter>);
    expect(screen.getByText("2 teams registered · 1 on the waitlist")).toBeTruthy();
    const listed = (name: string) => [...screen.getByRole("list", { name }).querySelectorAll("li")].map((li) => li.textContent);
    expect(listed("Registered teams")).toEqual([expect.stringMatching(/^207/), expect.stringMatching(/^4215/)]);
    expect(listed("Waitlisted teams")).toEqual([expect.stringMatching(/^6980/)]);
    expect(screen.getByRole("heading", { name: "Waitlist (1)" })).toBeTruthy();
    expect(document.querySelector("[data-provisional-waitlist]")!.textContent).toContain("not in this event unless a spot opens");
    const link = screen.getByRole("link", { name: /FTC New Jersey \(newjerseyftc\.com\)/ });
    expect(link.getAttribute("href")).toBe("https://www.newjerseyftc.com/upcoming-events.html");
    expect(document.querySelector("[data-provisional-source]")!.textContent).toContain("Provisional: FIRST hasn't published this event yet");
    // 207 isn't in FIRST's team list yet: no link to a team page that would 404.
    expect(document.querySelector("[data-team-unknown]")!.textContent).toMatch(/^207/);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/teams/4215?season=2026");
    expect(screen.queryAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("/teams/207"))).toBe(false);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wolf" } });
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("says when the AM/PM session of each team isn't known, and when registration is closed", () => {
    render(<MemoryRouter><ProvisionalTeams p={p({ sessionUnknown: true, closed: true })} season={2026} team={null} /></MemoryRouter>);
    expect(screen.getByText("2 teams registered for the morning and afternoon sessions · 1 on the waitlist · registration closed")).toBeTruthy();
    expect(screen.getByText(/doesn't say which session each team is in/)).toBeTruthy();
  });
});

describe("SharedSessionTeams", () => {
  it("lists FIRST's teams for both sessions as that, never as this session's, and links the other session", () => {
    const s = { fetchedAt: new Date().toISOString(), other: { code: "USNJNEM3", name: "P1-5 PM Northeast League Meet" },
      teams: [{ team: 12636, name: "IHA Blue Eagles", city: "Ho-Ho-Kus", state: "NJ" }, { team: 10243, name: "Ramblers", city: null, state: null }] };
    render(<MemoryRouter><SharedSessionTeams s={s} season={2026} team={null} /></MemoryRouter>);
    expect(screen.getByText("2 teams registered for the morning and afternoon sessions")).toBeTruthy();
    expect(document.querySelector("[data-shared-sessions]")!.textContent).toContain("each team plays in one of them, and FIRST doesn't say which yet");
    expect(screen.getByRole("link", { name: "P1-5 PM Northeast League Meet" }).getAttribute("href")).toBe("/events/2026/USNJNEM3?tab=teams");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("ProvisionalDetails", () => {
  it("shows hosts, address, capacity, times and format, marked provisional", () => {
    render(<ProvisionalDetails p={p({ closed: true })} />);
    const text = document.querySelector("[data-provisional-details]")!.textContent!;
    for (const s of ["Provisional", "Registration closed", "Team 4215 Hypnotic Robotics", "River Dell High School, 55 Pyle St, Oradell, NJ 07649", "30 teams", "Day Ends 4:30pm", "no elimination matches"]) expect(text).toContain(s);
  });
});
