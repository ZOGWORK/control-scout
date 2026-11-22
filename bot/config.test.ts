// The startup summary: one grep's worth of lines saying what the bot can do (chat and why not, report filing, follow
// posts, the site, where its commands are registered, the season), and never a secret's value — the journal is wider
// than the .env it describes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ flag: vi.fn(async () => true) }));
vi.mock("../server/flags", () => ({ isEnabled: state.flag }));

import { configEmbed, configLines } from "./config";
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

/** A summary with everything on, as the VM's would read (commands global unless a test says otherwise). */
const all = (over: Partial<Parameters<typeof configLines>[0]> = {}) =>
  configLines({
    season: 2025, sitePort: 3000, commands: { guild: null }, chat: { on: true }, follows: { follows: 3, servers: 2 },
    ...over,
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
  it("says the season, the site, where commands register, the chat, report filing and the follow posts", () => {
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const lines = all();
    expect(lines).toHaveLength(6);
    expect(lines.every((l) => l.startsWith("config: "))).toBe(true);
    expect(lines[0]).toContain("season 2025");
    expect(lines[1]).toBe("config: site http://127.0.0.1:3000 (its own API, on loopback)");
    expect(lines[2]).toBe("config: slash commands globally (no DISCORD_DEV_GUILD_ID)");
    expect(lines[3]).toContain("chat on");
    expect(lines[4]).toBe("config: report filing on: GITHUB_REPORT_TOKEN is set");
    expect(lines[5]).toContain("3 follows in 2 servers");
  });

  it("says when the commands are registered in the test server alone, and names it", () => {
    expect(all({ commands: { guild: "123456789012345678" } })[2]).toBe(
      "config: slash commands in server 123456789012345678 only (DISCORD_DEV_GUILD_ID)",
    );
  });

  it("says why the chat is off, and that report filing is off", () => {
    const lines = all({ season: 2025, sitePort: 3100, chat: { on: false, why: CHAT_OFF_SWITCH }, follows: { follows: 0, servers: 0 } });
    expect(lines[3]).toBe(`config: chat off — ${CHAT_OFF_SWITCH}`);
    expect(lines[4]).toContain("report filing off");
    expect(lines[4]).toContain("GITHUB_REPORT_TOKEN is not set");
  });

  it("counts one follow in one server, no follows, and follows it couldn't read, in words", () => {
    expect(all({ follows: { follows: 1, servers: 1 } })[5]).toContain("1 follow in 1 server (");
    expect(all({ follows: { follows: 0, servers: 0 } })[5]).toContain("nothing followed yet");
    expect(all({ follows: null })[5]).toContain("couldn't be read");
  });

  it("/config says the same six things, without the log's prefix, and no secret's value", () => {
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const c = { season: 2025, sitePort: 3000, commands: { guild: null }, chat: { on: true as const }, follows: { follows: 3, servers: 2 } };
    const embed = configEmbed(c);
    const lines = String(embed.description).split("\n");
    expect(lines).toHaveLength(configLines(c).length);
    expect(lines.every((l) => l.startsWith("• "))).toBe(true);
    expect(lines[0]).toContain("season 2025");
    expect(lines[2]).toContain("slash commands globally");
    expect(lines[5]).toContain("3 follows in 2 servers");
    expect(String(embed.description)).not.toContain("config:");
    expect(String(embed.description)).not.toContain("ghp-report-token");
  });

  it("never prints a secret's value, only whether it is set", async () => {
    process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:3000";
    process.env.CONTROL_POINT_INTERNAL_KEY = "shared-secret-value";
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const text = [
      ...all({ chat: await chatSetup() }),
      ...all({ chat: { on: false, why: CHAT_OFF_UNCONFIGURED }, commands: { guild: "123456789012345678" } }),
    ].join("\n");
    expect(text).not.toContain("shared-secret-value");
    expect(text).not.toContain("ghp-report-token");
  });
});
