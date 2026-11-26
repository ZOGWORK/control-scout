// The ask channel (bot/ambient.ts): one channel per server, picked with `/config channel:`, kept in its settings row and
// read at most once a minute — every message in every channel asks, and a read each would be a query a message. A
// thread under the picked channel counts as it.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { ASK_CHANNEL_TTL_MS, askChannel, forgetAskChannels, inAskChannel } from "./ambient";
import { setGuildSettings } from "./settings";

const client = openDb(":memory:");
beforeAll(async () => {
  setDb(client);
  await migrate(client);
});
beforeEach(async () => {
  await run("DELETE FROM discord_guild_settings");
  forgetAskChannels();
});

describe("the ask channel", () => {
  it("is the channel this server picked; no pick is the default, and another server's pick is its own", async () => {
    expect(await askChannel("g1")).toBeNull();
    await setGuildSettings("g1", { askChannel: "111111111111111111" });
    // /config forgets the cached pick when it writes (bot/handler.ts); a write from elsewhere waits out the minute.
    forgetAskChannels();
    expect(await askChannel("g1")).toBe("111111111111111111");
    expect(await askChannel("g2")).toBeNull();
  });

  it("keeps the pick for a minute, then reads it again, so a change through /config shows up", async () => {
    await setGuildSettings("g1", { askChannel: "111111111111111111" });
    const t0 = Date.parse("2026-11-26T12:00:00Z");
    expect(await askChannel("g1", t0)).toBe("111111111111111111");
    await setGuildSettings("g1", { askChannel: "222222222222222222" });
    expect(await askChannel("g1", t0 + 30_000)).toBe("111111111111111111");
    expect(await askChannel("g1", t0 + ASK_CHANNEL_TTL_MS)).toBe("222222222222222222");
  });

  it("forgets the channel when /config takes it away, and a read that fails keeps the last pick", async () => {
    await setGuildSettings("g1", { askChannel: "111111111111111111" });
    expect(await askChannel("g1")).toBe("111111111111111111");
    await setGuildSettings("g1", { askChannel: null });
    forgetAskChannels();
    expect(await askChannel("g1")).toBeNull();
    // A database blip must never start the bot answering in a channel nobody picked: the last good answer stands.
    await setGuildSettings("g1", { askChannel: "111111111111111111" });
    forgetAskChannels();
    expect(await askChannel("g1")).toBe("111111111111111111");
    setDb({ execute: async () => { throw new Error("database busy"); } } as never);
    expect(await askChannel("g1", Date.now() + ASK_CHANNEL_TTL_MS + 1_000)).toBe("111111111111111111");
    expect(await askChannel("g2", Date.now() + ASK_CHANNEL_TTL_MS + 1_000)).toBeNull();
    setDb(client);
  });

  it("matches the channel and a thread under it, and nothing else", () => {
    expect(inAskChannel({ id: "111" }, "111")).toBe(true);
    expect(inAskChannel({ id: "999", parentId: "111" }, "111")).toBe(true);
    expect(inAskChannel({ id: "999", parentId: "222" }, "111")).toBe(false);
    expect(inAskChannel({ id: "111" }, null)).toBe(false);
    expect(inAskChannel(null, "111")).toBe(false);
  });
});
