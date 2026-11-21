// The clip autopilot's reads handed to the live server (server/videos/autoReads.ts): the database's live rows laid over
// the code's (overlay), the decision (clean: live at once; a broken rule: waits for the owner; a read of nothing:
// dropped), the inbox (claimed by one process only, applied, bad files set aside), and the owner's Approve / Reject.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { FRAME_TIMINGS, frameRow, frameStart, setAutoFrameRows, setFrameTimingsForTests, type FrameTiming } from "../data/frameTimings";
import { CLIP_CHECKS, clipCheck, setAutoClipChecks, setClipChecksForTests, type ClipCheck } from "../data/clipChecks";
import { applyDelivery, claimInbox, CLAIM_STALE_MS, judgeClips, judgeFrames, loadAutoReads, ownerAutoReads, processInbox } from "./autoReads";
import { clipCoverageOwnerRoutes } from "./officialOwnerRoutes";

const V1 = "aaaaaaaaaa1", V2 = "bbbbbbbbbb2", V3 = "ccccccccccc";
const frame = (o: Partial<FrameTiming> = {}): FrameTiming => ({ videoId: V1, code: "XXAUTO", checked: "2026-11-20", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 }, ...o });
const clips = (o: Partial<ClipCheck> = {}): ClipCheck => ({ videoId: V1, code: "XXAUTO", season: 2025, checked: "2026-11-20", ok: ["Q1"], ...o });
const NOTHING = "no frame of the video could be read", UNPLAYABLE = "the video couldn't be played: its player showed an error";

const savedFrames = [...FRAME_TIMINGS], savedClips = [...CLIP_CHECKS];
beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
});
beforeEach(async () => {
  await run("DELETE FROM auto_reads");
  setFrameTimingsForTests([]);
  setClipChecksForTests([]);
  await loadAutoReads();
});
afterAll(() => {
  setAutoFrameRows([]);
  setAutoClipChecks([]);
  setFrameTimingsForTests(savedFrames);
  setClipChecksForTests(savedClips);
});

describe("the overlay: database rows over the code's", () => {
  it("replaces the code row of the same video and event, adds new ones, and resets the lookups", () => {
    setFrameTimingsForTests([frame({ checked: "2026-11-10", starts: { Q1: 600 }, opens: { Q1: 588 } }), frame({ videoId: V2, starts: { Q1: 50 }, opens: { Q1: 38 } })]);
    // Read once, so the lookup caches are built on the code's rows.
    expect(frameStart(V1, "XXAUTO", "Q2")).toBeNull();
    setAutoFrameRows([frame(), frame({ videoId: V3, starts: { Q4: 4000 }, opens: { Q4: 3988 } })]);
    expect(FRAME_TIMINGS.map((f) => f.videoId)).toEqual([V1, V2, V3]);
    expect(frameStart(V1, "XXAUTO", "Q2")).toBe(1000);
    expect(frameStart(V2, "XXAUTO", "Q1")).toBe(50);
    expect(frameStart(V3, "XXAUTO", "Q4")).toBe(4000);
    expect(frameRow(V1, "XXAUTO")?.checked).toBe("2026-11-20");
    // Gone from the database: the code's row again.
    setAutoFrameRows([]);
    expect(frameStart(V1, "XXAUTO", "Q2")).toBeNull();
    expect(FRAME_TIMINGS).toHaveLength(2);
  });

  it("keeps a code row read later than the database's (a read merged by hand after it)", () => {
    setFrameTimingsForTests([frame({ checked: "2026-11-21", starts: { Q1: 601 }, opens: { Q1: 589 } })]);
    setAutoFrameRows([frame()]);
    expect(frameStart(V1, "XXAUTO", "Q1")).toBe(601);
  });

  it("lays clip checks the same way", () => {
    setClipChecksForTests([clips({ checked: "2026-11-10", ok: [], unconfirmed: { Q1: { t: 5, why: "its first frame names no match" } } })]);
    expect(clipCheck(V1, "XXAUTO", "Q1")?.state).toBe("unconfirmed");
    setAutoClipChecks([clips({ pulled: { Q2: { t: 900, showed: "Q3" } } })]);
    expect(clipCheck(V1, "XXAUTO", "Q1")?.state).toBe("ok");
    expect(clipCheck(V1, "XXAUTO", "Q2")?.state).toBe("pulled");
  });
});

describe("the decision", () => {
  it("puts a clean row live, already-live as it is", () => {
    expect(judgeFrames(frame(), null, ["Q1", "Q2"])).toEqual({ to: "live" });
    expect(judgeFrames(frame(), frame(), ["Q1", "Q2"])).toEqual({ to: "same" });
  });
  it("holds a row that drops a live clip for the owner, with that problem", () => {
    const next = frame({ checked: "2026-11-21", starts: { Q2: 1000 }, opens: { Q2: 995 }, missing: { Q1: "its frames didn't confirm a start" } });
    expect(judgeFrames(next, frame(), ["Q1", "Q2"])).toEqual({ to: "pending", problems: ["Q1: a live clip dropped without a frame naming another match"] });
  });
  it("drops a read of nothing: every match unread, or the video unplayable (closed #1962)", () => {
    for (const why of [NOTHING, UNPLAYABLE]) expect(judgeFrames(frame({ starts: {}, opens: undefined, missing: { Q1: why, Q2: why } }), frame(), ["Q1", "Q2"]).to).toBe("drop");
  });
  it("judges clip checks by their own rules", () => {
    expect(judgeClips(clips(), null)).toEqual({ to: "live" });
    expect(judgeClips(clips({ ok: [], checked: "2026-11-21" }), clips())).toEqual({ to: "pending", problems: ["Q1: an ok clip dropped without a frame naming another match"] });
  });
});

describe("a delivery", () => {
  it("puts clean rows live and serves them at once; a later read that breaks a rule waits, the live row stays", async () => {
    const r = await applyDelivery({ kind: "frames", season: 2025, rows: [frame(), { videoId: "short", code: "X" }], source: "amelia test" });
    expect(r.live).toEqual([`${V1}|XXAUTO`]);
    expect(r.dropped).toEqual([{ key: "short|X", why: "no YouTube video id" }]);
    expect(frameStart(V1, "XXAUTO", "Q2")).toBe(1000);
    const bad = frame({ checked: "2026-11-21", starts: { Q2: 1000 }, opens: { Q2: 995 } });
    expect((await applyDelivery({ kind: "frames", season: 2025, rows: [bad] })).pending).toEqual([`${V1}|XXAUTO`]);
    expect(frameStart(V1, "XXAUTO", "Q1")).toBe(600);
    const o = await ownerAutoReads();
    expect(o.total).toBe(1);
    expect(o.pending[0]).toMatchObject({ kind: "frames", videoId: V1, season: 2025, code: "XXAUTO", problems: ["Q1: a live clip dropped without a frame naming another match"], before: 2, after: 1, liveFrom: "auto" });
    expect(o.pending[0].changes).toEqual([{ label: "Q1", what: "pulled", from: 600, to: null }]);
    expect(o.lastDelivery).toMatchObject({ kind: "frames", pending: 1, live: 0 });
    // A later waiting read replaces the older one; a clean one clears it.
    await applyDelivery({ kind: "frames", season: 2025, rows: [{ ...bad, checked: "2026-11-22" }] });
    expect((await ownerAutoReads()).pending.map((p) => p.checked)).toEqual(["2026-11-22"]);
    await applyDelivery({ kind: "frames", season: 2025, rows: [frame({ checked: "2026-11-23", starts: { Q1: 600, Q2: 1000, Q3: 1400 }, opens: { Q1: 588, Q2: 995, Q3: 1395 } })] });
    expect((await ownerAutoReads()).total).toBe(0);
    expect(frameStart(V1, "XXAUTO", "Q3")).toBe(1400);
    const audits = await all<{ action: string }>("SELECT action FROM owner_audit WHERE action = 'autoReads.delivery'");
    expect(audits.length).toBe(4);
  });

  it("never puts a read of nothing live nor in front of the owner", async () => {
    const r = await applyDelivery({ kind: "frames", season: 2025, rows: [frame({ starts: {}, opens: undefined, missing: { Q1: UNPLAYABLE } })] });
    expect(r.live).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.dropped).toHaveLength(1);
    expect(await get("SELECT 1 FROM auto_reads")).toBeUndefined();
  });

  it("checks the order matches were played in, from the event's own matches", async () => {
    // Q2 was played first: a read placing Q1 before it is out of the order they were played.
    await run(`INSERT INTO matches (season, code, level, series, number, label, played, time, source) VALUES
      (2025, 'XXAUTO', 'qual', 0, 1, 'Q1', 1, '2025-01-01T10:00:00Z', 'test'), (2025, 'XXAUTO', 'qual', 0, 2, 'Q2', 1, '2025-01-01T09:00:00Z', 'test')`);
    const r = await applyDelivery({ kind: "frames", season: 2025, rows: [frame()] });
    expect(r.pending).toEqual([`${V1}|XXAUTO`]);
    expect((await ownerAutoReads()).pending[0].problems).toEqual(["Q1: starts before Q2, out of the order they were played"]);
    await run("DELETE FROM matches WHERE code = 'XXAUTO'");
  });
});

describe("the inbox", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cs-inbox-")); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("claims each file once: a second claim (another server process) finds nothing", () => {
    writeFileSync(join(dir, "a.json"), "{}");
    writeFileSync(join(dir, ".b.json.tmp"), "{}");
    const first = claimInbox(dir), second = claimInbox(dir);
    expect(first.map((c) => c.name)).toEqual(["a.json"]);
    expect(second).toEqual([]);
    // A claim a stopped server left goes back into the inbox once stale.
    const old = (Date.now() - CLAIM_STALE_MS - 60_000) / 1000;
    utimesSync(first[0].path, old, old);
    expect(claimInbox(dir).map((c) => c.name)).toEqual(["a.json"]);
  });

  it("applies each delivery and removes it; sets aside a file that isn't one, with why", async () => {
    writeFileSync(join(dir, "good.json"), JSON.stringify({ kind: "frames", season: 2025, rows: [frame()], source: "test" }));
    writeFileSync(join(dir, "clips.json"), JSON.stringify({ kind: "clips", season: 2025, rows: [clips()] }));
    writeFileSync(join(dir, "bad.json"), "{ not json");
    writeFileSync(join(dir, "odd.json"), JSON.stringify({ kind: "other", season: 2025, rows: [] }));
    const out = await processInbox({ dir });
    expect(out).toEqual({ files: 2, live: 2, pending: 0, dropped: 0, rejected: 2 });
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
    expect(readdirSync(join(dir, "claimed"))).toEqual([]);
    expect(readdirSync(join(dir, "rejected")).sort()).toEqual(["bad.json", "bad.json.error.txt", "odd.json", "odd.json.error.txt"]);
    expect(readFileSync(join(dir, "rejected", "odd.json.error.txt"), "utf8")).toContain("isn't frames or clips");
    expect(frameStart(V1, "XXAUTO", "Q2")).toBe(1000);
    expect(clipCheck(V1, "XXAUTO", "Q1")?.state).toBe("ok");
    // Nothing waiting: nothing done.
    expect(await processInbox({ dir })).toEqual({ files: 0, live: 0, pending: 0, dropped: 0, rejected: 0 });
    expect(existsSync(join(dir, "good.json"))).toBe(false);
  });
});

describe("the owner's Approve and Reject", () => {
  let base = "", server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  beforeAll(async () => {
    const app = express(), r = express.Router();
    app.use(express.json());
    const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next); };
    clipCoverageOwnerRoutes(r, h, () => "owner@example.test");
    app.use("/api/owner", r);
    server = app.listen(0);
    await new Promise((ok) => server!.once("listening", ok));
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/owner`;
  });
  afterAll(() => { server?.close(); });
  const post = async (path: string, json: unknown) => { const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) }); return { status: res.status, body: await res.json() }; };
  const waitingRead = async () => {
    await applyDelivery({ kind: "frames", season: 2025, rows: [frame()] });
    await applyDelivery({ kind: "frames", season: 2025, rows: [frame({ checked: "2026-11-21", starts: { Q2: 1010 }, opens: { Q2: 1005 } })] });
    const list = await (await fetch(`${base}/auto-reads`)).json();
    expect(list.pending).toHaveLength(1);
    return list.pending[0];
  };

  it("Approve puts the waiting read live as read, audited; a read that changed since is refused", async () => {
    const p = await waitingRead();
    expect((await fetch(`${base}/clip-coverage/counts`).then((x) => x.json())).approvals).toBe(1);
    expect((await post("/auto-reads/approve", { kind: p.kind, videoId: p.videoId, code: p.code, pendingAt: "2000-01-01T00:00:00.000Z" })).status).toBe(409);
    const ok = await post("/auto-reads/approve", { kind: p.kind, videoId: p.videoId, code: p.code, pendingAt: p.pendingAt });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(0);
    expect(frameStart(V1, "XXAUTO", "Q2")).toBe(1010);
    expect(frameStart(V1, "XXAUTO", "Q1")).toBeNull();
    expect(await get("SELECT actor FROM owner_audit WHERE action = 'autoReads.approve'")).toEqual({ actor: "owner@example.test" });
    expect((await post("/auto-reads/approve", { kind: p.kind, videoId: p.videoId, code: p.code, pendingAt: p.pendingAt })).status).toBe(409);
  });

  it("Reject drops the waiting read and keeps what's live", async () => {
    const p = await waitingRead();
    const out = await post("/auto-reads/reject", { kind: p.kind, videoId: p.videoId, code: p.code, pendingAt: p.pendingAt });
    expect(out.status).toBe(200);
    expect(out.body.total).toBe(0);
    expect(frameStart(V1, "XXAUTO", "Q1")).toBe(600);
    expect(await get("SELECT actor FROM owner_audit WHERE action = 'autoReads.reject'")).toEqual({ actor: "owner@example.test" });
    expect((await post("/auto-reads/reject", { kind: "nope" })).status).toBe(400);
  });
});
