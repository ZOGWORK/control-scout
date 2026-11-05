// @vitest-environment jsdom
// An award-at-event answer: the asked award's podium (1st in the centre), every award the event gave, and its
// Awards tab one tap away. An older server's card (lines only) still draws.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchCard } from "../../../shared/api";
import { EventAwardsAnswer } from "./EventAwards";

afterEach(cleanup);
const lines: SearchCard["lines"] = [
  { text: "4215 Hypnotic Robotics", detail: "Inspire Award", results: ["Winner"], href: "/teams/4215" },
  { text: "207 Critical Mass", detail: "Inspire Award 2nd Place", results: ["2nd place"], href: "/teams/207" },
];
const card: SearchCard = {
  kind: "event-awards", title: "Inspire Award · East Bergen Conference Northern League Tournament · 2025–26", lines, award: "Inspire",
  event: { season: 2025, code: "USNJNOLT2", name: "East Bergen Conference Northern League Tournament" },
  awards: [
    { type: "Inspire", placement: 1, team: 4215, teamName: "Hypnotic Robotics", name: "Inspire Award" },
    { type: "Inspire", placement: 2, team: 207, teamName: "Critical Mass", name: "Inspire Award 2nd Place" },
    { type: "Inspire", placement: 3, team: 13617, teamName: "Bectobots", name: "Inspire Award 3rd Place" },
    { type: "Think", placement: 1, team: 6980, teamName: "Bad Wolf", name: "Think Award" },
  ],
};
const draw = (c: SearchCard) => render(<MemoryRouter><EventAwardsAnswer card={c} /></MemoryRouter>).container;

describe("award-at-event answer", () => {
  it("puts the asked award's places on a podium, 2nd, 1st, 3rd, with 1st in the centre", () => {
    const c = draw(card);
    const steps = [...c.querySelectorAll("[data-podium] [data-place]")];
    expect(steps.map((s) => s.getAttribute("data-place"))).toEqual(["2", "1", "3"]);
    expect(steps[1].className).toContain("col-start-2");
    expect(steps[1].textContent).toContain("4215");
    expect(steps[1].querySelector("a")!.getAttribute("href")).toBe("/teams/4215?season=2025");
  });
  it("a lone winner still stands in the centre", () => {
    const c = draw({ ...card, awards: card.awards!.filter((x) => x.placement === 1) });
    expect(c.querySelector("[data-podium] [data-place='1']")!.className).toContain("col-start-2");
  });
  it("lists the event's other awards (the podium's places not again) and links to its Awards tab", () => {
    const c = draw(card);
    expect(c.querySelectorAll("[data-all-awards] [data-award]")).toHaveLength(1);
    expect(c.querySelector("[data-all-awards] h3")!.textContent).toBe("Other awards at this event · 1");
    expect(c.querySelector("[data-all-awards]")!.textContent).toContain("Think Award");
    expect(c.querySelector("[data-awards-page]")!.getAttribute("href")).toBe("/events/2025/USNJNOLT2?tab=awards");
  });
  it("draws no podium for a who-won card (no award asked), and an older card's lines as before", () => {
    expect(draw({ ...card, award: undefined }).querySelector("[data-podium]")).toBeNull();
    const old = draw({ kind: "event-awards", title: "Awards", lines });
    expect(old.querySelector("[data-lines]")!.textContent).toContain("207 Critical Mass");
    expect(old.querySelector("[data-awards-page]")).toBeNull();
  });
});
