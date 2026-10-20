# Control Scout Discord bot

A public bot any FTC team can add to its own Discord server. Four slash commands, each answering with
an embed that links back to controlscout.org:

| Command | What it shows |
| --- | --- |
| `/team number:` | Location, season record, OPR (total and auto / TeleOp / endgame), world ranking, next event (or the last one) |
| `/predict event: match:` | Win odds as bars, predicted score and confidence for a qualification match. Once it's played: the final score, what was predicted, and ✅ / ❌ for whether the call was right |
| `/event code:` | Dates, place, status, matches played, top 5 by OPR, and the winning alliance once it's over |
| `/rankings` | The world top 10 by rating, with movement since last week |

`event` and `code` autocomplete over events on now, coming up, or finished in the last 3 days (name or
code; you can also type a code yourself).

## How it works

- **Its own process.** `bot/index.ts` runs under its own systemd unit, `control-scout-bot`. A bot crash,
  restart or deploy never touches the site, and the other way round.
- **Same data, no API.** It imports the site's own modules (`server/api/teams.ts`, `events.ts`,
  `rankings.ts`, the prediction engine) and reads the same database, so its numbers are the site's. It
  never calls the site over HTTP, never writes to the database and never runs migrations.
- **Load protection.** One answer per command and arguments for 60 seconds (`bot/guard.ts`): fifty people
  asking for the same match cost one lookup. One command per person every 3 seconds (a private "Slow
  down" reply). Autocomplete reads the event list once a minute and returns at most 25 choices.
- **Always answers.** Replies are deferred before any lookup, so nothing dies with "The application did
  not respond". Every failure is a short embed; unexpected ones (the database busy or down) say "Try
  again in a minute" and are logged with the command and arguments, never shown.
- **Commands register on boot**, and only when they changed (a restart is a no-op; registration is a
  bulk overwrite, so nothing is ever registered twice).

## Discord developer portal setup (once)

1. Go to <https://discord.com/developers/applications> → **New Application**, name it "Control Scout".
   Add the icon from `brand/`.
2. **General Information:** copy the **Application ID**. This is the client ID: put it in
   `DISCORD_CLIENT_ID` in `src/shared/discord.ts` (it's public) and the FAQ answer and footer link appear.
3. **Bot:** **Reset Token** and copy it into the server's env file as `DISCORD_BOT_TOKEN` (never commit it,
   never paste it anywhere else). Leave **Public Bot** on so any team can add it. No privileged intents
   are needed (the bot only uses the `Guilds` intent).
4. **Installation:** set the install link to "None" (the site's invite link is used instead), or to the
   same scopes and permissions as below.

## Invite link

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=2147502080
```

- Scopes: `bot` and `applications.commands`.
- Permissions `2147502080` = Send Messages (2048) + Embed Links (16384) + Use Application Commands
  (2147483648). Nothing else: the bot never reads messages, manages anything or joins voice.

`discordInviteUrl()` in `src/shared/discord.ts` builds exactly this link.

## Environment

| Variable | |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Required. Missing or wrong: the bot logs one line and exits with code 78, which systemd doesn't restart. |
| `DISCORD_DEV_GUILD_ID` | Optional. A test server's ID (Discord: Developer Mode → right-click the server → Copy Server ID). Commands register there instantly instead of globally (global registration can take up to an hour to appear). |
| `DATABASE_URL`, `DATA_DIR`, `CANONICAL_URL` … | The site's own settings, read from the same `.env` (links use `CANONICAL_URL`, controlscout.org in production). |

## Run it locally

```bash
npm install
# .env: DISCORD_BOT_TOKEN=… and DISCORD_DEV_GUILD_ID=<your test server>
npm run bot
```

It reads the local database (`.data/scout.db`, the same one `npm run dev` uses); run the site once first
so the shipped snapshot is restored. On ready it logs `ready as Control Scout#1234 in N servers` and
whether the commands were registered or unchanged.

Tests: `npx vitest run bot`.

## On the VM

`deploy/oracle-vm-setup.sh` (run by every deploy) writes `/etc/systemd/system/control-scout-bot.service`:
the same user, release directory and `.env` as the site, `Restart=always` except on exit 78, a 768 MB
memory cap and a lower CPU priority than the site. When `DISCORD_BOT_TOKEN` is set in
`/opt/control-scout/shared/.env` the deploy enables and restarts it after the site; without one the unit is
disabled. A bot that fails to start never fails a deploy.

```bash
sudo systemctl status control-scout-bot
sudo journalctl -u control-scout-bot -f
sudo systemctl restart control-scout-bot   # after adding or changing the token
```

On SIGTERM (a stop or restart) it disconnects from Discord and exits within a few seconds.
