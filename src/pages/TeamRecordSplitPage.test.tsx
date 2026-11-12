// @vitest-environment jsdom
// /teams/:number/record-split: the same card Search draws for "<number> record", qualifications and playoffs apart,
// under a header naming the page, with the way back to the team's page; the route and the top bar's name are its own.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pageModule, pageTitle } from "../shared/routes";
import type { StatAnswer } from "../shared/searchStat";
import TeamRecordSplitPage from "./TeamRecordSplitPage";

const stat: StatAnswer = {
  family: "aggregate", intent: "record", title: "Record in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" }, scope: ["2025–26"],
  headline: { value: "26-6-0", label: "81% win rate in 32 matches in 2025–26", sub: "Official events only" },
  blocks: [{ kind: "record", title: "Wins, losses and ties", wins: 26, losses: 6, ties: 0, split: { quals: { wins: 22, losses: 4, ties: 0 }, playoffs: { wins: 4, losses: 2, ties: 0 } } }],
  definition: "Results use the official scores, penalties included.", source: "From 32 match records at 5 events, 2025–26",
};
const asked: (string | null)[] = [];
let answer: { team: { number: number; name: string | null }; stat: StatAnswer } | undefined = { team: { number: 4215, name: "Hypnotic Robotics" }, stat };
let failure: { status: number; offline: boolean } | undefined;
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => { asked.push(path); return { data: path && !failure ? answer : undefined, error: failure, loading: false, reload: () => {} }; },
}));
const titles: string[] = [];
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: (t: string) => { titles.push(t); } }));

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/teams/:number/record-split" element={<TeamRecordSplitPage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); asked.length = 0; titles.length = 0; });

describe("team record-split page", () => {
  it("draws Search's record card under its own heading, and links back to the team page", () => {
    open("/teams/4215/record-split");
    expect(asked).toContain("/api/teams/4215/record-split");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("4215 Hypnotic Robotics record");
    expect(document.body.textContent).toContain("26-6-0");
    expect(document.body.textContent).toMatch(/22.?4.?0/); // the quals record, apart
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/teams/4215")).toBe(true);
    expect(titles.at(-1)).toBe("4215 Hypnotic Robotics record, quals vs playoffs, 2025–26");
  });

  it("asks for nothing at an address that names no team", () => {
    answer = undefined;
    open("/teams/abc/record-split");
    expect(asked.every((p) => p == null)).toBe(true);
    expect(screen.getByText("No such team")).toBeTruthy();
    answer = { team: { number: 4215, name: "Hypnotic Robotics" }, stat };
  });

  it("a team with no page: says so plainly, with the way to its team page", () => {
    failure = { status: 404, offline: false };
    open("/teams/5555/record-split");
    expect(screen.getByText("No playoff record yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Team 5555" }).getAttribute("href")).toBe("/teams/5555");
    failure = undefined;
  });

  it("is its own route and top-bar name", () => {
    expect(pageModule("/teams/4215/record-split")).toBe("TeamRecordSplitPage");
    expect(pageModule("/Teams/4215/Record-Split/")).toBe("TeamRecordSplitPage");
    expect(pageTitle("/teams/4215/record-split")).toBe("Team record");
    expect(pageModule("/teams/4215/extra")).toBe("NotFound");
  });
});
