// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { PackFile, PackManifest } from "../packs";
import { writeSaved, type SavedSeason } from "./saved";
import { askingAbout, markLater, setUpdate, updateSnapshot } from "./updateStore";

const file = (season: number, sha256: string): PackFile => ({ name: `s${season}`, url: `/packs/${season}.db`, bytes: 41.9e6, sha256, seasons: [season], kind: "full", contents: "" });
const manifest = (...full: PackFile[]): PackManifest => ({ format: 1, version: "v2", builtAt: "", engineVersion: "", dataAsOf: null, lite: null, full });
const saved = (season: number, sha256: string) => ({ season, sha256, version: "v1", bytes: 1, savedAt: 1, dataAsOf: null, builtAt: "" }) satisfies SavedSeason;

beforeEach(() => { localStorage.clear(); setUpdate(null, "none"); });

describe("updateStore", () => {
  it("finds the saved seasons with a newer release, and nothing for ones not saved", () => {
    writeSaved([saved(2025, "old"), saved(2024, "same")]);
    setUpdate(manifest(file(2025, "new"), file(2024, "same"), file(2023, "x")), "prompt");
    const s = updateSnapshot();
    expect(s.updates.map((u) => u.season)).toEqual([2025]);
    expect(s.key).toBe("2025:new");
    expect(askingAbout(s)).toBe(true);
  });

  it("Later hides the inbox item for this release; the next release brings it back", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    markLater("2025:new");
    expect(askingAbout(updateSnapshot())).toBe(false);
    setUpdate(manifest(file(2025, "newer")), "prompt");
    expect(askingAbout(updateSnapshot())).toBe(true);
  });

  it("the item goes once the season is updated (saved list matches)", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    writeSaved([saved(2025, "new")]);
    const s = updateSnapshot();
    expect(s.key).toBeNull();
    expect(askingAbout(s)).toBe(false);
  });

  it("asks only when the policy said prompt (not wait or download)", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "wait");
    expect(askingAbout(updateSnapshot())).toBe(false);
    setUpdate(manifest(file(2025, "new")), "download");
    expect(askingAbout(updateSnapshot())).toBe(false);
  });
});
