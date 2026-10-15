import { describe, expect, it } from "vitest";
import { parseFilter, serializeFilter, type FilterGroup } from "../../shared/filterDsl";
import { statFor, STAT_BY_KEY } from "../../shared/statCatalog";
import { FILTER_PRESETS } from "../../config/filterPresets";
import { addChild, emptyCond, emptyGroup, fromBuilder, removeNode, toBuilder, updateNode, type BCond, type BGroup } from "./builder";
import { describeFilter, formatStat } from "./describe";
import { clearFilters, hasFilters, parseTableState, recordsUrl, searchString, writeTableState } from "./urlState";
import { deleteSaved, loadSaved, renameSaved, saveFilter, SAVED_KEY } from "./savedFilters";
import { addPreset, conditionFor, hasPreset, presetGroup, presetsFor, removePreset } from "./presets";

const NESTED = "and-penaltyPointsCommittedTot.lt.2+or-totalPointsOpr.gte.55+autoPointsAvg.gte.30--";

describe("filter builder ⇄ URL filter", () => {
  it("round-trips the brief's nested example", () => {
    const g = parseFilter(NESTED, "teamEvent");
    const b = toBuilder(g);
    expect(b.children).toHaveLength(2);
    expect((b.children[1] as BGroup).type).toBe("or");
    const { filter, errors } = fromBuilder(b, "teamEvent");
    expect(errors.size).toBe(0);
    expect(serializeFilter(filter!)).toBe(NESTED);
  });

  it("builds the nested example step by step", () => {
    let root = emptyGroup("and");
    const pen = { ...emptyCond("penaltyPointsCommittedTot", "lt"), value: "2" };
    root = addChild(root, root.id, pen);
    const or = emptyGroup("or");
    root = addChild(root, root.id, or);
    root = addChild(root, or.id, { ...emptyCond("totalPointsOpr", "gte"), value: "55" });
    root = addChild(root, or.id, { ...emptyCond("autoPointsAvg", "gte"), value: "30" });
    expect(serializeFilter(fromBuilder(root, "teamEvent").filter!)).toBe(NESTED);
    // Edit and remove.
    root = updateNode(root, pen.id, (n) => ({ ...(n as BCond), value: "3" }));
    expect(serializeFilter(fromBuilder(root, "teamEvent").filter!)).toContain("penaltyPointsCommittedTot.lt.3");
    root = removeNode(root, or.id);
    expect(serializeFilter(fromBuilder(root, "teamEvent").filter!)).toBe("and-penaltyPointsCommittedTot.lt.3-");
  });

  it("keeps half-finished conditions out of the filter, with a message each", () => {
    let root = emptyGroup();
    const a = emptyCond();
    const b = { ...emptyCond("autoPointsAvg", "gte"), value: "abc" };
    const c = { ...emptyCond("teamName", "contains"), value: "robo" };
    root = addChild(addChild(addChild(root, root.id, a), root.id, b), root.id, c);
    const { filter, errors } = fromBuilder(root, "teamEvent");
    expect(errors.get(a.id)).toMatch(/statistic/);
    expect(errors.get(b.id)).toMatch(/number/);
    expect(serializeFilter(filter!)).toBe("and-teamName.contains.robo-");
  });

  it("rejects stats from another table and drops empty groups", () => {
    let root = emptyGroup();
    const m = { ...emptyCond("winningMargin", "gte"), value: "10" };
    root = addChild(addChild(root, root.id, m), root.id, emptyGroup("or"));
    const { filter, errors } = fromBuilder(root, "teamEvent");
    expect(errors.get(m.id)).toMatch(/Not available/);
    expect(filter).toBeNull();
  });
});

describe("plain-English preview", () => {
  it("reads the nested example as a sentence", () => {
    expect(describeFilter(parseFilter(NESTED), "teamEvent"))
      .toBe("Teams with penalty points TOT under 2 and (total points OPR at least 55 or auto points AVG at least 30)");
    expect(describeFilter(null, "match")).toBe("All matches");
  });
  it("formats percentages without a flat 0% or 100%", () => {
    expect(formatStat(STAT_BY_KEY.get("advancementOdds"), 100)).toBe(">99%");
    expect(formatStat(STAT_BY_KEY.get("predictedWinPctAvg"), 61.4)).toBe("61%");
    expect(formatStat(STAT_BY_KEY.get("autoPointsAvg"), null)).toBe("—");
  });
});

describe("URL state", () => {
  it("parses and writes back the same URL", () => {
    const sp = new URLSearchParams(`tab=rankings&filter=${encodeURIComponent(NESTED)}&sort=autoPointsAvg&dir=asc&cols=rank,rp,autoPointsAvg&page=3&region=ustx,USCANO&type=Qualifier&from=2025-11-01&to=2025-12-31`);
    const s = parseTableState(sp, "teamEvent");
    expect(serializeFilter(s.filter!)).toBe(NESTED);
    expect(s).toMatchObject({ sort: "autoPointsAvg", dir: "asc", cols: ["rank", "rp", "autoPointsAvg"], page: 3, regions: ["USTX", "USCANO"], eventType: "Qualifier", from: "2025-11-01", to: "2025-12-31" });
    const out = writeTableState(new URLSearchParams("tab=rankings"), s, "teamEvent");
    expect(parseTableState(out, "teamEvent")).toEqual(s);
    expect(out.get("tab")).toBe("rankings");
  });

  it("accepts FTC Scout's raw '+' (decoded as spaces) and keeps the address readable", () => {
    const s = parseTableState(new URLSearchParams(`filter=${NESTED}`), "teamEvent");
    expect(serializeFilter(s.filter!)).toBe(NESTED);
    const qs = searchString(writeTableState(new URLSearchParams(), s, "teamEvent"));
    expect(qs).toBe(`?filter=${NESTED}`);
    expect(serializeFilter(parseTableState(new URLSearchParams(qs), "teamEvent").filter!)).toBe(NESTED);
  });

  it("leaves defaults out and drops what doesn't fit the table", () => {
    const s = parseTableState(new URLSearchParams("sort=winningMargin&type=Bogus&from=2025-1-1&cols=rank,nope"), "teamEvent");
    expect(s.sort).toBe("totalPointsOpr");
    expect(s.dir).toBe("desc");
    expect(s.eventType).toBeNull();
    expect(s.from).toBeNull();
    expect(s.cols).toEqual(["rank"]);
    expect(writeTableState(new URLSearchParams(), { ...s, cols: null }, "teamEvent").toString()).toBe("");
  });

  it("keeps a filter that doesn't parse as an error", () => {
    const s = parseTableState(new URLSearchParams("filter=and-foo.gt.1-"), "teamEvent");
    expect(s.filter).toBeNull();
    expect(s.filterError).toMatch(/unknown stat "foo"/);
  });

  it("clears filters but keeps sort and columns", () => {
    const s = parseTableState(new URLSearchParams(`filter=${NESTED}&region=USTX&sort=rp&cols=rp`), "teamEvent");
    expect(hasFilters(s)).toBe(true);
    const c = clearFilters(s);
    expect(hasFilters(c)).toBe(false);
    expect(c.sort).toBe("rp");
    expect(c.cols).toEqual(["rp"]);
  });
});

describe("API and CSV links", () => {
  const state = parseTableState(new URLSearchParams(`filter=${encodeURIComponent(NESTED)}&sort=autoPointsAvg&region=USTX&page=2`), "teamEvent");
  it("asks for one page as JSON", () => {
    const u = new URL(recordsUrl({ season: 2025, scope: "teamEvent", state, fields: ["teamName", "autoPointsAvg"], code: "USNJQ1" }), "http://x");
    expect(u.pathname).toBe("/api/records/2025/teams");
    expect(Object.fromEntries(u.searchParams)).toEqual({ filter: NESTED, sort: "autoPointsAvg", dir: "desc", fields: "teamName,autoPointsAvg", region: "USTX", code: "USNJQ1", page: "2", pageSize: "50" });
  });
  it("exports every filtered, sorted row with the visible columns (no paging)", () => {
    const u = new URL(recordsUrl({ season: 2025, scope: "teamSeason", state: { ...state, eventType: null }, fields: ["teamName", "autoPointsAvg"] }, "csv"), "http://x");
    expect(u.searchParams.get("format")).toBe("csv");
    expect(u.searchParams.get("scope")).toBe("season");
    expect(u.searchParams.get("fields")).toBe("teamName,autoPointsAvg");
    expect(u.searchParams.has("page")).toBe(false);
    expect(u.searchParams.has("pageSize")).toBe(false);
  });
  it("uses the matches endpoint for match records", () => {
    expect(recordsUrl({ season: 2024, scope: "match", state: parseTableState(new URLSearchParams(), "match"), fields: [] })).toMatch(/^\/api\/records\/2024\/matches\?sort=highScore&dir=desc&page=1/);
  });
});

describe("saved filters", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it("saves, lists, renames and deletes, surviving a reload of storage", () => {
    const store = mem();
    const a = saveFilter("  Clean + strong ", "team", NESTED, store, 1);
    saveFilter("Close games", "match", "and-winningMargin.lte.5-", store, 2);
    const reloaded = { getItem: (k: string) => store.m.get(k) ?? null, setItem: store.setItem };
    expect(loadSaved(reloaded).map((s) => s.name)).toEqual(["Close games", "Clean + strong"]);
    renameSaved(a.id, "Alliance picks", store);
    expect(loadSaved(store).find((s) => s.id === a.id)?.name).toBe("Alliance picks");
    // Same name and kind overwrites instead of duplicating.
    saveFilter("alliance picks", "team", "and-rp.gte.2-", store, 3);
    expect(loadSaved(store).filter((s) => s.kind === "team")).toHaveLength(1);
    deleteSaved(a.id, store);
    expect(loadSaved(store).map((s) => s.name)).toEqual(["Close games"]);
  });
  it("refuses empty names and bad filters, and ignores corrupt storage", () => {
    const store = mem();
    expect(() => saveFilter(" ", "team", NESTED, store)).toThrow(/name/);
    expect(() => saveFilter("x", "team", "and-oops", store)).toThrow();
    store.setItem(SAVED_KEY, "{not json");
    expect(loadSaved(store)).toEqual([]);
    store.setItem(SAVED_KEY, JSON.stringify([{ id: 1 }, { id: "a", name: "ok", kind: "team", filter: "and--", savedAt: 1 }]));
    expect(loadSaved(store).map((s) => s.name)).toEqual(["ok"]);
  });
});

describe("preset chips", () => {
  it("every preset uses stats that exist for its tables, with sane values", () => {
    expect(new Set(FILTER_PRESETS.map((p) => p.id)).size).toBe(FILTER_PRESETS.length);
    for (const p of FILTER_PRESETS) {
      const scopes = p.kind === "match" ? (["match"] as const) : (["teamEvent", "teamSeason"] as const);
      expect(p.conditions.length, p.id).toBeGreaterThan(0);
      for (const c of p.conditions) {
        for (const s of scopes) expect(statFor(c.key, s), `${p.id}: ${c.key} in ${s}`).toBeTruthy();
        expect(STAT_BY_KEY.get(c.key)!.type, `${p.id}: ${c.key}`).toBe("number");
        if ("topPct" in c) expect(c.topPct > 0 && c.topPct < 100, p.id).toBe(true);
        if (STAT_BY_KEY.get(c.key)!.category === "Control Scout Exclusives") expect(p.predictableOnly, `${p.id} uses a prediction stat`).toBe(true);
      }
    }
  });

  it("uses the listed threshold, else looks the season's top % up", async () => {
    const elite = FILTER_PRESETS.find((p) => p.id === "elite-opr")!;
    const lookup = async (key: string, pct: number, dir: string) => (key === "totalPointsNpOpr" && pct === 10 && dir === "desc" ? 61.27 : null);
    expect(serializeFilter((await presetGroup(elite, 2025, lookup))!)).toBe("and-totalPointsNpOpr.gte.80-");
    expect(serializeFilter((await presetGroup(elite, 2021, lookup))!)).toBe("and-totalPointsNpOpr.gte.61.2-");
    expect(await conditionFor({ key: "x", op: "gte", thresholds: {}, topPct: 5 }, 2021, async () => null)).toBeNull();
  });

  it("toggles chips in and out of the filter, combining with AND", async () => {
    const lookup = async () => 1;
    const [pa, pb] = ["elite-opr", "clean-drivers"].map((id) => FILTER_PRESETS.find((p) => p.id === id)!);
    const [a, b] = await Promise.all([pa, pb].map((p) => presetGroup(p, 2025, lookup)));
    let f: FilterGroup | null = addPreset(null, a!);
    expect(hasPreset(f, pa)).toBe(true);
    expect(hasPreset(f, pb)).toBe(false);
    f = addPreset(f, b!);
    expect(hasPreset(f, pa) && hasPreset(f, pb)).toBe(true);
    f = removePreset(f, pa);
    expect(hasPreset(f, pa)).toBe(false);
    expect(hasPreset(f, pb)).toBe(true);
    expect(removePreset(f!, pb)).toBeNull();
    // A chip stays on for a link made with another threshold.
    expect(hasPreset(parseFilter("and-and-totalPointsNpOpr.gte.70--"), pa)).toBe(true);
    expect(hasPreset(parseFilter("and-totalPointsNpOpr.gte.70-"), pa)).toBe(true);
    // An OR filter is kept whole.
    const or = parseFilter("or-rp.gte.2+tb1.gte.100-");
    expect(serializeFilter(addPreset(or, a!))).toBe(`and-or-rp.gte.2+tb1.gte.100-+${serializeFilter(a!)}-`);
  });

  it("hides prediction chips in seasons without predictions", () => {
    expect(presetsFor("teamEvent", true).some((p) => p.id === "favourites")).toBe(true);
    expect(presetsFor("teamEvent", false).some((p) => p.id === "favourites")).toBe(false);
    expect(presetsFor("match", true).every((p) => p.kind === "match")).toBe(true);
  });
});
