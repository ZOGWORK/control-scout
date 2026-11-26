// The welcome a new server sees on install (bot/welcome.ts, posted by bot/index.ts on GuildCreate): one embed that names
// the three things that make the bot useful, says what it reads, and stays inside Discord's limits.
import { describe, expect, it } from "vitest";
import { ASK_CHANNEL } from "./ambient";
import { welcomeEmbed } from "./welcome";

describe("the welcome", () => {
  const e = welcomeEmbed();

  it("says what it is, and the three things to do next", () => {
    expect(e.title).toBe("Control Scout is here");
    expect(e.description).toContain("**1. Follow your team.** `/follow team:4215 channel:#scouting`");
    expect(e.description).toContain("**2. Ask anything.**");
    expect(e.description).toContain("**3. Check what I can do.** `/help`");
    // The opt-in ask channel is named by the same constant the reader uses (bot/ambient.ts), so the two can't drift.
    expect(e.description).toContain(`\`#${ASK_CHANNEL}\``);
  });

  it("says what it reads, so the install is not a surprise", () => {
    expect(e.description).toContain("I read only messages that mention me or reply to me");
    expect(e.description).toContain("that one ask channel");
  });

  it("fits one Discord message, with no links or secrets in it", () => {
    expect(e.title!.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(e.fields).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/https?:\/\/|token|secret/i);
  });
});
