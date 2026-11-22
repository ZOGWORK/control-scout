// The startup summary: one grep's worth of lines saying what the bot can do (chat and why not, report filing, follow
// posts, the site, the season), and never a secret's value — the journal is wider than the .env it describes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ flag: vi.fn(async () => true) }));
vi.mock("../server/flags", () => ({ isEnabled: state.flag }));

import { configLines } from "./config";
import { CHAT_OFF_SWITCH, CHAT_OFF_UNCONFIGURED, chatSetup } from "./chatState";

const KEYS = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_INTERNAL_KEY", "GITHUB_REPORT_TOKEN"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  state.flag.mockClear();
  state.flag.mockResolvedValue(true);
});
afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

describe("chat setup", () => {
  it("is off when Control Point isn't configured, and says which settings", async () => {
    expect(await chatSetup()).toEqual({ on: false, why: CHAT_OFF_UNCONFIGURED });
    expect(CHAT_OFF_UNCONFIGURED).toContain("CONTROL_POINT_INTERNAL_URL");
    expect(CHAT_OFF_UNCONFIGURED).toContain("CONTROL_POINT_INTERNAL_KEY");
    // The switch is never read when there's nothing to talk to.
    expect(state.flag).not.toHaveBeenCalled();
  });

  it("is off when the bot's own switch is off, even with Control Point configured", async () => {
    process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:3000";
    process.env.CONTROL_POINT_INTERNAL_KEY = "shared-secret";
    state.flag.mockResolvedValueOnce(false);
    expect(await chatSetup()).toEqual({ on: false, why: CHAT_OFF_SWITCH });
    expect(state.flag).toHaveBeenCalledWith("discordBruno");
  });

  it("is on only with both", async () => {
    process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:3000";
    process.env.CONTROL_POINT_INTERNAL_KEY = "shared-secret";
    expect(await chatSetup()).toEqual({ on: true });
  });

  it("reads a switch that can't be read (the database down) as off, as a chat does", async () => {
    process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:3000";
    process.env.CONTROL_POINT_INTERNAL_KEY = "shared-secret";
    state.flag.mockRejectedValueOnce(new Error("no such table: flags"));
    expect(await chatSetup()).toEqual({ on: false, why: CHAT_OFF_SWITCH });
  });
});

describe("the startup summary", () => {
  it("says the season, the site, the chat, report filing and the follow posts, one line each", () => {
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const lines = configLines({ season: 2025, sitePort: 3000, chat: { on: true }, follows: { follows: 3, servers: 2 } });
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.startsWith("config: "))).toBe(true);
    expect(lines[0]).toContain("season 2025");
    expect(lines[1]).toBe("config: site http://127.0.0.1:3000 (its own API, on loopback)");
    expect(lines[2]).toContain("chat on");
    expect(lines[3]).toBe("config: report filing on: GITHUB_REPORT_TOKEN is set");
    expect(lines[4]).toContain("3 follows in 2 servers");
  });

  it("says why the chat is off, and that report filing is off", () => {
    const lines = configLines({ season: 2025, sitePort: 3100, chat: { on: false, why: CHAT_OFF_SWITCH }, follows: { follows: 0, servers: 0 } });
    expect(lines[2]).toBe(`config: chat off — ${CHAT_OFF_SWITCH}`);
    expect(lines[3]).toContain("report filing off");
    expect(lines[3]).toContain("GITHUB_REPORT_TOKEN is not set");
  });

  it("counts one follow in one server, no follows, and follows it couldn't read, in words", () => {
    const one = configLines({ season: 2025, sitePort: 3000, chat: { on: true }, follows: { follows: 1, servers: 1 } });
    expect(one[4]).toContain("1 follow in 1 server (");
    const none = configLines({ season: 2025, sitePort: 3000, chat: { on: true }, follows: { follows: 0, servers: 0 } });
    expect(none[4]).toContain("nothing followed yet");
    const unread = configLines({ season: 2025, sitePort: 3000, chat: { on: true }, follows: null });
    expect(unread[4]).toContain("couldn't be read");
  });

  it("never prints a secret's value, only whether it is set", async () => {
    process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:3000";
    process.env.CONTROL_POINT_INTERNAL_KEY = "shared-secret-value";
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const all = [
      ...configLines({ season: 2025, sitePort: 3000, chat: await chatSetup(), follows: { follows: 1, servers: 1 } }),
      ...configLines({ season: 2025, sitePort: 3000, chat: { on: false, why: CHAT_OFF_UNCONFIGURED }, follows: { follows: 1, servers: 1 } }),
    ].join("\n");
    expect(all).not.toContain("shared-secret-value");
    expect(all).not.toContain("ghp-report-token");
  });
});
