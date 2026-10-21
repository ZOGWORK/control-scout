// The bot's lookups against a small database: the same rows the site reads, the answers and the
// friendly errors (unknown team, no schedule, a match number past the end).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../server/db";
import { clearAllCaches } from "../server/caches";
import { CURRENT_SEASON as S } from "../server/data/seasons";
import { eventChoices, eventLookup, predictLookup, rankChoices, rankingsLookup, teamLookup } from "./lookups";
import { Friendly } from "./views";

const NOW = Date.parse("2026-10-20T15:00:00Z");

async function match(code: string, n: number, red: [number, number], blue: [number, number], score?: [number, number]) {
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source)
     VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, 'test')`,
    [S, code, n, `Qual ${n}`, `2026-10-18T09:${String(n).padStart(2, "0")}:00`, score ? 1 : 0, score?.[0] ?? null, score?.[0] ?? null, score?.[1] ?? null, score?.[1] ?? null]);
  for (const [i, t] of [...red, ...blue].entries()) {
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?)", [S, code, n, t, i < 2 ? "red" : "blue", (i % 2) + 1]);
  }
}

async function prediction(code: string, n: number, pRed: number, kind = "live") {
  await run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at)
     VALUES (?, ?, ?, 'qual', 0, ?, '[]', '[]', ?, 148.4, 121.2, 'moderate', 'test', '2026-10-18T08:00:00Z')`,
    [kind, S, code, n, pRed]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (18360, 'Gear Grinders', 'Austin', 'TX', 'USA'), (4215, 'Alpha', NULL, NULL, NULL), (16379, 'Beta', NULL, NULL, NULL), (21058, 'Gamma', NULL, NULL, NULL)");
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'USTXAUQ', 'Austin Qualifier', 'Qualifier', '2026-10-18', '2026-10-18', 0, 0, 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'USTXNEXT', 'Next Week Qualifier', 'Qualifier', '2026-10-25', '2026-10-25', 0, 0, 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'OLDONE', 'Long Ago Qualifier', 'Qualifier', '2026-09-01', '2026-09-01', 0, 0, 'test')", [S]);
  for (const t of [18360, 4215, 16379, 21058]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USTXAUQ', ?)", [S, t]);
  await match("USTXAUQ", 1, [18360, 4215], [16379, 21058], [148, 121]);
  await match("USTXAUQ", 2, [18360, 16379], [4215, 21058], [90, 130]);
  await match("USTXAUQ", 3, [18360, 21058], [4215, 16379]);
  await prediction("USTXAUQ", 1, 0.62);
  await prediction("USTXAUQ", 2, 0.71);
  await prediction("USTXAUQ", 3, 0.4);
  await kvSet("data:version", "v1");
});
beforeEach(() => clearAllCaches());

const friendly = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(Friendly);
  return e as Friendly;
};

describe("teamLookup", () => {
  it("answers with the team's page, name and place", async () => {
    const e = await teamLookup(18360);
    expect(e.title).toBe("#18360 — Gear Grinders");
    expect(e.url).toMatch(/\/teams\/18360$/);
    expect(e.fields?.find((f) => f.name === "Location")?.value).toBe("Austin, TX, USA");
  });

  it("an unknown number is a friendly error", async () => {
    expect((await friendly(teamLookup(99999))).title).toBe("Team not found");
  });
});

describe("predictLookup", () => {
  it("an unplayed match: both alliances, the bars, the predicted score and the tier", async () => {
    const e = await predictLookup("ustxauq", 3);
    expect(e.title).toBe("Austin Qualifier · Qual 3");
    expect(e.url).toMatch(/\/events\/\d+\/USTXAUQ\/match\/qual:0:3$/);
    const v = Object.fromEntries((e.fields ?? []).map((f) => [f.name, f.value]));
    expect(v["🔴 Red"]).toBe("18360 & 21058");
    expect(v["Red win"]).toBe("`████░░░░░░ 40%`");
    expect(v["Blue win"]).toBe("`██████░░░░ 60%`");
    expect(v["Predicted score"]).toBe("148 – 121");
    expect(v.Confidence).toBe("moderate confidence");
    expect(e.footer?.text).toMatch(/^Called before the match/);
  });

  it("a played match: the result, the call, and whether it was right", async () => {
    const hit = Object.fromEntries((await predictLookup("USTXAUQ", 1)).fields!.map((f) => [f.name, f.value]));
    expect(hit["Final score"]).toBe("Red **148** – 121 Blue");
    expect(hit.Predicted).toBe("Red 62% · 148 – 121 · moderate confidence");
    expect(hit.Verdict).toBe("✅ Called it");
    const miss = Object.fromEntries((await predictLookup("USTXAUQ", 2)).fields!.map((f) => [f.name, f.value]));
    expect(miss.Verdict).toBe("❌ Upset");
  });

  it("finds the event by its exact name too", async () => {
    expect((await predictLookup("austin qualifier", 1)).title).toBe("Austin Qualifier · Qual 1");
  });

  it("no schedule, a match past the end, and an unknown event are friendly errors", async () => {
    expect((await friendly(predictLookup("USTXNEXT", 1))).detail).toBe("Schedule isn't posted for Next Week Qualifier yet.");
    expect((await friendly(predictLookup("USTXAUQ", 9))).detail).toMatch(/^Austin Qualifier has 3 qualification matches\. Try a number from 1 to 3\.$/);
    expect((await friendly(predictLookup("NOPE", 1))).title).toBe("Event not found");
  });
});

describe("eventLookup", () => {
  it("the event's page, status and progress", async () => {
    const e = await eventLookup("USTXAUQ");
    expect(e.title).toBe("Austin Qualifier");
    expect(e.fields?.find((f) => f.name === "Matches played")?.value).toBe("2 of 3");
  });
});

describe("rankingsLookup", () => {
  it("before anyone is ranked, says when they start", async () => {
    const e = await friendly(rankingsLookup(NOW));
    expect(e.title).toBe("Rankings haven't started");
    expect(e.detail).toMatch(/start once teams have played 3 matches; the next events start Oct 25\.$/);
  });
});

describe("autocomplete", () => {
  it("events on now, coming up or just finished; never ones long over", async () => {
    const list = await eventChoices(NOW);
    expect(list.map((e) => e.code).sort()).toEqual(["USTXAUQ", "USTXNEXT"]);
  });

  it("a code match comes first, at most 25, and names stay within Discord's 100 characters", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ code: `EV${i}`, name: `${"Very long event name ".repeat(6)}${i}`, start: "2026-10-25", end: null }));
    const out = rankChoices([...many, { code: "ABC", name: "Alpha", start: "2026-10-26", end: null }], "abc", NOW);
    expect(out[0]).toEqual({ name: "Alpha (ABC)", value: "ABC" });
    expect(rankChoices(many, "", NOW)).toHaveLength(25);
    expect(rankChoices(many, "", NOW).every((c) => c.name.length <= 100)).toBe(true);
  });

  it("marks events on today as live", () => {
    expect(rankChoices([{ code: "X", name: "Today", start: "2026-10-20", end: "2026-10-20" }], "", NOW)[0].name).toBe("Today (X, live)");
  });
});
