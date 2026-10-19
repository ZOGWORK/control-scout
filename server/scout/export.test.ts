// Task 18: a workspace's scout entries as CSV, against a stub Control Point. Headers follow the
// workspace's current template; older-version answers map by field id, leftovers go to "Other fields";
// the server applies the filters; deleted entries stay out; quoting, BOM and the formula guard hold up
// under a strict RFC 4180 parser; non-members get 403; the file name; and 5,000 rows stream in pieces.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, get, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { setFlag } from "../flags";
import { csvCell } from "../api/records";
import { builtinTemplate } from "../../src/shared/scoutDefaults";
import { exportFilename, workspaceExportUrl } from "../../src/shared/scoutExport";
import { entryMatches, filtersFromSearch, type FilterableEntry } from "../../src/shared/scoutFilter";
import { EXPORT_CHUNK, exportColumns, FIXED_HEADERS, OTHER_FIELDS_HEADER, parseExportFilters } from "./export";

const KEY = "k".repeat(40);
/** An entry as a member's device pulls it. */
type Pulled = FilterableEntry & { uuid: string; season: number };
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 8000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => { if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; } next(); });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: accountFor(String(req.body.email).toLowerCase()) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    const a = [...accounts.values()].find((x) => x.id === Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ account: a });
  });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
  cp = stub.listen(0);
  await new Promise((r) => cp.once("listening", r));
  cpBase = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"]) delete process.env[k];
});
beforeEach(async () => {
  // A fresh app per test: the export's per-IP rate limit (30 a minute) starts full. Sessions live in the database.
  scout.close();
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    // Decoded keeping a BOM (Response.text() would drop it).
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());
    let json2: any = null;
    try { json2 = text ? JSON.parse(text) : null; } catch { /* CSV */ }
    return { status: r.status, json: json2, text, headers: r.headers };
  };
  return Object.assign(call, { cookie: () => cookie });
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

let people: { member: Call; admin: Call; outsider: Call } | null = null;
/** Workspace `ws` ("Gear Heads #1"): Coach is its admin, Priya a member; Olly is in no workspace. */
async function team(ws: string) {
  const join = (email: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id: ws, name: "Gear Heads #1", role }]; };
  join("csv-coach@example.com", "admin"); join("csv-priya@example.com", "member");
  people ??= { admin: await signIn("csv-coach@example.com", "Coach"), member: await signIn("csv-priya@example.com", "Priya"), outsider: await signIn("csv-olly@example.com") };
  return people;
}

/**
 * A strict RFC 4180 parser: CRLF row ends, quoted fields with "" escapes, nothing after a closing
 * quote but a comma or a row end, no bare CR or LF outside quotes, and every row as wide as the header.
 * Throws on anything else (what Google Sheets would mis-split).
 */
function parseCsvStrict(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", i = 0, quoted = false, atStart = true;
  const endCell = () => { row.push(cell); cell = ""; atStart = true; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++;
        const next = text[i];
        if (next !== undefined && next !== "," && next !== "\r") throw new Error(`text after a closing quote at ${i}`);
        continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { if (!atStart) throw new Error(`stray quote at ${i}`); quoted = true; atStart = false; i++; continue; }
    if (ch === ",") { endCell(); i++; continue; }
    if (ch === "\r") {
      if (text[i + 1] !== "\n") throw new Error(`bare CR at ${i}`);
      endCell(); rows.push(row); row = []; i += 2; continue;
    }
    if (ch === "\n") throw new Error(`bare LF at ${i}`);
    cell += ch; atStart = false; i++;
  }
  if (quoted) throw new Error("unterminated quote");
  if (cell !== "" || row.length) throw new Error("last row has no CRLF");
  const width = rows[0]?.length;
  rows.forEach((r, n) => { if (r.length !== width) throw new Error(`row ${n} has ${r.length} cells, header ${width}`); });
  return rows;
}

/** Read an export: status, headers, and the parsed rows (BOM checked and removed) as objects by header. */
async function exportOf(call: Call, ws: string, q: string) {
  const r = await call("GET", `/api/scout/workspaces/${ws}/export.csv?${q}`);
  if (r.status !== 200) return { status: r.status, json: r.json, headers: r.headers, header: [] as string[], rows: [] as Record<string, string>[] };
  expect(r.text.startsWith("﻿")).toBe(true);
  const [header, ...body] = parseCsvStrict(r.text.slice(1));
  return { status: r.status, json: null, headers: r.headers, header, rows: body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]]))) };
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  uuid: `csventry${String(++n).padStart(6, "0")}`, season: 2025, team: 18360, eventCode: "USCAQ1", matchLabel: "Q1", kind: "match",
  data: {}, notes: "", updatedAt: 1_700_000_000_000 + n, ...over,
});
const push = async (call: Call, ws: string, entries: unknown[]) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
  expect(r.status).toBe(200);
  expect(r.json.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
};
const putTemplate = (call: Call, ws: string, body: unknown) => call("PUT", `/api/scout/workspaces/${ws}/template`, body);

describe("workspace CSV export", () => {
  it("headers are the fixed columns, then the workspace's current match and pit fields, then Other fields", async () => {
    const { admin, member } = await team("501");
    const match = [
      { id: "cones", label: "Cones stacked", type: "counter", phase: "teleop", max: 30 },
      { id: "parked", label: "Parked", type: "toggle", phase: "endgame" },
    ];
    expect((await putTemplate(admin, "501", { season: 2025, match })).status).toBe(200);
    await push(member, "501", [entry({ data: { cones: 3, parked: true } })]);
    const out = await exportOf(member, "501", "season=2025");
    expect(out.status).toBe(200);
    // Pit isn't customised: the built-in pit fields.
    expect(out.header).toEqual([...FIXED_HEADERS, "Cones stacked", "Parked", ...builtinTemplate(2025, "pit").fields.map((f) => f.label), OTHER_FIELDS_HEADER]);
    expect(out.rows[0]).toMatchObject({ Team: "18360", Event: "USCAQ1", Match: "Q1", Kind: "match", Author: "Priya", "Cones stacked": "3", Parked: "TRUE", [OTHER_FIELDS_HEADER]: "" });
    // kind=pit: only the pit fields.
    const pit = await exportOf(member, "501", "season=2025&kind=pit");
    expect(pit.header).toEqual([...FIXED_HEADERS, ...builtinTemplate(2025, "pit").fields.map((f) => f.label), OTHER_FIELDS_HEADER]);
    expect(pit.rows).toEqual([]);
  });

  it("a workspace with no template of its own exports under the built-in fields (and an untouched workspace is just the header)", async () => {
    const { member } = await team("502");
    const empty = await exportOf(member, "502", "season=2024");
    expect(empty.status).toBe(200);
    expect(empty.header).toEqual([...FIXED_HEADERS, ...builtinTemplate(2024, "match").fields.map((f) => f.label), ...builtinTemplate(2024, "pit").fields.map((f) => f.label), OTHER_FIELDS_HEADER]);
    expect(empty.rows).toEqual([]);
  });

  it("older template versions map by field id onto the current columns; fields that are gone land in Other fields", async () => {
    const { admin, member } = await team("503");
    // v1: cones + arm. v2: cones relabelled, arm removed, climb added.
    await putTemplate(admin, "503", { season: 2025, match: [
      { id: "cones", label: "Cones", type: "counter", phase: "teleop" },
      { id: "arm", label: "Used the arm", type: "toggle", phase: "teleop" },
    ] });
    await push(member, "503", [entry({ uuid: "oldversion01", data: { cones: 7, arm: false, typo: "x" }, templateId: "ws:503:2025:match", templateVersion: 1 })]);
    await putTemplate(admin, "503", { season: 2025, match: [
      { id: "cones", label: "Cones stacked (TeleOp)", type: "counter", phase: "teleop" },
      { id: "climb", label: "Climb", type: "choice", phase: "endgame", options: ["None", "Low", "High"] },
    ] });
    await push(member, "503", [entry({ uuid: "newversion01", data: { cones: 2, climb: "High" }, templateId: "ws:503:2025:match", templateVersion: 2 })]);
    const out = await exportOf(member, "503", "season=2025&kind=match");
    expect(out.header).toEqual([...FIXED_HEADERS, "Cones stacked (TeleOp)", "Climb", OTHER_FIELDS_HEADER]);
    const byId = Object.fromEntries(out.rows.map((r) => [r["Entry ID"], r]));
    expect(byId.oldversion01).toMatchObject({ "Cones stacked (TeleOp)": "7", Climb: "" });
    expect(JSON.parse(byId.oldversion01[OTHER_FIELDS_HEADER])).toEqual({ arm: false, typo: "x" });
    expect(byId.newversion01).toMatchObject({ "Cones stacked (TeleOp)": "2", Climb: "High", [OTHER_FIELDS_HEADER]: "" });
  });

  it("the server applies every filter; deleted entries are never exported", async () => {
    const { admin, member } = await team("504");
    await push(member, "504", [
      entry({ uuid: "filt00000001", team: 111, eventCode: "USCAQ1", matchLabel: "Q1", notes: "fast intake" }),
      entry({ uuid: "filt00000002", team: 222, eventCode: "uscaq1", matchLabel: "q2", notes: "slow" }),
      entry({ uuid: "filt00000003", team: 111, eventCode: "USTXCMP", kind: "pit", matchLabel: null, data: { drivetrain: "Swerve" } }),
      entry({ uuid: "filt00000004", team: 333, season: 2024 }),
      entry({ uuid: "filt00000005", team: 111, notes: "100% sure_thing" }),
      entry({ uuid: "filt00000008", team: 555, kind: "pit", matchLabel: null, data: { notes2: '6"wheel', canDefend: true, endgameCapable: false }, notes: "Équipe ÖSTERREICH" }),
    ]);
    await push(admin, "504", [entry({ uuid: "filt00000006", team: 444, notes: "coach note" })]);
    // A deleted entry: created, then deleted by its author.
    await push(member, "504", [entry({ uuid: "filt00000007", team: 111 })]);
    await push(member, "504", [entry({ uuid: "filt00000007", team: 111, deleted: true, updatedAt: Date.now() })]);
    const ids = async (q: string) => { const out = await exportOf(member, "504", q); expect(out.status).toBe(200); return out.rows.map((r) => r["Entry ID"]).sort(); };
    const all = ["filt00000001", "filt00000002", "filt00000003", "filt00000005", "filt00000006", "filt00000008"];
    expect(await ids("season=2025")).toEqual(all);
    expect(await ids("season=2024")).toEqual(["filt00000004"]);
    expect(await ids("season=2025&team=111")).toEqual(["filt00000001", "filt00000003", "filt00000005"]);
    expect(await ids("season=2025&team=111,222")).toEqual(["filt00000001", "filt00000002", "filt00000003", "filt00000005"]);
    expect(await ids("season=2025&team=111&team=444")).toEqual(["filt00000001", "filt00000003", "filt00000005", "filt00000006"]);
    expect(await ids("season=2025&event=USCAQ1")).toEqual(["filt00000001", "filt00000002", "filt00000005", "filt00000006", "filt00000008"]);
    expect(await ids("season=2025&kind=pit")).toEqual(["filt00000003", "filt00000008"]);
    expect(await ids("season=2025&match=Q2")).toEqual(["filt00000002"]);
    expect(await ids(`season=2025&author=${accountFor("csv-coach@example.com").id}`)).toEqual(["filt00000006"]);
    expect(await ids("season=2025&q=INTAKE")).toEqual(["filt00000001"]);
    expect(await ids("season=2025&q=swerve")).toEqual(["filt00000003"]); // a field's answer
    expect(await ids("season=2025&q=coach")).toEqual(["filt00000006"]); // the author's name
    expect(await ids("season=2025&q=100%25")).toEqual(["filt00000005"]); // % and _ are plain characters
    expect(await ids("season=2025&q=_")).toEqual(["filt00000005"]);
    expect(await ids(`season=2025&q=${encodeURIComponent('6"wheel')}`)).toEqual(["filt00000008"]); // answers as decoded values
    expect(await ids("season=2025&q=drivetrain")).toEqual([]); // a field id isn't an answer
    expect(await ids("season=2025&q=true")).toEqual(["filt00000008"]); // toggles read as true / false
    expect(await ids("season=2025&q=false")).toEqual(["filt00000008"]);
    expect(await ids(`season=2025&q=${encodeURIComponent("équipe österreich")}`)).toEqual(["filt00000008"]); // Unicode case
    expect(await ids(`season=2025&q=${encodeURIComponent("ÉQUIPE")}`)).toEqual(["filt00000008"]);
    expect(await ids("season=2025&q=a b c d e f g h i j fast")).toEqual([]); // every word applies, the 11th too
    expect(await ids("season=2025&team=111&q=fast intake")).toEqual(["filt00000001"]);
    expect(await ids("season=2025&team=999")).toEqual([]);
  });

  it("bad filters are a 400, never ignored (a fresh app: the rate limit starts full)", async () => {
    const { member } = await team("504");
    for (const q of ["", "season=abc", "season=2025&team=abc", "season=2025&kind=both", "season=2025&event=a%20b", "season=2025&author=-1", "season=2025&team[value]=111", "season=2025&event[a]=X"]) {
      expect((await member("GET", `/api/scout/workspaces/504/export.csv?${q}`)).status).toBe(400);
    }
  });

  it("quoting survives commas, quotes, newlines and unicode, and cells that could run as formulas are prefixed", async () => {
    const { admin, member } = await team("505");
    await putTemplate(admin, "505", { season: 2025, match: [{ id: "comment", label: "Comment, \"quoted\"", type: "text", phase: "overall" }] });
    const tricky = 'Line one, with "quotes"\nline two\r\nline three: ñ 日本 🤖';
    await push(member, "505", [
      entry({ uuid: "quote0000001", notes: tricky, data: { comment: "a,b" } }),
      entry({ uuid: "formula00001", notes: "=HYPERLINK(\"http://x\")", data: { comment: "+1" } }),
      entry({ uuid: "formula00002", notes: "@SUM(A1)", data: { comment: "-2" } }),
      entry({ uuid: "formula00003", notes: "\tTAB", data: { comment: "\rCR" } }),
      entry({ uuid: "formula00004", notes: "1+1=2 is fine", data: { comment: 5 } }),
    ]);
    const out = await exportOf(member, "505", "season=2025&kind=match");
    expect(out.header).toContain('Comment, "quoted"');
    const byId = Object.fromEntries(out.rows.map((r) => [r["Entry ID"], r]));
    expect(byId.quote0000001).toMatchObject({ Notes: tricky, 'Comment, "quoted"': "a,b" });
    expect(byId.formula00001).toMatchObject({ Notes: "'=HYPERLINK(\"http://x\")", 'Comment, "quoted"': "'+1" });
    expect(byId.formula00002).toMatchObject({ Notes: "'@SUM(A1)", 'Comment, "quoted"': "'-2" });
    expect(byId.formula00003).toMatchObject({ Notes: "'\tTAB", 'Comment, "quoted"': "'\rCR" });
    expect(byId.formula00004).toMatchObject({ Notes: "1+1=2 is fine", 'Comment, "quoted"': "5" });
    // The writer itself.
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
    expect(csvCell(-3)).toBe("-3"); // a number is a number, not a formula
  });

  it("members and admins export; someone outside the workspace gets 403, signed out 401; paused is 503", async () => {
    const { admin, member, outsider } = await team("506");
    await push(member, "506", [entry()]);
    expect((await exportOf(member, "506", "season=2025")).status).toBe(200);
    expect((await exportOf(admin, "506", "season=2025")).status).toBe(200);
    const no = await outsider("GET", "/api/scout/workspaces/506/export.csv?season=2025");
    expect(no.status).toBe(403);
    expect(no.headers.get("content-type")).toContain("application/json");
    expect((await client()("GET", "/api/scout/workspaces/506/export.csv?season=2025")).status).toBe(401);
    await setFlag("workspaceScouting", false, "owner@test");
    try {
      expect((await member("GET", "/api/scout/workspaces/506/export.csv?season=2025")).status).toBe(503);
    } finally { await setFlag("workspaceScouting", true, "owner@test"); }
  });

  it("the download is named scout-<workspace>-<season>.csv, UTF-8 text/csv, never cached", async () => {
    const { member } = await team("507");
    const out = await exportOf(member, "507", "season=2025");
    expect(out.headers.get("content-disposition")).toBe('attachment; filename="scout-gear-heads-1-2025.csv"');
    expect(out.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(exportFilename("Équipe Rôbots!", "x", 2026)).toBe("scout-equipe-robots-2026.csv");
    expect(exportFilename("日本", "ws_9", 2026)).toBe("scout-ws_9-2026.csv");
  });

  it("5,000 rows stream out in pieces (header first, then a piece per chunk read), all parse", async () => {
    const { member } = await team("508");
    await push(member, "508", [entry({ uuid: "bigset000000" })]);
    const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", ["508"]);
    await db().execute({
      sql: `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 4999)
            INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq)
            SELECT ?, printf('bigset%06d', i), 2025, 1000 + i, 'USCAQ1', 'Q' || i, 'match', '{"fouls":1}', 'note, "' || i || '"', 1000 + i, 0, 1, 'Priya', 1, 'Priya', 1 + i FROM k`,
      args: [ws!.id],
    });
    const pieces: string[] = [];
    await new Promise<void>((resolve, reject) => {
      httpGet(`${base}/api/scout/workspaces/508/export.csv?season=2025&kind=match`, { headers: { Cookie: member.cookie(), "Accept-Encoding": "identity" } }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["transfer-encoding"]).toBe("chunked"); // no Content-Length: never built whole first
        res.setEncoding("utf8");
        res.on("data", (d: string) => pieces.push(d));
        res.on("end", resolve);
      }).on("error", reject);
    });
    // The header row is written (and flushed) before any entry is read.
    expect(pieces[0].startsWith("﻿Entry ID,")).toBe(true);
    expect(pieces[0].split("\r\n").filter(Boolean)).toHaveLength(1);
    expect(pieces.length).toBeGreaterThanOrEqual(5000 / EXPORT_CHUNK);
    const rows = parseCsvStrict(pieces.join("").slice(1));
    expect(rows).toHaveLength(5001);
    expect(rows[1][0]).toBe("bigset000000"); // newest first
    const fouls = rows[0].indexOf("Fouls drawn");
    expect(rows.slice(1).filter((r) => r[fouls] === "1")).toHaveLength(4999);
  }, 30_000);

  it("parity: the export holds exactly the entries the Scout page's feed shows for the same filters (src/shared/scoutFilter.ts)", async () => {
    const { admin, member } = await team("509");
    await push(member, "509", [
      entry({ uuid: "parity000001", team: 111, eventCode: "USCAQ1", matchLabel: "Q2", notes: "Fast INTAKE" }),
      entry({ uuid: "parity000002", team: 222, eventCode: "uscaq1", matchLabel: "q10", notes: "slow, tips over" }),
      entry({ uuid: "parity000003", team: 111, eventCode: "USTXCMP", kind: "pit", matchLabel: null, data: { drivetrain: "Swerve", canDefend: true } }),
      entry({ uuid: "parity000004", team: 333, eventCode: null, matchLabel: "ß1", notes: "Équipe ÖSTERREICH" }),
      entry({ uuid: "parity000005", team: 444, season: 2024, notes: "fast" }),
      entry({ uuid: "parity000006", team: 111, matchLabel: "F1", notes: "deleted" }),
    ]);
    await push(member, "509", [entry({ uuid: "parity000006", team: 111, matchLabel: "F1", deleted: true, updatedAt: Date.now() })]);
    await push(admin, "509", [entry({ uuid: "parity000007", team: 222, matchLabel: "M3-2", notes: "coach says fast" })]);
    // What a member's device holds: the workspace pull (tombstones included).
    const pulled = (await member("GET", "/api/scout/sync?workspaceId=509&since=0")).json.entries as Pulled[];
    expect(pulled.map((x) => x.uuid).sort()).toEqual(["parity000001", "parity000002", "parity000003", "parity000004", "parity000005", "parity000006", "parity000007"]);
    const coach = accountFor("csv-coach@example.com").id, priya = accountFor("csv-priya@example.com").id;
    const queries = [
      "season=2025", "season=2024", "season=2025&team=111", "season=2025&team=111,222", "season=2025&event=USCAQ1", "season=2025&event=ustxcmp",
      `season=2025&author=${coach}`, `season=2025&author=${priya}&kind=match`, "season=2025&match=Q10", "season=2025&match=q2,F1",
      `season=2025&match=${encodeURIComponent("ß1")}`, "season=2025&match=SS1", "season=2025&kind=pit", "season=2025&q=fast", "season=2025&q=FAST+intake",
      "season=2025&q=swerve", "season=2025&q=true", "season=2025&q=coach", "season=2025&q=priya", `season=2025&q=${encodeURIComponent("équipe")}`,
      "season=2025&q=deleted", "season=2025&team=222&q=fast", "season=2025&team=999",
    ];
    for (const q of queries) {
      const sp = new URLSearchParams(q);
      const { filters, invalid } = filtersFromSearch(sp);
      expect(invalid, q).toEqual([]);
      const feed = pulled.filter((x) => x.season === Number(sp.get("season")) && entryMatches(x, filters)).map((x) => x.uuid).sort();
      const out = await exportOf(member, "509", q);
      expect(out.status, q).toBe(200);
      expect(out.rows.map((r) => r["Entry ID"]).sort(), q).toEqual(feed);
    }
  });

  it("the Scout page's export link carries only the filters the export knows", () => {
    expect(workspaceExportUrl("w1", new URLSearchParams("season=2025&team=18360&space=w1&view=template&entry=x"))).toBe("/api/scout/workspaces/w1/export.csv?season=2025&team=18360");
    expect(workspaceExportUrl("w1", { season: 2025, kind: "pit", q: "fast  ", author: null })).toBe("/api/scout/workspaces/w1/export.csv?season=2025&kind=pit&q=fast");
  });
});

// Audit PRIVATE-F01: an entry's fields are checked at the sync boundary (src/shared/scoutEntry.ts), and rows
// stored before that (a timestamp of 1e300, unreadable answers) never break the export, a pull, or later edits.
describe("entries with values out of bounds (PRIVATE-F01)", () => {
  const poison = async (ws: string, uuid: string, set: string) => {
    await db().execute({ sql: `UPDATE workspace_scout_entries SET ${set} WHERE uuid = ? AND workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?)`, args: [uuid, ws] });
  };

  it("the sync refuses a timestamp nothing could supersede, or one that isn't a whole number; ordinary edits keep working", async () => {
    const { member } = await team("511");
    for (const updatedAt of [1e300, Date.now() + 365 * 86_400_000, 1_700_000_000_000.5, -5]) {
      const r = await member("POST", "/api/me/scout/sync", { workspaceId: "511", entries: [entry({ uuid: "poisonsync01", updatedAt })] });
      expect(r.status).toBe(200);
      expect(r.json.results[0]).toMatchObject({ uuid: "poisonsync01", ok: false, error: "invalid entry", reason: "bad timestamp" });
    }
    // Nothing was stored: an ordinary edit is the first version.
    await push(member, "511", [entry({ uuid: "poisonsync01", notes: "fine", updatedAt: Date.now() })]);
    expect((await exportOf(member, "511", "season=2025")).rows.map((r) => r.Notes)).toEqual(["fine"]);
  });

  it("the sync refuses notes, answers, event or match of the wrong type, with the reason", async () => {
    const { member } = await team("512");
    const r = await member("POST", "/api/me/scout/sync", { workspaceId: "512", entries: [
      entry({ uuid: "badnotes0001", notes: { invalid: "object" } }),
      entry({ uuid: "baddata00001", data: { cones: { deep: 1 } } }),
      entry({ uuid: "baddata00002", data: [1, 2] }),
      entry({ uuid: "badevent0001", eventCode: 7 }),
      entry({ uuid: "goodentry001" }),
    ] });
    expect(r.json.results.map((x: { reason?: string; ok: boolean }) => x.ok || x.reason)).toEqual(["notes not text", "answers not values", "answers not values", "bad event or match", true]);
  });

  it("a stored row with a 1e300 timestamp and unreadable answers: the export streams, the pull reads it, and an ordinary edit supersedes it", async () => {
    const { member } = await team("513");
    await push(member, "513", [entry({ uuid: "poisoned0001", notes: "keep me", data: { auto: 3 } }), entry({ uuid: "healthy00001", notes: "healthy" })]);
    // As a build before the checks could have stored it.
    await poison("513", "poisoned0001", "updated_at = 1e300, data = 'not json'");
    const out = await exportOf(member, "513", "season=2025");
    expect(out.status).toBe(200);
    const byId = Object.fromEntries(out.rows.map((r) => [r["Entry ID"], r]));
    expect(Object.keys(byId).sort()).toEqual(["healthy00001", "poisoned0001"]);
    expect(byId.poisoned0001).toMatchObject({ Notes: "keep me", "Updated at": "" }); // the observation is kept; the date it can't show is blank
    const pulled = (await member("GET", "/api/scout/sync?workspaceId=513&since=0")).json.entries;
    expect(pulled.find((e: { uuid: string }) => e.uuid === "poisoned0001")).toMatchObject({ notes: "keep me", data: {}, updatedAt: 0 });
    // The device's next edit, stamped as devices do (after the copy it has: 0 + 1, or now): it wins.
    const edit = await member("POST", "/api/me/scout/sync", { workspaceId: "513", entries: [entry({ uuid: "poisoned0001", notes: "edited", updatedAt: Date.now() })] });
    expect(edit.json.results[0]).toMatchObject({ ok: true, entry: { notes: "edited" } });
    expect((await exportOf(member, "513", "season=2025")).rows.find((r) => r["Entry ID"] === "poisoned0001")).toMatchObject({ Notes: "edited" });
  });

  it("a history version with a damaged timestamp reads as 0, and restoring it still names its source version", async () => {
    const { member } = await team("515");
    await push(member, "515", [entry({ uuid: "restorepois1", notes: "first", updatedAt: Date.now() - 2000 })]);
    await push(member, "515", [entry({ uuid: "restorepois1", notes: "second", updatedAt: Date.now() - 1000 })]);
    await db().execute({ sql: "UPDATE workspace_entry_versions SET updated_at = 1e300 WHERE uuid = ? AND version_no = 1", args: ["restorepois1"] });
    const history = (await member("GET", "/api/scout/workspaces/515/entries/restorepois1/history")).json.versions;
    const v1 = history.find((v: { versionNo: number }) => v.versionNo === 1);
    expect(v1).toMatchObject({ updatedAt: 0, notes: "first" });
    await push(member, "515", [entry({ uuid: "restorepois1", notes: "first", updatedAt: Date.now(), restoredFrom: v1.updatedAt })]);
    const after = (await member("GET", "/api/scout/workspaces/515/entries/restorepois1/history")).json.versions;
    expect(after[0]).toMatchObject({ notes: "first", restored: true, restoredFromVersion: 1 });
  });

  it("personal entries: the sync refuses the same values, and a stored 1e300 row is read as 0 and superseded", async () => {
    const { member } = await team("514");
    const bad = await member("POST", "/api/me/scout/sync", { entries: [entry({ uuid: "personalbad1", updatedAt: 1e300 }), entry({ uuid: "personalbad2", notes: ["x"] })] });
    expect(bad.json.results.map((x: { reason?: string }) => x.reason)).toEqual(["bad timestamp", "notes not text"]);
    await member("POST", "/api/me/scout/sync", { entries: [entry({ uuid: "personalok01", notes: "mine" })] });
    await db().execute({ sql: "UPDATE scout_entries SET updated_at = 1e300, data = '{' WHERE uuid = ?", args: ["personalok01"] });
    const read = (await member("GET", "/api/me/scout")).json.entries.find((e: { uuid: string }) => e.uuid === "personalok01");
    expect(read).toMatchObject({ notes: "mine", data: {}, updatedAt: 0 });
    await member("POST", "/api/me/scout/sync", { entries: [entry({ uuid: "personalok01", notes: "mine, edited", updatedAt: Date.now() })] });
    expect((await member("GET", "/api/me/scout")).json.entries.find((e: { uuid: string }) => e.uuid === "personalok01")).toMatchObject({ notes: "mine, edited" });
  });
});

describe("export columns", () => {
  const f = (id: string, label: string, phase: "teleop" | "pit" = "teleop") => ({ id, label, type: "toggle" as const, phase });
  it("a label both kinds use is prefixed; one that still repeats gets its id", () => {
    const cols = exportColumns({ match: [f("a", "Arm"), f("b", "Speed"), f("c", "Speed"), f("d", "Notes")], pit: [f("e", "arm", "pit"), f("g", "Weight", "pit")] }, ["match", "pit"]);
    expect(cols.map((c) => c.header)).toEqual(["Match: Arm", "Speed [b]", "Speed [c]", "Notes [d]", "Pit: arm", "Weight"]);
    // A label that looks like another's suffixed name: still unique.
    const tricky = exportColumns({ match: [f("b", "Speed"), f("c", "Speed"), f("d", "Speed [c]")] }, ["match"]).map((c) => c.header);
    expect(tricky).toEqual(["Speed [b]", "Speed [c] (2)", "Speed [c]"]);
    expect(new Set(tricky).size).toBe(3);
    // One kind only: nothing to tell apart.
    expect(exportColumns({ match: [f("a", "Arm")], pit: [f("e", "Arm", "pit")] }, ["pit"]).map((c) => c.header)).toEqual(["Arm"]);
  });
  it("parses filters: lists, case, limits", () => {
    expect(parseExportFilters({ season: "2025", team: "1, 2", event: "usca", match: "q1", kind: "pit", author: ["5", "6"], q: " Fast  Intake " }))
      .toEqual({ ok: true, filters: { season: 2025, team: [1, 2], event: ["USCA"], match: ["Q1"], kind: "pit", author: [5, 6], q: ["fast", "intake"] } });
    expect(parseExportFilters({ season: "2025", team: Array.from({ length: 51 }, (_, i) => String(i + 1)).join(",") }).ok).toBe(false);
    expect(parseExportFilters({ season: "2025", q: "x".repeat(201) }).ok).toBe(false);
    expect(parseExportFilters({ season: "2025", team: { value: "111" } }).ok).toBe(false); // never a dropped filter
    expect(parseExportFilters({ season: "2025", match: ["Q1", { a: "Q2" }] }).ok).toBe(false);
  });
});
