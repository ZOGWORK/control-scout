import { describe, expect, it } from "vitest";
import { DISCORD_PERMISSIONS, discordInviteUrl } from "./discord";
import { discordFaq } from "./faq";

describe("Discord invite", () => {
  it("scopes bot + applications.commands with only Send Messages, Embed Links and Use Slash Commands", () => {
    expect(DISCORD_PERMISSIONS).toBe(2147502080);
    expect(discordInviteUrl("123456789012345678")).toBe("https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot+applications.commands&permissions=2147502080");
  });

  it("no link (and no FAQ answer) without a real client ID", () => {
    expect(discordInviteUrl(null)).toBeNull();
    expect(discordInviteUrl("PASTE_ID_HERE")).toBeNull();
    expect(discordFaq(null)).toEqual([]);
    expect(discordFaq("https://discord.com/oauth2/authorize?client_id=1")[0].id).toBe("discord");
  });
});
