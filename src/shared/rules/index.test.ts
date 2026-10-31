// The rules quick reference: its content is well formed (every entry in a real section, numbers unique,
// revision stamped, links to FIRST), the summaries stay short paraphrases, and the local search finds rules
// by number, word or phrase, exact number first.
import { describe, expect, it } from "vitest";
import { RULE_SEASONS, hasRuleReference, ruleReference, rulingsFor, searchRules } from "./index";
import { RULE_SEASON_IDS } from "./seasons";

const ref = ruleReference(2026);

describe("rules content", () => {
  it("the light season list matches the references", () => {
    expect([...RULE_SEASON_IDS]).toEqual(RULE_SEASONS.map((r) => r.season));
    expect(hasRuleReference(2026)).toBe(true);
    expect(hasRuleReference(2019)).toBe(false);
  });

  it.each(RULE_SEASONS.map((r) => [r.game, r] as const))("%s is stamped and well formed", (_game, r) => {
    expect(r.manual.revision).toMatch(/\S/);
    expect(r.manual.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.qa.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const u of [r.manual.url, r.manual.htmlUrl, r.qa.url]) expect(u).toMatch(/^https:\/\/[a-z-]+\.firstinspires\.org\//);
    const sections = new Set(r.sections.map((s) => s.id));
    expect(sections.size).toBe(r.sections.length);
    const ids = r.rules.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of r.rules) expect(sections.has(x.section), x.id).toBe(true);
    const ns = r.rulings.map((q) => q.n);
    expect(new Set(ns).size).toBe(ns.length);
    for (const q of r.rulings) { expect(q.answered).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(q.answered <= r.qa.readOn).toBe(true); expect(q.rules.length).toBeGreaterThan(0); }
  });

  it("summaries are short paraphrases, never pasted manual text", () => {
    for (const r of RULE_SEASONS) for (const x of [...r.rules, ...r.rulings]) {
      expect(x.summary.length, x.title).toBeLessThanOrEqual(320);
      // No quoted passages: quotation marks would mean copied wording.
      expect(x.summary, x.title).not.toMatch(/["“”]/);
    }
  });
});

describe("searchRules", () => {
  it("finds a rule by its number, however it's typed, exact number first", () => {
    for (const q of ["G421", "g421", "G-421", "g 421"]) expect(searchRules(ref, q).rules[0]?.id, q).toBe("G421");
    // A prefix lists the family in order.
    expect(searchRules(ref, "G42").rules.slice(0, 3).map((r) => r.id)).toEqual(["G420", "G421", "G422"]);
  });

  it("matches words in titles, summaries and keywords", () => {
    expect(searchRules(ref, "pin").rules.map((r) => r.id)).toContain("G421");
    expect(searchRules(ref, "question box").rules.map((r) => r.id)).toEqual(expect.arrayContaining(["T301", "T302"]));
    expect(searchRules(ref, "opponent nectar").rules.map((r) => r.id)).toContain("G408");
    expect(searchRules(ref, "5 balls").rules[0]?.id).toBe("G407");
  });

  it("finds Q&A rulings by number and by the rule they answer", () => {
    expect(searchRules(ref, "Q23").rulings.map((q) => q.n)).toEqual([23]);
    expect(searchRules(ref, "G408").rulings.map((q) => q.n)).toEqual(expect.arrayContaining([3, 4, 23]));
    expect(rulingsFor(ref, "G407").map((q) => q.n)).toEqual(expect.arrayContaining([2, 3, 23, 34]));
  });

  it("no query lists everything; nonsense lists nothing", () => {
    expect(searchRules(ref, "  ").rules.length).toBe(ref.rules.length);
    expect(searchRules(ref, "zzqx").rules).toEqual([]);
    expect(searchRules(ref, "zzqx").rulings).toEqual([]);
  });

  it("falls back to the newest season", () => {
    expect(ruleReference(1999).season).toBe(RULE_SEASONS[0].season);
    expect(ruleReference(null).season).toBe(RULE_SEASONS[0].season);
  });
});
