// @vitest-environment jsdom
// No signal, and the event's bundle doesn't hold this match's report (it saves only the chosen team's): the
// report page sends you to the match on the event page, answered from the bundle, instead of a dead end.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => ({ reportKeys: ["qual:0:2"] as string[] | undefined }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, loading: false, error: { offline: true, status: 0, message: "offline" } }) }));
vi.mock("../lib/offline/useBundle", () => ({ useBundleSnapshot: () => null, useBundle: (s: number | null) => ({ meta: null, loading: false, bundle: s == null ? null : { reports: [{ key: "qual:0:2" }] } }) }));
vi.mock("../lib/offline/bundleMeta", async (orig) => ({ ...(await orig<typeof import("../lib/offline/bundleMeta")>()), bundleFor: () => ({ season: 2025, code: "USWABAM1", reportKeys: h.reportKeys }) }));

import MatchReportPage from "./MatchReportPage";

const mount = (key: string) => render(<MemoryRouter initialEntries={[`/events/2025/USWABAM1/match/${key}`]}><Routes><Route path="/events/:season/:code/match/:key" element={<MatchReportPage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); h.reportKeys = ["qual:0:2"]; });

describe("MatchReportPage offline, report not in the bundle", () => {
  it("links to the match on the event page", () => {
    mount("qual:0:5");
    expect(screen.getByText("This match's report isn't saved on this device")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the match on the event page" }).getAttribute("href")).toBe("/events/2025/USWABAM1?tab=matches&match=qual%3A0%3A5");
  });

  it("stays out of the way when the bundle holds the report (its snapshot answers)", () => {
    mount("qual:0:2");
    expect(screen.queryByText("This match's report isn't saved on this device")).toBeNull();
  });

  it("a bundle saved before its report list was kept: reads the list from the bundle itself", () => {
    h.reportKeys = undefined;
    mount("qual:0:5");
    expect(screen.getByRole("link", { name: "Open the match on the event page" })).toBeTruthy();
  });
});
