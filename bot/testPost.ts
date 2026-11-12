// Posts every message design to a TEST channel, from real event data, so each one can be checked (and
// screenshotted) in Discord itself. Never a live channel: it refuses unless DISCORD_TEST_CHANNEL_ID is set
// and that channel belongs to DISCORD_DEV_GUILD_ID (the test server).
//
//   npm run bot:test-post                 every journey from bot/fixtures/usnjnem3-2026-11-07.json
//   npm run bot:test-post -- tick         the real minute tick against the local database (dedup, flag off)
//
// .env: DISCORD_BOT_TOKEN (a test application's), DISCORD_DEV_GUILD_ID, DISCORD_TEST_CHANNEL_ID.
import "../server/env.js";
import { readFileSync } from "node:fs";
import { REST, Routes, type APIEmbed } from "discord.js";
import type { EventDetail, MatchView } from "../src/shared/api.js";
import { eveEmbed, recapEmbed, scheduleEmbed } from "./eventAlerts.js";
import { addFollow, notifyTick, postEmbed, reminderLead, type Due } from "./follows.js";
import { preMatchEmbed, predictEmbed } from "./views.js";

const token = process.env.DISCORD_BOT_TOKEN, guild = process.env.DISCORD_DEV_GUILD_ID, channel = process.env.DISCORD_TEST_CHANNEL_ID;
if (!token || !guild || !channel) {
  console.error("Set DISCORD_BOT_TOKEN, DISCORD_DEV_GUILD_ID and DISCORD_TEST_CHANNEL_ID (a test server's channel) in .env.");
  process.exit(2);
}
const rest = new REST().setToken(token);
const ch = (await rest.get(Routes.channel(channel))) as { guild_id?: string; name?: string };
if (ch.guild_id !== guild) {
  console.error(`Channel ${channel} is not in the test server ${guild}. Not posting.`);
  process.exit(2);
}
const SITE = "https://controlscout.org";
// `npm run bot:test-post -- 7 7b` posts only those journeys.
const only = process.argv.slice(2).filter((a) => a !== "tick");
const post = async (label: string, embed: APIEmbed) => {
  if (label !== "tick" && only.length && !only.some((o) => label.startsWith(`${o}.`))) return;
  await rest.post(Routes.channelMessages(channel), { body: { content: `**${label}**`, embeds: [embed] } });
  console.log(`posted: ${label} (${JSON.stringify(embed).length} chars)`);
};

if (process.argv[2] === "tick") {
  // The real tick, on the local database's copy of the event, at a moment just after Q16 was scored.
  const { run } = await import("../server/db.js");
  const { isEnabled, setFlag } = await import("../server/flags.js");
  const wasOn = await isEnabled("discordBot");
  const now = Date.parse("2026-11-07T21:00:00Z");
  await run("DELETE FROM discord_follows WHERE channel_id = ?", [channel]);
  await run("DELETE FROM discord_posts WHERE channel_id = ?", [channel]);
  const created = now - 3 * 3600_000;
  console.log("follow 4215:", await addFollow(guild, channel, 4215, "test", created), "· again:", await addFollow(guild, channel, 4215, "test", created));
  const send = async (_c: string, embed: APIEmbed) => { await post("tick", embed); return "ok" as const; };
  const log = (m: string) => console.log(m);
  console.log("tick 1 posted", await notifyTick(send, SITE, log, now));
  console.log("tick 2 posted", await notifyTick(send, SITE, log, now + 60_000), "(nothing twice)");
  await run("DELETE FROM discord_posts WHERE channel_id = ?", [channel]);
  await setFlag("discordBot", false, "bot:test-post");
  console.log("flag off: tick posted", await notifyTick(send, SITE, log, now));
  await setFlag("discordBot", wasOn, "bot:test-post");
  await run("DELETE FROM discord_follows WHERE channel_id = ?", [channel]);
  process.exit(0);
}

const d = JSON.parse(readFileSync(new URL("./fixtures/usnjnem3-2026-11-07.json", import.meta.url), "utf8")) as EventDetail;
const q = (n: number) => d.matches.find((x) => x.level === "qual" && x.number === n)!;
const result = (n: number, team: number): Due => ({ channel, follows: [], match: q(n), kind: "result", teams: [team] });
/** The event as it stood before any match: the same schedule, nothing scored (for the eve and schedule posts). */
const unplayed = (m: MatchView): MatchView => ({ ...m, played: false, red: { ...m.red, score: null }, blue: { ...m.blue, score: null } });
const before = { ...d, event: { ...d.event, status: "upcoming" as const }, matches: d.matches.map(unplayed) } as EventDetail;

await post("1. Result Q16 (4215 followed)", postEmbed(result(16, 4215), d, SITE));
await post("2. Result Q17 (6980 followed)", postEmbed(result(17, 6980), d, SITE));
await post("3. Called: Q7 (23545 followed; Blue 65%)", postEmbed(result(7, 23545), d, SITE));
await post("4. Upset: Q9 (4215 followed; Blue 65%)", postEmbed(result(9, 4215), d, SITE));
await post("5. Tie: Q12 (4215 followed)", postEmbed(result(12, 4215), d, SITE));
// The reminder, timed as if Q16 were 15 minutes from now (Discord shows the times relative to the reader).
const soon = { ...unplayed(q(16)), startsAt: new Date(Date.now() + 15 * 60_000).toISOString() };
await post("6. Reminder before Q16 (4215 followed)", preMatchEmbed(d.event.name, soon, SITE, reminderLead({ match: soon, teams: [4215] }, SITE)));
await post("7. Schedule (4215)", scheduleEmbed({ channel, teams: [4215], kind: "schedule", key: "schedule:4215" }, before, SITE));
await post("8. Eve (4215)", eveEmbed({ channel, teams: [4215], kind: "eve", key: "eve" }, before, [{ team: 4215, name: d.field.find((f) => f.team === 4215)?.name ?? null, opr: d.field.find((f) => f.team === 4215)?.seasonOpr ?? null, worldRank: null }], SITE));
await post("9. Day recap (4215)", recapEmbed({ channel, teams: [4215], kind: "recap", key: "recap:2026-11-07:4215" }, d, "2026-11-07", SITE));
await post("10. /predict on a played match (Q16)", predictEmbed(d, q(16), SITE));
await post("11. /predict before a match (Q16)", predictEmbed(d, unplayed(q(16)), SITE));
// A long event's schedule (more than 15 matches, so "…and N more" shows): a test copy of this event's 17 real quals
// and 3 more, in time order, with 4215 placed on alternating sides of each real lineup.
const t0 = Date.parse(q(1).startsAt!);
const long = { ...before, matches: Array.from({ length: 20 }, (_, i) => {
  const src = unplayed(q((i % 17) + 1)), side = i % 2 ? "blue" : "red";
  const put = (s: MatchView["red"]) => ({ ...s, teams: s.teams.some((x) => x.number === 4215) ? s.teams : [{ ...s.teams[0], number: 4215 }, ...s.teams.slice(1)] });
  return { ...src, key: `qual:0:${i + 1}`, number: i + 1, label: `Q${i + 1}`, startsAt: new Date(t0 + i * 8 * 60_000).toISOString(),
    red: side === "red" ? put(src.red) : src.red, blue: side === "blue" ? put(src.blue) : src.blue };
}) } as EventDetail;
await post("7b. Schedule, long event (test copy: 20 quals)", scheduleEmbed({ channel, teams: [4215], kind: "schedule", key: "schedule:4215" }, long, SITE));
process.exit(0);
