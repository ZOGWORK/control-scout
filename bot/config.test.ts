// The startup summary: one grep's worth of lines saying what the bot is and can do (the release it runs, the account it
// is and its servers, the season, the site, where its commands are registered, the chat and why not, report filing,
// follow posts, and when it last reached Discord), and never a secret's value — the journal is wider than the .env it
// describes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ flag: vi.fn(async () => true) }));
vi.mock("../server/flags", () => ({ isEnabled: state.flag }));

import { ago, configEmbed, configLines } from "./config";
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
  vi.useRealTimers();
});

const SHA = "8f6f706044289bd4fa632aaa84a9b1d15434c1c8";
/** A moment in the past, so a connected line can say how long ago. */
const CONNECTED_AT = Date.parse("2026-11-22T13:54:00Z");

/** A summary with everything on, as the VM's would read (commands global unless a test says otherwise). */
const all = (over: Partial<Parameters<typeof configLines>[0]> = {}) =>
  configLines({
    release: SHA, bot: { tag: "Control Scout#1234", servers: 2 }, season: 2025, sitePort: 3000,
    commands: { guild: null }, chat: { on: true },
    follows: { follows: 3, servers: 2 }, discord: { since: CONNECTED_AT, last: CONNECTED_AT },
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
  it("says the release, the account and its servers, the season, the site, where commands register, the chat, report filing, the follow posts and the connection", () => {
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const lines = all();
    expect(lines).toHaveLength(9);
    expect(lines.every((l) => l.startsWith("config: "))).toBe(true);
    expect(lines[0]).toBe(`config: release ${SHA}`);
    expect(lines[1]).toBe("config: bot Control Scout#1234 in 2 servers");
    expect(lines[2]).toContain("season 2025");
    expect(lines[3]).toBe("config: site http://127.0.0.1:3000 (its own API, on loopback)");
    expect(lines[4]).toBe("config: slash commands globally (no DISCORD_DEV_GUILD_ID)");
    expect(lines[5]).toContain("chat on");
    expect(lines[6]).toBe("config: report filing on: GITHUB_REPORT_TOKEN is set");
    expect(lines[7]).toContain("3 follows in 2 servers");
  });

  it("says the bot's tag and server count as the ready line does, and that it is not ready yet before the gateway says", () => {
    expect(all({ bot: { tag: "Control Scout#1234", servers: 1 } })[1]).toBe("config: bot Control Scout#1234 in 1 server");
    expect(all({ bot: null })[1]).toBe(
      "config: bot not ready yet (the gateway hasn't said which account this is; the ready line follows)",
    );
  });

  it("says it is a development build when there is no RELEASE file", () => {
    expect(all({ release: null })[0]).toBe("config: release development (no RELEASE file: the commit isn't known here)");
  });

  it("says when the commands are registered in the test server alone, and names it", () => {
    expect(all({ commands: { guild: "123456789012345678" } })[4]).toBe(
      "config: slash commands in server 123456789012345678 only (DISCORD_DEV_GUILD_ID)",
    );
  });

  it("says why the chat is off, and that report filing is off", () => {
    const lines = all({ season: 2025, sitePort: 3100, chat: { on: false, why: CHAT_OFF_SWITCH }, follows: { follows: 0, servers: 0 } });
    expect(lines[5]).toBe(`config: chat off — ${CHAT_OFF_SWITCH}`);
    expect(lines[6]).toContain("report filing off");
    expect(lines[6]).toContain("GITHUB_REPORT_TOKEN is not set");
  });

  it("counts one follow in one server, no follows, and follows it couldn't read, in words", () => {
    expect(all({ follows: { follows: 1, servers: 1 } })[7]).toContain("1 follow in 1 server (");
    expect(all({ follows: { follows: 0, servers: 0 } })[7]).toContain("nothing followed yet");
    expect(all({ follows: null })[7]).toContain("couldn't be read");
  });

  it("says when it connected to Discord, in UTC and how long ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T14:00:00Z"));
    expect(all()[8]).toBe("config: discord connected since 2026-11-22 13:54 UTC (6 minutes ago)");
  });

  it("says it is not connected now, with when it last was, or that it has never connected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T16:00:00Z"));
    expect(all({ discord: { since: null, last: CONNECTED_AT } })[8]).toBe(
      "config: discord not connected now (last connected 2 hours ago)",
    );
    expect(all({ discord: { since: null, last: null } })[8]).toBe(
      "config: discord not connected yet (the gateway is still connecting)",
    );
  });

  it("says just now for a connection a moment old, and handles each unit", () => {
    expect(ago(1_000_000, 1_000_000 + 5_000)).toBe("just now");
    expect(ago(0, 60_000)).toBe("1 minute ago");
    expect(ago(0, 3 * 3600_000)).toBe("3 hours ago");
    expect(ago(0, 4 * 86_400_000)).toBe("4 days ago");
    expect(ago(60_000, 0)).toBe("1 minute from now");
  });

  it("/config says the same nine things, without the log's prefix, and no secret's value", () => {
    process.env.GITHUB_REPORT_TOKEN = "ghp-report-token";
    const c = {
      release: SHA, bot: { tag: "Control Scout#1234", servers: 2 }, season: 2025, sitePort: 3000,
      commands: { guild: null }, chat: { on: true as const },
      follows: { follows: 3, servers: 2 }, discord: { since: CONNECTED_AT, last: CONNECTED_AT },
    };
    const embed = configEmbed(c);
    const lines = String(embed.description).split("\n");
    expect(lines).toHaveLength(configLines(c).length);
    expect(lines.every((l) => l.startsWith("• "))).toBe(true);
    expect(lines[0]).toContain(`release ${SHA}`);
    expect(lines[1]).toBe("• bot Control Scout#1234 in 2 servers");
    expect(lines[2]).toContain("season 2025");
    expect(lines[4]).toContain("slash commands globally");
    expect(lines[7]).toContain("3 follows in 2 servers");
    expect(String(embed.description)).not.toContain("config:");
    expect(String(embed.description)).not.toContain("ghp-report-token");
  });

  it("/config shows the times as Discord timestamps, so each reader sees their own clock", () => {
    const lines = configLines(
      {
        release: SHA, bot: { tag: "Control Scout#1234", servers: 2 }, season: 2025, sitePort: 3000,
        commands: { guild: null }, chat: { on: true },
        follows: { follows: 0, servers: 0 }, discord: { since: CONNECTED_AT, last: CONNECTED_AT },
      },
      { abs: (at) => `<t:${Math.floor(at / 1000)}:t>`, rel: (at) => `<t:${Math.floor(at / 1000)}:R>` },
    );
    expect(lines[8]).toBe(`config: discord connected since <t:${Math.floor(CONNECTED_AT / 1000)}:t> (<t:${Math.floor(CONNECTED_AT / 1000)}:R>)`);
    expect(String(configEmbed({
      release: SHA, bot: { tag: "Control Scout#1234", servers: 2 }, season: 2025, sitePort: 3000,
      commands: { guild: null }, chat: { on: true },
      follows: null, discord: { since: null, last: CONNECTED_AT },
    }).description)).toMatch(/not connected now \(last connected <t:\d+:R>\)/);
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
