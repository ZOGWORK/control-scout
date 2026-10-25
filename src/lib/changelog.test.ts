// The What's new parser on the real CHANGELOG.md (it must read every release, newest first, and match the
// app's own version), plus inline pieces and the seen rule.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { currentRelease, fromOldNumbering, hasUnseenRelease, HIGHLIGHT_TAGS, inlines, nextRelease, parseChangelog, seenRelease } from "./changelog";

const md = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

describe("parseChangelog", () => {
  const all = parseChangelog(md);

  it("reads every release of CHANGELOG.md, newest first, the latest being the app's version", () => {
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0].version).toBe(pkg.version);
    const key = (v: string) => v.split(".").map(Number).reduce((k, n, i) => k + n * 1000 ** (3 - i), 0);
    for (let i = 1; i < all.length; i++) expect(key(all[i - 1].version)).toBeGreaterThan(key(all[i].version));
    for (const e of all) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.summary.length).toBeGreaterThan(10);
      expect(e.groups.length).toBeGreaterThan(0);
      for (const g of e.groups) expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("numbers releases in the order they shipped, every number one digit: no skipped step, no date going backwards", () => {
    // Parallel PRs each claim a number and renumber when they merge; a claim that never shipped left a hole.
    // Each release is the next step after the one below it (1.3.7 → 1.3.8, 1.3.9 → 1.4.0); the old fix
    // releases (1.1.9.1, 1.1.9.2) sit between a step and the next.
    for (const e of all) for (const n of e.version.split(".")) expect(n, `v${e.version}`).toMatch(/^\d$/);
    for (let i = 1; i < all.length; i++) {
      const [a, b, c, fix = 0] = all[i].version.split(".").map(Number);
      const next = [nextRelease(`${a}.${b}.${c}`), `${a}.${b}.${c}.${fix + 1}`];
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

describe("release numbering", () => {
  it("steps the last number, carrying into the next at 9", () => {
    expect(nextRelease("1.3.7")).toBe("1.3.8");
    expect(nextRelease("1.3.8")).toBe("1.3.9");
    expect(nextRelease("1.3.9")).toBe("1.4.0");
    expect(nextRelease("1.9.9")).toBe("2.0.0");
  });

  it("maps the old two-digit numbering onto it", () => {
    expect(fromOldNumbering("1.37.0")).toBe("1.3.7");
    expect(fromOldNumbering("1.30.0")).toBe("1.3.0");
    expect(fromOldNumbering("1.21.0")).toBe("1.2.1");
    expect(fromOldNumbering("1.5.0")).toBe("1.0.5");
    expect(fromOldNumbering("1.19.2")).toBe("1.1.9.2");
    expect(fromOldNumbering("1.3.7")).toBe("1.3.7");
    expect(fromOldNumbering("dev")).toBe("dev");
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

  it("reads a release seen under the old numbering as its new number", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    store.set("cs-whats-new-seen", "1.37.0");
    expect(seenRelease()).toBe("1.3.7");
    expect(hasUnseenRelease("1.3.7")).toBe(false);
    store.set("cs-whats-new-seen", "1.3.7");
    expect(seenRelease()).toBe("1.3.7");
    vi.unstubAllGlobals();
  });
});
