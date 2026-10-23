import { describe, expect, it } from "vitest";
import { decideUpdate, liteAllowed, netKind, releaseKey, shouldPopUp, updateId, updatePrefs, updateQuestion, updateStatus, type UpdateInput, type UpdateMode, type UpdateNetwork } from "./updatePolicy";
import type { ConnectionInfo } from "../packPolicy";

const WIFI: ConnectionInfo = { type: "wifi" };
const CELL: ConnectionInfo = { type: "cellular", effectiveType: "4g" };
const NO_TYPE: ConnectionInfo = { effectiveType: "4g" }; // desktop Chrome
const SAFARI = undefined; // no navigator.connection at all
const ID = "2025:abc";

const at = (mode: UpdateMode, network: UpdateNetwork, connection: ConnectionInfo | undefined, extra: Partial<UpdateInput> = {}) =>
  decideUpdate({ mode, network, connection, online: true, pending: [ID], later: [], ...extra });

describe("netKind", () => {
  it("reads navigator.connection.type, and says unknown when the browser doesn't", () => {
    expect(netKind(WIFI)).toBe("wifi");
    expect(netKind({ type: "ethernet" })).toBe("wifi");
    expect(netKind(CELL)).toBe("cellular");
    expect(netKind({ type: "bluetooth" })).toBe("cellular");
    expect(netKind({ type: "other" })).toBe("unknown");
    expect(netKind(NO_TYPE)).toBe("unknown");
    expect(netKind(SAFARI)).toBe("unknown");
  });
});

describe("decideUpdate: mode × network × connection", () => {
  // [mode, network, connection, expected]
  const table: [UpdateMode, UpdateNetwork, string, ConnectionInfo | undefined, string][] = [
    ["ask", "wifi", "wifi", WIFI, "prompt"],
    ["ask", "wifi", "cellular", CELL, "wait"],
    ["ask", "wifi", "unknown", SAFARI, "prompt"],
    ["ask", "any", "wifi", WIFI, "prompt"],
    ["ask", "any", "cellular", CELL, "prompt"],
    ["ask", "any", "unknown", NO_TYPE, "prompt"],
    ["auto", "wifi", "wifi", WIFI, "download"],
    ["auto", "wifi", "cellular", CELL, "wait"],
    ["auto", "wifi", "unknown (Safari)", SAFARI, "prompt"], // can't tell: ask first, never guess
    ["auto", "wifi", "unknown (no type)", NO_TYPE, "prompt"],
    ["auto", "any", "wifi", WIFI, "download"],
    ["auto", "any", "cellular", CELL, "download"],
    ["auto", "any", "unknown", SAFARI, "download"],
  ];
  it.each(table)("%s, %s, on %s → %s", (mode, network, _name, conn, want) => {
    expect(at(mode, network, conn)).toBe(want);
  });

  it("does nothing with no new release, or offline", () => {
    expect(at("auto", "any", WIFI, { pending: [] })).toBe("none");
    expect(at("ask", "any", WIFI, { pending: [] })).toBe("none");
    expect(at("auto", "any", WIFI, { online: false })).toBe("none");
  });

  it("Later silences this release only; the next release asks again", () => {
    expect(at("ask", "wifi", WIFI, { later: [ID] })).toBe("none");
    expect(at("ask", "wifi", WIFI, { later: ["2025:older"] })).toBe("prompt");
    // Switching to automatic downloads it after all: Later was an answer to the question, not to auto mode.
    expect(at("auto", "wifi", WIFI, { later: [ID] })).toBe("download");
    // Auto mode that has to ask (browser can't tell) respects Later too.
    expect(at("auto", "wifi", SAFARI, { later: [ID] })).toBe("none");
  });

  it("Later is per season: another season's new release asks, and dropping one never revives the other", () => {
    // Later for 2025 and 2024; 2024 gets updated (or removed): 2025 alone is still answered.
    expect(at("ask", "wifi", WIFI, { pending: ["2025:abc"], later: ["2025:abc", "2024:def"] })).toBe("none");
    // A new 2024 release beside the answered 2025 one: ask.
    expect(at("ask", "wifi", WIFI, { pending: ["2025:abc", "2024:new"], later: ["2025:abc", "2024:def"] })).toBe("prompt");
  });

  it("Data Saver always asks first, even on Wi-Fi and mobile data", () => {
    expect(at("auto", "any", { ...CELL, saveData: true })).toBe("prompt");
    expect(at("auto", "wifi", { ...WIFI, saveData: true })).toBe("prompt");
  });
});

describe("releaseKey + updateId + shouldPopUp: one pop-up per release", () => {
  const a = { season: 2025, sha256: "abc", bytes: 1 };
  const b = { season: 2024, sha256: "def", bytes: 1 };
  it("is order-independent and changes with any season's checksum", () => {
    expect(releaseKey([])).toBeNull();
    expect(releaseKey([a, b])).toBe(releaseKey([b, a]));
    expect(releaseKey([a, b])).not.toBe(releaseKey([a, { ...b, sha256: "new" }]));
  });
  it("pops up once per release, never after it showed or after Later", () => {
    expect(updateId(a)).toBe("2025:abc");
    expect(shouldPopUp("prompt", [ID], [], [])).toBe(true);
    expect(shouldPopUp("prompt", [ID], [ID], [])).toBe(false);
    expect(shouldPopUp("prompt", [ID], [], [ID])).toBe(false);
    expect(shouldPopUp("prompt", [ID, "2024:next"], [ID], [ID])).toBe(true);
    expect(shouldPopUp("download", [ID], [], [])).toBe(false);
    expect(shouldPopUp("wait", [ID], [], [])).toBe(false);
  });
  it("updating one of two shown seasons doesn't pop up again for the other", () => {
    expect(shouldPopUp("prompt", ["2024:def"], ["2025:abc", "2024:def"], [])).toBe(false);
  });
});

describe("liteAllowed", () => {
  it("follows the network setting where the browser says, and stays automatic where it doesn't", () => {
    expect(liteAllowed("wifi", CELL)).toBe(false);
    expect(liteAllowed("any", CELL)).toBe(true);
    expect(liteAllowed("wifi", WIFI)).toBe(true);
    expect(liteAllowed("wifi", SAFARI)).toBe(true);
    expect(liteAllowed("any", { ...WIFI, saveData: true })).toBe(false); // Save-Data, as before
    expect(liteAllowed("any", { effectiveType: "3g" })).toBe(false);
  });
});

describe("settings and words", () => {
  it("defaults to ask first, Wi-Fi only", () => {
    expect(updatePrefs(undefined)).toEqual({ mode: "ask", network: "wifi" });
    expect(updatePrefs({ offlineUpdates: "auto", offlineNetwork: "any" })).toEqual({ mode: "auto", network: "any" });
  });
  it("asks the question with the season and size", () => {
    expect(updateQuestion([{ season: 2025, sha256: "x", bytes: 41.9e6 }])).toBe("Offline data for 2025–26 has an update (41.9 MB).");
    expect(updateQuestion([{ season: 2025, sha256: "x", bytes: 4e7 }, { season: 2024, sha256: "y", bytes: 2e7 }])).toBe("Offline data for 2025–26 and 2024–25 have updates (60.0 MB).");
  });
  it("says what the settings do on this connection, honestly", () => {
    expect(updateStatus("auto", "wifi", WIFI)).toBe("Updates download automatically on Wi-Fi.");
    expect(updateStatus("auto", "any", CELL)).toBe("Updates download automatically on Wi-Fi and mobile data.");
    expect(updateStatus("auto", "wifi", CELL)).toMatch(/mobile data now, so updates wait for Wi-Fi/);
    expect(updateStatus("auto", "wifi", SAFARI)).toMatch(/doesn't tell sites whether it's on Wi-Fi, so you'll be asked first/);
    expect(updateStatus("ask", "wifi", SAFARI)).toBe("You'll be asked when an update is out (downloads on Wi-Fi).");
  });
});
