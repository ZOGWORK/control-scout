// The What's new parser on the real CHANGELOG.md (it must read every release, newest first, and match the
// app's own version), plus inline pieces and the seen rule.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentRelease, hasUnseenRelease, HIGHLIGHT_TAGS, inlines, parseChangelog } from "./changelog";

const md = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

describe("parseChangelog", () => {
  const all = parseChangelog(md);

  it("reads every release of CHANGELOG.md, newest first, the latest being the app's version", () => {
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0].version).toBe(pkg.version);
    const nums = all.map((e) => e.version.split(".").map(Number));
    for (let i = 1; i < nums.length; i++) expect(nums[i - 1][0] * 1e6 + nums[i - 1][1] * 1e3 + nums[i - 1][2]).toBeGreaterThan(nums[i][0] * 1e6 + nums[i][1] * 1e3 + nums[i][2]);
    for (const e of all) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.summary.length).toBeGreaterThan(10);
      expect(e.groups.length).toBeGreaterThan(0);
      for (const g of e.groups) expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("numbers releases in the order they shipped: no skipped version, no date going backwards", () => {
    // Parallel PRs each claim a number and renumber when they merge; a claim that never shipped left a hole
    // (1.9.0 then 1.11.0). Each release is the next patch, minor or major after the one below it.
    for (let i = 1; i < all.length; i++) {
      const [a, b, c] = all[i].version.split(".").map(Number);
      const next = [`${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`];
      expect(next, `${all[i - 1].version} follows ${all[i].version}`).toContain(all[i - 1].version);
      expect(all[i - 1].date >= all[i].date, `${all[i - 1].version} is dated before ${all[i].version}`).toBe(true);
    }
  });

  it("keeps groups and their items", () => {
    const e = parseChangelog("# Changelog\n\nintro\n\n## 2.0.0 — 2027-01-02\n\nBig one.\n\n### Home\n- **New.** It works. (#9)\n- Second\n\n### Fixes\n\n- A fix\n")[0];
    expect(e).toEqual({ version: "2.0.0", date: "2027-01-02", summary: "Big one.", highlights: [], groups: [{ heading: "Home", items: ["**New.** It works. (#9)", "Second"] }, { heading: "Fixes", items: ["A fix"] }] });
  });

  it("reads a release's Highlights block into its digest, apart from the full notes", () => {
    const [e, older] = parseChangelog("## 2.1.0 — 2027-02-01\n\nSmall one.\n\n### Highlights\n- [home] A new home\n- No tag here\n- [Odd tag] Kept as text\n\n### Home\n- The detail (#12)\n\n## 2.0.0 — 2027-01-02\n\nOlder.\n\n### Fixes\n- A fix\n");
    expect(e.summary).toBe("Small one.");
    expect(e.highlights).toEqual([{ tag: "home", text: "A new home" }, { tag: null, text: "No tag here" }, { tag: null, text: "[Odd tag] Kept as text" }]);
    expect(e.groups).toEqual([{ heading: "Home", items: ["The detail (#12)"] }]);
    // A release without a Highlights block: no digest, full notes intact.
    expect(older.highlights).toEqual([]);
    expect(older.groups).toEqual([{ heading: "Fixes", items: ["A fix"] }]);
  });

  it("gives every release in CHANGELOG.md 3 to 5 short, known-tagged highlights", () => {
    for (const e of all) {
      expect(e.highlights.length, `v${e.version}`).toBeGreaterThanOrEqual(3);
      expect(e.highlights.length, `v${e.version}`).toBeLessThanOrEqual(5);
      for (const h of e.highlights) {
        expect(HIGHLIGHT_TAGS as readonly (string | null)[], h.text).toContain(h.tag);
        expect(h.text.length, h.text).toBeLessThanOrEqual(72);
      }
      expect(e.groups.some((g) => /highlights/i.test(g.heading))).toBe(false);
    }
  });
});

describe("inlines", () => {
  it("splits bold, code and this repo's PR numbers; another repo's stay text", () => {
    expect(inlines("**Live.** Open `/scout` now (#128, Control Point #252)")).toEqual([
      { kind: "bold", text: "Live." }, { kind: "text", text: " Open " }, { kind: "code", text: "/scout" }, { kind: "text", text: " now (" },
      { kind: "pr", text: "#128", number: 128 }, { kind: "text", text: ", " }, { kind: "text", text: "Control Point #252" }, { kind: "text", text: ")" },
    ]);
  });
});

describe("seen rule", () => {
  it("knows the release from the build's version, and when it's unseen", () => {
    expect(currentRelease("1.7.0+abc1234")).toBe("1.7.0");
    expect(currentRelease("dev")).toBeNull();
    expect(hasUnseenRelease("1.7.0", "1.6.0")).toBe(true);
    expect(hasUnseenRelease("1.7.0", "1.7.0")).toBe(false);
    expect(hasUnseenRelease(null, null)).toBe(false);
  });
});
