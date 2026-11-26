// The welcome a new server sees on install (bot/welcome.ts, posted by bot/index.ts on GuildCreate): one embed that names
// the three things that make the bot useful, says what it reads, and stays inside Discord's limits.
import { describe, expect, it } from "vitest";
import { BOT_COMMANDS } from "../src/shared/discord";
import { welcomeEmbed } from "./welcome";

describe("the welcome", () => {
  const e = welcomeEmbed();

  it("says what it is, and the three things to do next", () => {
    expect(e.title).toBe("Control Scout is here");
    expect(e.description).toContain("**1. Follow your team.** `/follow team:4215 channel:#scouting`");
    expect(e.description).toContain("**2. Ask anything.**");
    expect(e.description).toContain("**3. Check what I can do.** `/help`");
    // The ask channel is opted into with the same /config the help list names, not a magic channel name.
    expect(e.description).toContain("`/config channel:#ask`");
    expect(BOT_COMMANDS.some((c) => c.usage === "/config" && c.what.includes("channel:"))).toBe(true);
  });

  it("says what it reads, so the install is not a surprise", () => {
    expect(e.description).toContain("I read only messages that mention me or reply to me");
    expect(e.description).toContain("that single ask channel");
  });

  it("fits one Discord message, with no links or secrets in it", () => {
    expect(e.title!.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    expect(e.fields).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/https?:\/\/|token|secret/i);
  });
});
