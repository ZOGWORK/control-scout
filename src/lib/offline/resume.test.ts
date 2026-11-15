// @vitest-environment jsdom
// Picking up a download a dropped connection paused: only the ones the person started (marked), never one they
// deleted, only on a connection the network setting allows, and not over and over on a line that keeps dropping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackFile, PackManifest } from "../packs";

const noteRequestFailed = vi.hoisted(() => vi.fn());
vi.mock("../connection", () => ({ noteRequestFailed }));
const saveSeason = vi.hoisted(() => vi.fn());
vi.mock("./seasons", () => ({ saveSeason, SeasonGone: class SeasonGone extends Error {} }));

const { DownloadPaused, ChecksumError, NoConnection } = await import("./download");
const { runSeasonBatch, resetSeasonBatch } = await import("./seasonBatch");
const { MAX_STALLED, MIN_GAP_MS, resetResume, resumeAllowed, resumePaused } = await import("./resume");
const { RESUME_KEY, RESUME_MAX_AGE_MS, clearResume, resumeMarks, wantResume } = await import("./resumeMarks");
type Deps = Parameters<typeof resumePaused>[1] & object;

const file = (season: number, sha = `sha-${season}`): PackFile => ({ name: `${season}.db`, url: `/packs/${season}.db`, bytes: 100, sha256: sha, seasons: [season], kind: "full", contents: "" });
const manifest = (over: Partial<PackManifest> = {}): PackManifest => ({ format: 1, version: "2026-11-14.1", builtAt: "b", engineVersion: "e", dataAsOf: null, lite: null, full: [file(2026), file(2025)], ...over });
const partial = (season: number, have: number) => ({ sha256: `gz-${season}`, url: "", bytes: 200, have, pieces: 1, etag: null, owner: { kind: "season" as const, id: String(season), label: "" }, startedAt: 0, updatedAt: 0 });

function deps(over: Partial<Deps> = {}): Deps & { now: () => number } {
  let t = Date.now();
  return {
    fetchManifest: vi.fn(async () => manifest()),
    runSeasonBatch: vi.fn(async (files: PackFile[]) => ({ saved: files.map((f) => f.seasons[0]), failed: [], skipped: [], held: [] })),
    getLite: vi.fn(async () => {}),
    partialDownloads: vi.fn(async () => [partial(2026, 50)]),
    busy: () => false,
    now: () => (t += MIN_GAP_MS + 1),
    ...over,
  };
}

beforeEach(() => { localStorage.clear(); resetResume(); resetSeasonBatch(); saveSeason.mockReset(); noteRequestFailed.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("marks: set by the person's own download, kept only while the connection is to blame", () => {
  it("a season a dropped connection pauses stays marked, the connection is checked, and the seasons behind it wait", async () => {
    saveSeason.mockRejectedValueOnce(new DownloadPaused(50, 100));
    const r = await runSeasonBatch([file(2026), file(2025)], manifest(), { person: true });
    expect(r?.held).toEqual([2025]);
    expect(saveSeason).toHaveBeenCalledTimes(1);
    expect(resumeMarks().map((m) => m.key)).toEqual(["season:2026", "season:2025"]);
    expect(noteRequestFailed).toHaveBeenCalled();
  });

  it("no connection before a byte came counts as the connection too", async () => {
    saveSeason.mockRejectedValueOnce(new NoConnection("You're offline"));
    await runSeasonBatch([file(2026)], manifest(), { person: true });
    expect(resumeMarks().map((m) => m.key)).toEqual(["season:2026"]);
  });

  it("saved, or failed for another reason (a bad checksum): the mark goes", async () => {
    saveSeason.mockResolvedValueOnce({}).mockRejectedValueOnce(new ChecksumError());
    await runSeasonBatch([file(2026), file(2025)], manifest(), { person: true });
    expect(resumeMarks()).toEqual([]);
    expect(noteRequestFailed).not.toHaveBeenCalled();
  });

  it("an automatic update (not the person's) is never marked", async () => {
    saveSeason.mockRejectedValueOnce(new DownloadPaused(50, 100));
    await runSeasonBatch([file(2026)], manifest(), { replaceOnly: true });
    expect(resumeMarks()).toEqual([]);
  });

  it("a mark a day old is let go", () => {
    wantResume("season", "2026", {}, Date.now() - RESUME_MAX_AGE_MS - 1);
    expect(resumeMarks()).toEqual([]);
    expect(localStorage.getItem(RESUME_KEY)).toBeNull();
  });
});

describe("picking up", () => {
  it("resumes a marked season through the person's save run (only the missing bytes come: the downloader resumes)", async () => {
    wantResume("season", "2026");
    const d = deps();
    expect(await resumePaused(() => true, d)).toEqual([{ key: "season:2026", saved: true }]);
    expect(d.runSeasonBatch).toHaveBeenCalledWith([file(2026)], expect.anything(), { person: true, replaceOnly: undefined });
  });

  it("an update keeps its replaceOnly, so a season removed meanwhile isn't brought back", async () => {
    wantResume("season", "2026", { replaceOnly: true });
    const d = deps();
    await resumePaused(() => true, d);
    expect(d.runSeasonBatch).toHaveBeenCalledWith([file(2026)], expect.anything(), { person: true, replaceOnly: true });
  });

  it("nothing marked (never started, or deleted by the person): nothing downloads, not even the pack list", async () => {
    wantResume("season", "2026");
    clearResume("season:2026"); // Delete on the paused row
    const d = deps();
    expect(await resumePaused(() => true, d)).toEqual([]);
    expect(d.fetchManifest).not.toHaveBeenCalled();
  });

  it("waits while the connection isn't allowed (Wi-Fi only on mobile data) or another download runs", async () => {
    wantResume("season", "2026");
    const d = deps();
    expect(await resumePaused(() => false, d)).toEqual([]);
    expect(await resumePaused(() => true, { ...d, busy: () => true })).toEqual([]);
    expect(d.runSeasonBatch).not.toHaveBeenCalled();
    expect(resumeMarks()).toHaveLength(1);
  });

  it("the network setting: Wi-Fi only never on mobile data; Wi-Fi and mobile data on either; unknown counts as Wi-Fi", () => {
    expect(resumeAllowed("wifi", { type: "cellular" })).toBe(false);
    expect(resumeAllowed("wifi", { type: "wifi" })).toBe(true);
    expect(resumeAllowed("wifi", null)).toBe(true);
    expect(resumeAllowed("any", { type: "cellular" })).toBe(true);
  });

  it("already saved as this release (another tab finished it): the mark goes, nothing downloads", async () => {
    wantResume("season", "2026");
    localStorage.setItem("cs-offline-seasons", JSON.stringify([{ season: 2026, sha256: "sha-2026", version: "v", bytes: 1, savedAt: 1, dataAsOf: null, builtAt: "b" }]));
    const d = deps();
    expect(await resumePaused(() => true, d)).toEqual([]);
    expect(resumeMarks()).toEqual([]);
  });

  it("the predictions pack after the season, when it isn't current", async () => {
    wantResume("season", "2026");
    wantResume("lite", "lite");
    const lite = { ...file(2026), kind: "lite" as const };
    const d = deps({ fetchManifest: vi.fn(async () => manifest({ lite })) });
    expect(await resumePaused(() => true, d)).toEqual([{ key: "season:2026", saved: true }, { key: "lite:lite", saved: true }]);
    expect(d.getLite).toHaveBeenCalledWith("2026-11-14.1");
  });

  it("paused again: the rest wait for the next time; a line that keeps dropping with no progress stops being retried", async () => {
    wantResume("season", "2026");
    wantResume("lite", "lite");
    const paused = vi.fn(async () => ({ saved: [], failed: [{ season: 2026, error: new DownloadPaused(50, 100) }], skipped: [], held: [] }));
    const d = deps({ runSeasonBatch: paused, fetchManifest: vi.fn(async () => manifest({ lite: { ...file(2026), kind: "lite" } })) });
    for (let i = 0; i < MAX_STALLED + 3; i++) await resumePaused(() => true, d);
    expect(paused).toHaveBeenCalledTimes(MAX_STALLED);
    expect(d.getLite).not.toHaveBeenCalled();
  });

  it("never twice within the gap, however many checks find internet", async () => {
    wantResume("season", "2026");
    const paused = vi.fn(async () => ({ saved: [], failed: [{ season: 2026, error: new DownloadPaused(50, 100) }], skipped: [], held: [] }));
    const d = deps({ runSeasonBatch: paused, now: () => Date.now() });
    await resumePaused(() => true, d);
    await resumePaused(() => true, d);
    expect(paused).toHaveBeenCalledTimes(1);
  });
});
