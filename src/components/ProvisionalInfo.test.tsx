// @vitest-environment jsdom
// A regional site's registered teams and event info: always labelled with the source and as provisional,
// registered teams first, the waitlist marked and not counted as registered.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ProvisionalInfo } from "../shared/api";
import { ProvisionalDetails, ProvisionalTeams } from "./ProvisionalInfo";

afterEach(cleanup);

const p = (o: Partial<ProvisionalInfo> = {}): ProvisionalInfo => ({
  sourceName: "FTC New Jersey", url: "https://www.newjerseyftc.com/upcoming-events.html", fetchedAt: new Date().toISOString(),
  nickname: null, hosts: "Team 4215 Hypnotic Robotics", venue: "River Dell High School", address: "55 Pyle St, Oradell, NJ 07649", capacity: "30",
  schedule: ["Day Ends 4:30pm"], notes: ["There will be no elimination matches"], closed: false, sessionUnknown: false,
  teams: [
    { team: 6980, name: "Bad Wolf", city: "Oradell", state: "NJ", status: "pending", session: null },
    { team: 207, name: "Critical Mass", city: null, state: null, status: "registered", session: null },
    { team: 4215, name: "Hypnotic Robotics", city: "Oradell", state: "NJ", status: "registered", session: null },
  ],
  ...o,
});

describe("ProvisionalTeams", () => {
  it("counts registered teams only, lists the waitlist last, and names the source", () => {
    render(<MemoryRouter><ProvisionalTeams p={p()} season={2026} team={null} /></MemoryRouter>);
    expect(screen.getByText("2 teams registered")).toBeTruthy();
    const items = [...document.querySelectorAll("li")].map((li) => li.textContent);
    expect(items[0]).toMatch(/^207/);
    expect(items[2]).toMatch(/^6980.*Waitlist$/);
    const link = screen.getByRole("link", { name: /FTC New Jersey \(newjerseyftc\.com\)/ });
    expect(link.getAttribute("href")).toBe("https://www.newjerseyftc.com/upcoming-events.html");
    expect(document.querySelector("[data-provisional-source]")!.textContent).toContain("Provisional: FIRST hasn't published this event yet");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wolf" } });
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("says when the AM/PM session of each team isn't known, and when registration is closed", () => {
    render(<MemoryRouter><ProvisionalTeams p={p({ sessionUnknown: true, closed: true })} season={2026} team={null} /></MemoryRouter>);
    expect(screen.getByText("2 teams registered · registration closed")).toBeTruthy();
    expect(screen.getByText(/doesn't say which session each team is in/)).toBeTruthy();
  });
});

describe("ProvisionalDetails", () => {
  it("shows hosts, address, capacity, times and format, marked provisional", () => {
    render(<ProvisionalDetails p={p({ closed: true })} />);
    const text = document.querySelector("[data-provisional-details]")!.textContent!;
    for (const s of ["Provisional", "Registration closed", "Team 4215 Hypnotic Robotics", "River Dell High School, 55 Pyle St, Oradell, NJ 07649", "30 teams", "Day Ends 4:30pm", "no elimination matches"]) expect(text).toContain(s);
  });
});
