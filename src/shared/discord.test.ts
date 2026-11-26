import { describe, expect, it } from "vitest";
import { DISCORD_PERMISSIONS, discordInviteUrl } from "./discord";
import { discordFaq } from "./faq";

describe("Discord invite", () => {
  it("scopes bot + applications.commands with only Send Messages, Embed Links, Add Reactions, Read Message History, Use Slash Commands and the two thread permissions", () => {
    expect(DISCORD_PERMISSIONS).toBe(311385212992);
    expect(discordInviteUrl("123456789012345678")).toBe("https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot+applications.commands&permissions=311385212992");
    // Create Public Threads is 2^35; 2^34 is Manage Threads, which the bot never needs and must not ask for (bitwise
    // operators are 32-bit here, so the bit is read by division).
    expect(DISCORD_PERMISSIONS).toBe(2048 + 16384 + 64 + 65536 + 2 ** 31 + 2 ** 35 + 2 ** 38);
    expect(Math.floor(DISCORD_PERMISSIONS / 2 ** 34) % 2).toBe(0);
    expect(Math.floor(DISCORD_PERMISSIONS / 2 ** 35) % 2).toBe(1);
  });

  it("no link (and no FAQ answer) without a real client ID", () => {
    expect(discordInviteUrl(null)).toBeNull();
    expect(discordInviteUrl("PASTE_ID_HERE")).toBeNull();
    expect(discordFaq(null)).toEqual([]);
    expect(discordFaq("https://discord.com/oauth2/authorize?client_id=1")[0].id).toBe("discord");
  });
});
