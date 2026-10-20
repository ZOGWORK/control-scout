// What a retained change's destination holds now: read with GET only, and each way it can be gone or out of
// reach said plainly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_ACCESS, readSharedNow, type ReviewTarget } from "./sharedNow";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const note: ReviewTarget = { kind: "note", workspaceId: "901", season: 2025, team: 102 };
const comment: ReviewTarget = { kind: "comment", workspaceId: "901", season: 2025, team: 102, entry: "aaaaaaaaaaaa", opId: "op-review-0001" };

afterEach(() => vi.unstubAllGlobals());
const answer = (status: number, body: unknown = { error: "x" }) => {
  const f = vi.fn(async () => json(status, body));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("readSharedNow", () => {
  it("reads the note with a GET, and nothing else", async () => {
    const f = answer(200, { list: { workspaceId: "901", season: 2025, version: 1, picks: [{ team: 102, rank: 1, note: "Fast", noteUpdatedAt: 5, addedBy: { accountId: 1, name: "P" }, addedAt: 1, noteBy: null }] } });
    expect(await readSharedNow({ ...note, base: 5 })).toEqual({ state: "ok", text: "Fast" });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown[])[1]).not.toHaveProperty("method", "POST");
  });

  it("finds a comment already in the thread by its operation id", async () => {
    answer(200, { comments: [{ id: 1, workspaceId: "901", entryUuid: "aaaaaaaaaaaa", authorAccountId: 1, authorName: "P", body: "Hi", opId: "op-review-0001", createdAt: 1, editedAt: null }], entryDeleted: false });
    expect(await readSharedNow(comment)).toMatchObject({ state: "ok", text: "Hi", posted: true });
  });

  it("says signed out, removed, gone and unreachable apart", async () => {
    answer(401);
    expect(await readSharedNow(note)).toMatchObject({ state: "denied", message: expect.stringMatching(/^Sign in again/) });
    answer(403);
    expect(await readSharedNow(note)).toEqual({ state: "denied", message: NO_ACCESS });
    answer(404);
    expect(await readSharedNow(comment)).toMatchObject({ state: "gone", message: expect.stringContaining("isn't in the workspace") });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await readSharedNow(note)).toMatchObject({ state: "unavailable" });
  });
});
