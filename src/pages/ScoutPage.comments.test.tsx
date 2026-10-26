// @vitest-environment jsdom
// Comment counts on the Scout page's entry cards (Task 15): a workspace entry with comments shows how
// many, live; tapping the count opens the entry (where the thread is). Personal entries never ask.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { saveScoutEntry } from "../lib/scouting";
import { announceComment } from "../lib/scoutComments";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: true, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const asked: string[] = [];
const base = { season: 2025, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  asked.length = 0;
  resetFlags({ ...DEFAULT_FLAGS });
  h.personal.user = {
    id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
    controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [{ id: "901", name: "Gearheads", role: "member" }] },
  };
  saveScoutEntry({ uuid: "gearheads001", ...base, team: 2222, workspaceId: "901" });
  saveScoutEntry({ uuid: "gearheads002", ...base, team: 4444, workspaceId: "901" });
  saveScoutEntry({ uuid: "personal0001", ...base, team: 1111 });
  localStorage.setItem("cs-scout-tpl:901:2025", JSON.stringify({ workspaceId: "901", season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    if (url === "/api/scout/workspaces/901/comment-counts") return new Response(JSON.stringify({ counts: { gearheads001: 3 } }), { status: 200 });
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /><Where /></MemoryRouter></TooltipProvider>);

describe("comment counts on entry cards", () => {
  it("a workspace entry with comments shows the count; it follows live changes; tapping it opens the entry", async () => {
    show("/scout?season=2025&space=901");
    const count = await screen.findByRole("button", { name: "3 comments: open the entry" });
    expect(screen.getAllByRole("button", { name: /comments?: open the entry/ })).toHaveLength(1); // the other entry has none
    act(() => { announceComment({ action: "created", workspaceId: "901", entryUuid: "gearheads002", commentId: 9, count: 1, rev: 50, comment: { id: 9, workspaceId: "901", entryUuid: "gearheads002", authorAccountId: 5, authorName: "Coach", body: "hi", createdAt: 1, editedAt: null } }); });
    expect(screen.getByRole("button", { name: "1 comment: open the entry" })).toBeTruthy();
    fireEvent.click(count);
    await waitFor(() => expect(new URLSearchParams(where.split("?")[1]).get("entry")).toBe("gearheads001"));
    expect(await screen.findByRole("heading", { name: /^comments/i })).toBeTruthy();
  });

  it("Personal: no counts asked for, none shown", async () => {
    show("/scout?season=2025&space=personal");
    await screen.findByText("1111");
    expect(asked.filter((u) => u.includes("comment"))).toEqual([]);
    expect(screen.queryByRole("button", { name: /comments?: open the entry/ })).toBeNull();
  });
});
