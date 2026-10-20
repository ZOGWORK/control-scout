// @vitest-environment jsdom
// Pick list order changes kept through a reload (picklistOps.ts, sharedPicklist.ts, KeptPickChanges.tsx): a change
// that didn't reach the workspace survives the page reloading, is checked with the server by its op id first (one
// the server already took simply goes), and waits with Retry and Discard. Retry sends it once (same op id), to its
// own workspace and season, as its own account; a conflict (the list changed since, a deleted anchor, the team gone)
// or a destination it can't reach (revoked, read-only, another account) is shown and never sent without the member.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PickList } from "../../shared/picklist";
import type { ShortlistTeam } from "../../shared/api";
import { resetFailedChanges, retryFailedChange, setPicklistAccount, useFailedChanges } from "../../lib/sharedPicklist";
import { keptOps, putKeptOp, resetKeptOps, type KeptPickOp } from "../../lib/picklistOps";
import { SharedPicklist } from "./SharedPicklist";

const S = 2025;
const team = (n: number): ShortlistTeam => ({
  team: n, name: `Team ${n} name`, place: "Sydney", opr: 50, oprRank: 10, of: 500, rating: null, ratingSd: null, record: "8-2-0",
  lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
});
const pick = (n: number, rank: number) => ({ team: n, rank, addedBy: { accountId: 1, name: "Priya" }, addedAt: Date.now() - 60_000, note: "", noteBy: null, noteUpdatedAt: null });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const listOf = (teams: number[], version: number): PickList => ({ workspaceId: "901", season: S, version, picks: teams.map((t, i) => pick(t, i + 1)) });

let server: PickList;
let posts: Record<string, unknown>[];
let appliedIds: Set<string>;
/** How many changes the server applied (a copy of one already applied is not one). */
let applied: number;
/** The next N posts are lost before they arrive (never applied, no answer). */
let dropPosts: number;
/** The next N posts are applied, then their answer is lost. */
let loseAnswers: number;
/** Every request for workspace 901's list answers this status (403: removed from the workspace; 423: read-only). */
let denied: number | null;
/** The account the server has signed in (a post for another answers 409 WRONG_ACCOUNT). */
let signedIn: number;

function apply(body: Record<string, unknown>): Response {
  const teams = server.picks.map((p) => p.team);
  const t = body.team as number;
  if (body.op === "move") {
    const anchor = (body.afterTeam ?? body.beforeTeam) as number | null | undefined;
    if (!teams.includes(t) || (anchor != null && !teams.includes(anchor))) return json(409, { error: "That team was removed from the pick list meanwhile. Here's the list as it is now.", list: server });
    const rest = teams.filter((x) => x !== t);
    rest.splice(body.afterTeam != null ? rest.indexOf(body.afterTeam as number) + 1 : body.beforeTeam == null ? rest.length : rest.indexOf(body.beforeTeam as number), 0, t);
    server = listOf(rest, server.version + 1);
  } else if (body.op === "remove") {
    if (!teams.includes(t)) return json(200, { changed: false, list: server });
    server = listOf(teams.filter((x) => x !== t), server.version + 1);
  } else if (body.op === "add") {
    if (teams.includes(t)) return json(200, { changed: false, list: server });
    const at = body.beforeTeam == null ? -1 : teams.indexOf(body.beforeTeam as number);
    const next = [...teams];
    next.splice(at < 0 ? next.length : at, 0, t);
    server = listOf(next, server.version + 1);
  }
  applied++;
  return json(200, { changed: true, list: server });
}

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  await resetKeptOps();
  resetFailedChanges();
  posts = []; appliedIds = new Set(); applied = 0; dropPosts = 0; loseAnswers = 0; denied = null; signedIn = 1;
  server = listOf([101, 102, 103], 3);
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (denied) return json(denied, { error: denied === 423 ? "This workspace is read-only." : "You're not a member of this workspace in Control Point." });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        if (dropPosts > 0) { dropPosts--; throw new TypeError("Failed to fetch"); }
        if (body.account !== undefined && body.account !== signedIn) return json(409, { error: "This change was made by another account, so it wasn't sent as yours. Sign in as that account to send it, or discard it." });
        if (typeof body.opId === "string" && appliedIds.has(body.opId)) return json(200, { changed: false, replayed: true, list: server });
        const { opId: _o, account: _a, season: _s, ...op } = body;
        const res = apply(op);
        if (res.status === 200 && typeof body.opId === "string") appliedIds.add(body.opId);
        if (loseAnswers > 0) { loseAnswers--; throw new TypeError("Failed to fetch"); }
        return res;
      }
      const asked = new URLSearchParams(path.split("?")[1] ?? "").get("ops");
      return json(200, asked ? { list: server, appliedOps: asked.split(",").filter((x) => appliedIds.has(x)) } : { list: server });
    }
    if (path.startsWith("/api/shortlist")) {
      const asked = new URLSearchParams(path.split("?")[1]).get("teams")!.split(",").map(Number);
      return json(200, { season: S, teams: asked.map(team) });
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rows = () => [...document.querySelectorAll("[data-reorder-key]")].map((e) => Number(e.getAttribute("data-reorder-key")));
const notice = () => screen.queryByRole("region", { name: /unsaved pick-list change/ });
const moves = () => posts.filter((p) => p.op === "move");

function show(me = { accountId: 1, name: "Priya" }) {
  return render(<MemoryRouter><SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={me} shortlist={[]} /></MemoryRouter>);
}
/** The page reloads: everything on it is gone; what the device keeps stays. */
async function reload(me = { accountId: 1, name: "Priya" }) {
  cleanup();
  resetFailedChanges();
  show(me);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}
const kept = (o: Partial<KeptPickOp> = {}): KeptPickOp => ({
  account: 1, space: "901", season: S, opId: "kept-op-0001", op: { op: "move", team: 103, beforeTeam: 101 }, at: Date.now() - 5000,
  base: [101, 102, 103], baseVersion: 3, state: "kept", tab: "an-earlier-page", message: "Not saved: offline", ...o,
});

describe("a pick list order change kept through a reload", () => {
  it("survives the reload with its op id; the notice says how many, and Retry sends it once to its own list", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102, 103]));
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 103/ }), { key: "ArrowUp" });
    await waitFor(() => expect(notice()).toBeTruthy());
    await waitFor(async () => expect((await keptOps(1))[0]?.state).toBe("kept"));
    const stored = await keptOps(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ space: "901", season: S, state: "kept", op: { op: "move", team: 103, beforeTeam: 102 }, base: [101, 102, 103], baseVersion: 3 });
    const opId = stored[0].opId;
    expect(moves()[0].opId).toBe(opId);

    await reload();
    await waitFor(() => expect(notice()).toBeTruthy());
    expect(screen.getByRole("heading", { name: "1 unsaved pick-list change" })).toBeTruthy();
    expect(screen.getByText("Move 103 in the pick list")).toBeTruthy();
    expect(posts).toHaveLength(1); // nothing sent again by itself
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(moves()).toHaveLength(2);
    expect(moves()[1]).toMatchObject({ opId, account: 1, season: S, op: "move", team: 103, beforeTeam: 102 });
    expect(server.picks.map((p) => p.team)).toEqual([101, 103, 102]);
    expect(await keptOps(1)).toEqual([]);
  });

  it("one the server already took (its answer was lost, then the page reloaded) simply goes: no notice, nothing sent", async () => {
    appliedIds.add("landed-op-0001");
    await putKeptOp(kept({ opId: "landed-op-0001", state: "sending" }));
    await putKeptOp(kept({ opId: "missed-op-0002", state: "sending", at: Date.now() - 1000 }));
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    expect(screen.getByRole("heading", { name: "1 unsaved pick-list change" })).toBeTruthy();
    expect(posts).toEqual([]);
    await waitFor(async () => expect((await keptOps(1)).map((r) => r.opId)).toEqual(["missed-op-0002"]));
  });

  it("a retry whose answer is lost, sent again: applied once (same op id)", async () => {
    await putKeptOp(kept());
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    loseAnswers = 1;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // The check after the lost answer finds its op id applied: saved.
    await waitFor(() => expect(notice()).toBeNull());
    expect(applied).toBe(1);
    // A copy sent anyway (another tab, say) changes nothing.
    const again = await fetch("/api/scout/workspaces/901/picklist", { method: "POST", body: JSON.stringify({ season: S, op: "move", team: 103, beforeTeam: 101, opId: "kept-op-0001", account: 1 }) });
    expect(await again.json()).toMatchObject({ replayed: true });
    expect(applied).toBe(1);
  });

  it("the list changed since: shows what changed (colour-coded), sends nothing until Apply mine anyway", async () => {
    await putKeptOp(kept({ op: { op: "move", team: 103, beforeTeam: 101 } }));
    server = listOf([102, 101, 103, 18360], 6); // someone moved 102 up and added 18360
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/The list changed since you made this: 1 team added \(18360\)/)).toBeTruthy());
    expect(screen.getByText(/The pick list changed since you made these/)).toBeTruthy();
    expect(within(notice()!).getByText("18360").closest("span")!.className).toMatch(/text-success/);
    expect(moves()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Apply mine anyway" }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(moves()).toEqual([expect.objectContaining({ op: "move", team: 103, beforeTeam: 101, opId: "kept-op-0001" })]);
    expect(server.picks.map((p) => p.team)).toEqual([102, 103, 101, 18360]);
  });

  it("the team it was placed next to was deleted: said where it goes instead, and applied there when asked", async () => {
    // Moved 103 up to just before 102; 102 was removed since.
    await putKeptOp(kept({ op: { op: "move", team: 103, beforeTeam: 102 } }));
    server = listOf([101, 103], 5);
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/102, which it was placed next to, was removed. Applied now, it goes just after 101\./)).toBeTruthy());
    expect(moves()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Apply anyway: Move 103/ }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(moves()).toEqual([expect.objectContaining({ op: "move", team: 103, beforeTeam: null, afterTeam: 101 })]);
  });

  it("the team it moves is gone: only Discard, and Discard forgets it on the device", async () => {
    await putKeptOp(kept({ op: { op: "move", team: 103, beforeTeam: 101 } }));
    server = listOf([101, 102], 5);
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("103 is no longer on the pick list, so this move can't apply.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Apply anyway|^Retry/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard: Move 103 in the pick list" }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(await keptOps(1)).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("a workspace this account can't reach any more (or a read-only one): nothing is sent; it's kept until discarded", async () => {
    await putKeptOp(kept());
    denied = 403;
    show();
    // The list itself can't load, but the notice still says what's kept and why.
    await waitFor(() => expect(screen.getByText(/can't reach that workspace any more/)).toBeTruthy());
    expect(screen.getByText("That workspace is out of reach: not sent.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(posts).toEqual([]);
    expect(await keptOps(1)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect(await keptOps(1)).toEqual([]));
  });

  it("read-only after the reload: the Retry finds it so and keeps it", async () => {
    await putKeptOp(kept());
    show();
    await waitFor(() => expect(notice()).toBeTruthy());
    denied = 423;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByText(/read-only now, so nothing is sent/).length).toBeGreaterThan(0));
    expect(posts).toEqual([]);
    expect(await keptOps(1)).toHaveLength(1);
  });
});

describe("kept pick list changes and accounts", () => {
  it("another account's kept changes are never read or shown, and stay theirs", async () => {
    await putKeptOp(kept({ account: 2, opId: "marcus-op-0001" }));
    show({ accountId: 1, name: "Priya" });
    await waitFor(() => expect(rows()).toEqual([101, 102, 103]));
    await new Promise((r) => setTimeout(r, 50));
    expect(notice()).toBeNull();
    expect(posts).toEqual([]);
    expect((await keptOps(2)).map((r) => r.opId)).toEqual(["marcus-op-0001"]);
    // Marcus signs in on this device: his are back, for him.
    await reload({ accountId: 2, name: "Marcus" });
    await waitFor(() => expect(notice()).toBeTruthy());
  });

  it("a change kept for one account is never sent once another is signed in (and the server refuses one anyway)", async () => {
    await putKeptOp(kept());
    let failed: ReturnType<typeof useFailedChanges> = [];
    function Probe() { failed = useFailedChanges(); return null; }
    render(<Probe />);
    show();
    await waitFor(() => expect(failed).toHaveLength(1));
    // Priya signs out and Marcus signs in on the same page: a stale Retry of Priya's change sends nothing.
    act(() => setPicklistAccount(2));
    await act(() => retryFailedChange(failed[0].id));
    expect(posts).toEqual([]);
    expect(failed[0]).toMatchObject({ blocked: "account" });
    // Not known on the page, but the session is Marcus's: the server says no, and it stays Priya's, kept.
    act(() => setPicklistAccount(undefined));
    signedIn = 2;
    await act(() => retryFailedChange(failed[0].id));
    expect(posts).toHaveLength(1);
    expect(applied).toBe(0);
    expect(failed[0]).toMatchObject({ blocked: "account" });
    expect(await keptOps(1)).toHaveLength(1);
  });
});
